#!/usr/bin/env python3
# =============================================================================
#  Thagobyte JoyKeys for Linux
#  https://thagobyte.com/joykeys.html
#
#  Turns joystick / gamepad buttons into keyboard keys, so a controller can
#  play any game that only understands the keyboard. Out of the box the
#  D-pad and left stick press the arrow keys, A presses Space, B and Start
#  press Enter, and Select / Back presses Escape. Choose "S" at the start to
#  map any control to any key; your mapping is saved in
#  ~/thagobyte-joykeys.txt (a plain text file you can also edit by hand).
#
#  Needs only Python 3 (no extra packages). Reads the controller through
#  /dev/input and types through /dev/uinput, so it works on X11 and Wayland
#  alike. Run it with:   python3 thagobyte-joykeys-linux.py
#  Stop it with Ctrl+C.
# =============================================================================

import array
import fcntl
import os
import pwd
import select
import struct
import sys
import time

# --- Linux input constants (linux/input.h, linux/input-event-codes.h) -------
EV_SYN, EV_KEY, EV_ABS = 0x00, 0x01, 0x03
SYN_REPORT = 0
EVENT_FORMAT = "llHHi"  # struct input_event: timeval, type, code, value
EVENT_SIZE = struct.calcsize(EVENT_FORMAT)


def _ioc(direction, kind, number, size):
    return (direction << 30) | (size << 16) | (ord(kind) << 8) | number


def EVIOCGBIT(ev, length):
    return _ioc(2, "E", 0x20 + ev, length)


def EVIOCGABS(axis):
    return _ioc(2, "E", 0x40 + axis, 24)


EVIOCGNAME = _ioc(2, "E", 0x06, 256)
UI_SET_EVBIT = _ioc(1, "U", 100, 4)
UI_SET_KEYBIT = _ioc(1, "U", 101, 4)
UI_DEV_SETUP = _ioc(1, "U", 3, 92)
UI_DEV_CREATE = _ioc(0, "U", 1, 0)
UI_DEV_DESTROY = _ioc(0, "U", 2, 0)

BUTTON_NAMES = {
    0x120: "TRIGGER", 0x121: "THUMB", 0x122: "THUMB2", 0x123: "TOP",
    0x124: "TOP2", 0x125: "PINKIE", 0x126: "BASE", 0x127: "BASE2",
    0x128: "BASE3", 0x129: "BASE4", 0x12A: "BASE5", 0x12B: "BASE6",
    0x130: "A", 0x131: "B", 0x132: "C", 0x133: "X", 0x134: "Y", 0x135: "Z",
    0x136: "TL", 0x137: "TR", 0x138: "TL2", 0x139: "TR2", 0x13A: "SELECT",
    0x13B: "START", 0x13C: "MODE", 0x13D: "THUMBL", 0x13E: "THUMBR",
    0x220: "DPAD_UP", 0x221: "DPAD_DOWN", 0x222: "DPAD_LEFT", 0x223: "DPAD_RIGHT",
}
AXIS_NAMES = {
    0x00: "X", 0x01: "Y", 0x02: "Z", 0x03: "RX", 0x04: "RY", 0x05: "RZ",
    0x06: "THROTTLE", 0x07: "RUDDER", 0x08: "WHEEL", 0x09: "GAS", 0x0A: "BRAKE",
    0x10: "HAT0X", 0x11: "HAT0Y", 0x12: "HAT1X", 0x13: "HAT1Y",
}

KEY_CODES = {
    "escape": 1, "1": 2, "2": 3, "3": 4, "4": 5, "5": 6, "6": 7, "7": 8,
    "8": 9, "9": 10, "0": 11, "backspace": 14, "tab": 15, "q": 16, "w": 17,
    "e": 18, "r": 19, "t": 20, "y": 21, "u": 22, "i": 23, "o": 24, "p": 25,
    "enter": 28, "ctrl": 29, "a": 30, "s": 31, "d": 32, "f": 33, "g": 34,
    "h": 35, "j": 36, "k": 37, "l": 38, "shift": 42, "z": 44, "x": 45,
    "c": 46, "v": 47, "b": 48, "n": 49, "m": 50, "alt": 56, "space": 57,
    "f1": 59, "f2": 60, "f3": 61, "f4": 62, "f5": 63, "f6": 64, "f7": 65,
    "f8": 66, "f9": 67, "f10": 68, "f11": 87, "f12": 88, "up": 103,
    "left": 105, "right": 106, "down": 108,
}
KEY_ALIASES = {"esc": "escape", "return": "enter", " ": "space", "control": "ctrl"}

DEFAULT_MAPPING = {
    "axis X -": "left", "axis X +": "right", "axis Y -": "up", "axis Y +": "down",
    "axis HAT0X -": "left", "axis HAT0X +": "right",
    "axis HAT0Y -": "up", "axis HAT0Y +": "down",
    "button DPAD_UP": "up", "button DPAD_DOWN": "down",
    "button DPAD_LEFT": "left", "button DPAD_RIGHT": "right",
    "button A": "space", "button B": "enter", "button START": "enter",
    "button SELECT": "escape", "button TRIGGER": "space", "button THUMB": "enter",
}


def home_dir():
    # Under sudo, keep using the real user's mapping file.
    sudo_user = os.environ.get("SUDO_USER")
    if sudo_user:
        try:
            return pwd.getpwnam(sudo_user).pw_dir
        except KeyError:
            pass
    return os.path.expanduser("~")


CONFIG_PATH = os.path.join(home_dir(), "thagobyte-joykeys.txt")


def normalize_key(name):
    name = name.strip().lower()
    return KEY_ALIASES.get(name, name)


def load_mapping():
    if not os.path.exists(CONFIG_PATH):
        return dict(DEFAULT_MAPPING)
    mapping = {}
    with open(CONFIG_PATH, encoding="utf-8") as f:
        for line in f:
            line = line.split("#", 1)[0].strip()
            if "=" not in line:
                continue
            control, key = (part.strip() for part in line.rsplit("=", 1))
            key = normalize_key(key)
            if key in KEY_CODES:
                mapping[control] = key
    return mapping


def save_mapping(mapping):
    with open(CONFIG_PATH, "w", encoding="utf-8") as f:
        f.write("# Thagobyte JoyKeys mapping:  joystick control = keyboard key\n")
        for control in sorted(mapping):
            f.write(f"{control} = {mapping[control]}\n")
    if os.environ.get("SUDO_UID"):
        os.chown(CONFIG_PATH, int(os.environ["SUDO_UID"]), int(os.environ["SUDO_GID"]))


# --- Joystick ---------------------------------------------------------------

def find_joystick():
    """Return the /dev/input/eventN path of the first joystick, or None."""
    try:
        with open("/proc/bus/input/devices", encoding="utf-8") as f:
            blocks = f.read().split("\n\n")
    except OSError:
        return None
    for block in blocks:
        for line in block.splitlines():
            if line.startswith("H: Handlers="):
                handlers = line.split("=", 1)[1].split()
                if any(h.startswith("js") for h in handlers):
                    for h in handlers:
                        if h.startswith("event"):
                            return "/dev/input/" + h
    return None


def test_bit(bits, n):
    return bits[n // 8] >> (n % 8) & 1


class Joystick:
    def __init__(self, path):
        self.fd = os.open(path, os.O_RDONLY | os.O_NONBLOCK)
        name = array.array("B", bytes(256))
        fcntl.ioctl(self.fd, EVIOCGNAME, name)
        self.name = name.tobytes().split(b"\0", 1)[0].decode(errors="replace")
        absbits = array.array("B", bytes(8))
        fcntl.ioctl(self.fd, EVIOCGBIT(EV_ABS, 8), absbits)
        self.axes = {}  # code -> (min, max, resting value normalized to -1..1)
        self.values = {}
        for code in range(0x40):
            if test_bit(absbits, code):
                info = array.array("i", bytes(24))
                fcntl.ioctl(self.fd, EVIOCGABS(code), info)
                value, lo, hi = info[0], info[1], info[2]
                if hi > lo:
                    self.axes[code] = (lo, hi, self._norm(value, lo, hi))
                    self.values[code] = value
        self.buttons = set()

    @staticmethod
    def _norm(value, lo, hi):
        return (value - lo) * 2.0 / (hi - lo) - 1.0

    def read(self):
        """Drain pending events. Raises OSError if the device went away."""
        while True:
            try:
                data = os.read(self.fd, EVENT_SIZE * 64)
            except BlockingIOError:
                return
            if not data:
                raise OSError("joystick disconnected")
            for i in range(0, len(data) - EVENT_SIZE + 1, EVENT_SIZE):
                _, _, kind, code, value = struct.unpack_from(EVENT_FORMAT, data, i)
                if kind == EV_KEY:
                    if value:
                        self.buttons.add(code)
                    else:
                        self.buttons.discard(code)
                elif kind == EV_ABS and code in self.axes:
                    self.values[code] = value

    def active_controls(self):
        active = set()
        for code in self.buttons:
            active.add("button " + BUTTON_NAMES.get(code, str(code)))
        for code, (lo, hi, rest) in self.axes.items():
            n = self._norm(self.values[code], lo, hi)
            name = "axis " + AXIS_NAMES.get(code, str(code))
            if rest < -0.5:
                # A trigger or throttle that rests at one end: half-pull counts.
                if n > 0:
                    active.add(name + " +")
            elif n > 0.5:
                active.add(name + " +")
            elif n < -0.5:
                active.add(name + " -")
        return active

    def close(self):
        os.close(self.fd)


def wait_for_joystick():
    announced = False
    while True:
        path = find_joystick()
        if path:
            try:
                joy = Joystick(path)
                print(f"Joystick: {joy.name}")
                return joy
            except PermissionError:
                if not announced:
                    print(f"Can't read {path} (permission denied). Try running with sudo.")
                    announced = True
            except OSError:
                pass
        elif not announced:
            print("Waiting for a joystick... plug one in (Ctrl+C to quit).")
            announced = True
        time.sleep(1)


# --- Virtual keyboard -------------------------------------------------------

class VirtualKeyboard:
    def __init__(self):
        self.fd = os.open("/dev/uinput", os.O_WRONLY | os.O_NONBLOCK)
        fcntl.ioctl(self.fd, UI_SET_EVBIT, EV_KEY)
        for code in KEY_CODES.values():
            fcntl.ioctl(self.fd, UI_SET_KEYBIT, code)
        setup = struct.pack("HHHH80sI", 0x03, 0x1209, 0x7462, 1, b"Thagobyte JoyKeys", 0)
        fcntl.ioctl(self.fd, UI_DEV_SETUP, setup)
        fcntl.ioctl(self.fd, UI_DEV_CREATE)
        self.held = set()
        time.sleep(0.2)  # give the desktop a moment to notice the new keyboard

    def _emit(self, kind, code, value):
        os.write(self.fd, struct.pack(EVENT_FORMAT, 0, 0, kind, code, value))

    def set_keys(self, keys):
        for key in self.held - keys:
            self._emit(EV_KEY, KEY_CODES[key], 0)
        for key in keys - self.held:
            self._emit(EV_KEY, KEY_CODES[key], 1)
        if keys != self.held:
            self._emit(EV_SYN, SYN_REPORT, 0)
        self.held = set(keys)

    def close(self):
        self.set_keys(set())
        fcntl.ioctl(self.fd, UI_DEV_DESTROY)
        os.close(self.fd)


UINPUT_HELP = """
JoyKeys can't create a virtual keyboard: /dev/uinput isn't writable.

Quick fix: run it with sudo:
    sudo python3 {script}

Permanent fix (lets it run without sudo, like Steam does for controllers):
    echo 'KERNEL=="uinput", SUBSYSTEM=="misc", TAG+="uaccess", OPTIONS+="static_node=uinput"' | sudo tee /etc/udev/rules.d/60-thagobyte-joykeys.rules
then restart the computer.
"""


# --- Setup and run ----------------------------------------------------------

def print_mapping(mapping):
    if not mapping:
        print("  (nothing mapped)")
    for control in sorted(mapping):
        print(f"  {control:<20} -> {mapping[control]}")


def poll(joy, timeout=0.01):
    select.select([joy.fd], [], [], timeout)
    joy.read()


def setup(joy, mapping):
    print("\nKeys you can use: a-z, 0-9, space, enter, escape, tab, backspace,")
    print("shift, ctrl, alt, up, down, left, right, f1-f12  (or 'none' to clear)\n")
    while True:
        print("Press or move the joystick control you want to map...")
        while joy.active_controls():  # wait for everything to be let go
            poll(joy)
        baseline = joy.active_controls()
        control = None
        while control is None:
            poll(joy)
            new = joy.active_controls() - baseline
            if new:
                control = sorted(new)[0]
        print(f"  Got: {control}" + (f"  (now: {mapping[control]})" if control in mapping else ""))
        while True:
            key = normalize_key(input("  Keyboard key for it: "))
            if key == "none":
                mapping.pop(control, None)
                break
            if key in KEY_CODES:
                mapping[control] = key
                break
            print("  Didn't recognise that key, try again.")
        if input("Map another control? [Y/n] ").strip().lower() in ("n", "no"):
            break
    save_mapping(mapping)
    print(f"Saved to {CONFIG_PATH}")


def run(joy, keyboard, mapping):
    print("\nJoyKeys is running. Switch to your game and play. Ctrl+C to stop.")
    while True:
        poll(joy, 0.05)
        keys = {mapping[c] for c in joy.active_controls() if c in mapping}
        keyboard.set_keys(keys)


def main():
    print("Thagobyte JoyKeys -- joystick to keyboard\n")
    try:
        keyboard = VirtualKeyboard()
    except OSError:
        print(UINPUT_HELP.format(script=os.path.abspath(sys.argv[0])))
        sys.exit(1)

    mapping = load_mapping()
    joy = None
    try:
        joy = wait_for_joystick()
        print("\nCurrent mapping:")
        print_mapping(mapping)
        choice = input("\nPress Enter to start, S to set up your own mapping, "
                       "or D to go back to the defaults: ").strip().lower()
        if choice == "d":
            mapping = dict(DEFAULT_MAPPING)
            save_mapping(mapping)
            print("Back to the default mapping.")
        elif choice == "s":
            setup(joy, mapping)
        while True:
            try:
                run(joy, keyboard, mapping)
            except OSError:
                keyboard.set_keys(set())
                joy.close()
                joy = None
                print("Joystick disconnected.")
                joy = wait_for_joystick()
    except (KeyboardInterrupt, EOFError):
        print("\nStopped.")
    finally:
        keyboard.close()
        if joy:
            joy.close()


if __name__ == "__main__":
    main()
