// =============================================================================
//  Thagobyte JoyKeys for Mac
//  https://thagobyte.com/joykeys.html
//
//  Turns game controller buttons into keyboard keys, so a controller can
//  play any game that only understands the keyboard. Out of the box the
//  D-pad and left stick press the arrow keys, A presses Space, B and Menu
//  press Enter, and Options presses Escape. Choose "S" at the start to map
//  any control to any key; your mapping is saved in ~/thagobyte-joykeys.txt
//  (a plain text file you can also edit by hand).
//
//  Uses Apple's Game Controller framework (Xbox, PlayStation, Switch Pro and
//  MFi controllers) and needs nothing installed. Run it in Terminal with:
//      osascript -l JavaScript ~/Downloads/thagobyte-joykeys-mac.js
//  Stop it with Ctrl+C. The first time, macOS asks you to allow Terminal
//  under System Settings > Privacy & Security > Accessibility; JoyKeys
//  can't press keys until you do.
// =============================================================================

ObjC.import("Cocoa");
ObjC.import("GameController");
ObjC.import("ApplicationServices");

const KEY_CODES = {
  a: 0, s: 1, d: 2, f: 3, h: 4, g: 5, z: 6, x: 7, c: 8, v: 9, b: 11, q: 12,
  w: 13, e: 14, r: 15, y: 16, t: 17, 1: 18, 2: 19, 3: 20, 4: 21, 6: 22,
  5: 23, 9: 25, 7: 26, 8: 28, 0: 29, o: 31, u: 32, i: 34, p: 35, enter: 36,
  l: 37, j: 38, k: 40, n: 45, m: 46, tab: 48, space: 49, backspace: 51,
  escape: 53, shift: 56, alt: 58, ctrl: 59, f1: 122, f2: 120, f3: 99,
  f4: 118, f5: 96, f6: 97, f7: 98, f8: 100, f9: 101, f10: 109, f11: 103,
  f12: 111, left: 123, right: 124, down: 125, up: 126,
};
const KEY_ALIASES = { esc: "escape", return: "enter", " ": "space", control: "ctrl", option: "alt" };

const DEFAULT_MAPPING = {
  "dpad up": "up", "dpad down": "down", "dpad left": "left", "dpad right": "right",
  "left stick up": "up", "left stick down": "down",
  "left stick left": "left", "left stick right": "right",
  "a": "space", "b": "enter", "menu": "enter", "options": "escape",
};

// Controls read from an extended gamepad: name -> property path.
const BUTTONS = [
  ["a", "buttonA"], ["b", "buttonB"], ["x", "buttonX"], ["y", "buttonY"],
  ["l1", "leftShoulder"], ["r1", "rightShoulder"],
  ["l2", "leftTrigger"], ["r2", "rightTrigger"],
  ["menu", "buttonMenu"], ["options", "buttonOptions"],
  ["left stick click", "leftThumbstickButton"], ["right stick click", "rightThumbstickButton"],
];
const PADS = [["dpad", "dpad"], ["left stick", "leftThumbstick"], ["right stick", "rightThumbstick"]];
const DIRECTIONS = ["up", "down", "left", "right"];

const CONFIG_PATH = $.NSHomeDirectory().js + "/thagobyte-joykeys.txt";

// --- Terminal I/O -----------------------------------------------------------

function write(text) {
  const data = $(text).dataUsingEncoding($.NSUTF8StringEncoding);
  $.NSFileHandle.fileHandleWithStandardOutput.writeData(data);
}

function print(text) {
  write((text || "") + "\n");
}

function ask(prompt) {
  write(prompt);
  const data = $.NSFileHandle.fileHandleWithStandardInput.availableData;
  if (data.length === 0) throw new Error("input closed");
  return ObjC.unwrap($.NSString.alloc.initWithDataEncoding(data, $.NSUTF8StringEncoding)).replace(/\r?\n$/, "");
}

function normalizeKey(name) {
  name = String(name).trim().toLowerCase();
  return KEY_ALIASES[name] || name;
}

// --- Mapping file -----------------------------------------------------------

function loadMapping() {
  if (!$.NSFileManager.defaultManager.fileExistsAtPath(CONFIG_PATH)) return Object.assign({}, DEFAULT_MAPPING);
  const text = $.NSString.stringWithContentsOfFileEncodingError(CONFIG_PATH, $.NSUTF8StringEncoding, null);
  const mapping = {};
  for (const raw of ObjC.unwrap(text).split("\n")) {
    const line = raw.split("#")[0].trim();
    const eq = line.lastIndexOf("=");
    if (eq < 0) continue;
    const key = normalizeKey(line.slice(eq + 1));
    if (key in KEY_CODES) mapping[line.slice(0, eq).trim()] = key;
  }
  return mapping;
}

function saveMapping(mapping) {
  let text = "# Thagobyte JoyKeys mapping:  joystick control = keyboard key\n";
  for (const control of Object.keys(mapping).sort()) text += control + " = " + mapping[control] + "\n";
  $(text).writeToFileAtomicallyEncodingError(CONFIG_PATH, true, $.NSUTF8StringEncoding, null);
}

function printMapping(mapping) {
  const controls = Object.keys(mapping).sort();
  if (controls.length === 0) print("  (nothing mapped)");
  for (const control of controls) print("  " + control.padEnd(20) + " -> " + mapping[control]);
}

// --- Controller -------------------------------------------------------------

function isNil(object) {
  return object === undefined || object === null || object.isNil();
}

// Lets the Game Controller framework deliver connections and input.
function pump(seconds) {
  $.NSRunLoop.currentRunLoop.runUntilDate($.NSDate.dateWithTimeIntervalSinceNow(seconds));
}

function firstGamepad() {
  const controllers = $.GCController.controllers;
  for (let i = 0; i < controllers.count; i++) {
    const pad = controllers.objectAtIndex(i).extendedGamepad;
    if (!isNil(pad)) return controllers.objectAtIndex(i);
  }
  return null;
}

function waitForController() {
  let announced = false;
  while (true) {
    pump(0.25);
    const controller = firstGamepad();
    if (controller) {
      print("Controller: " + (ObjC.unwrap(controller.vendorName) || "game controller"));
      return controller;
    }
    if (!announced) {
      print("Waiting for a controller... connect one (Ctrl+C to quit).");
      announced = true;
    }
  }
}

function isPressed(input) {
  return !isNil(input) && input.pressed === true;
}

// Returns null if the controller was disconnected.
function activeControls(controller) {
  const pad = controller.extendedGamepad;
  if (isNil(pad)) return null;
  const active = new Set();
  for (const [name, prop] of BUTTONS) {
    if (isPressed(pad[prop])) active.add(name);
  }
  for (const [name, prop] of PADS) {
    const dpad = pad[prop];
    if (isNil(dpad)) continue;
    for (const dir of DIRECTIONS) {
      if (isPressed(dpad[dir])) active.add(name + " " + dir);
    }
  }
  return active;
}

function isConnected(controller) {
  const controllers = $.GCController.controllers;
  for (let i = 0; i < controllers.count; i++) {
    if (controllers.objectAtIndex(i).isEqual(controller)) return true;
  }
  return false;
}

// --- Keyboard ---------------------------------------------------------------

let held = new Set();

function sendKey(key, down) {
  const event = $.CGEventCreateKeyboardEvent(null, KEY_CODES[key], down);
  $.CGEventPost(0 /* kCGHIDEventTap */, event);
}

function setKeys(keys) {
  for (const key of held) if (!keys.has(key)) sendKey(key, false);
  for (const key of keys) if (!held.has(key)) sendKey(key, true);
  held = new Set(keys);
}

// --- Setup and run ----------------------------------------------------------

function poll(controller) {
  pump(0.01);
  return activeControls(controller) || new Set();
}

function setup(controller, mapping) {
  print("\nKeys you can use: a-z, 0-9, space, enter, escape, tab, backspace,");
  print("shift, ctrl, alt, up, down, left, right, f1-f12  (or 'none' to clear)\n");
  while (true) {
    print("Press or move the controller control you want to map...");
    while (poll(controller).size > 0) {} // wait for everything to be let go
    let control = null;
    while (control === null) {
      const fresh = [...poll(controller)].sort();
      if (fresh.length > 0) control = fresh[0];
    }
    print("  Got: " + control + (mapping[control] ? "  (now: " + mapping[control] + ")" : ""));
    while (true) {
      const key = normalizeKey(ask("  Keyboard key for it: "));
      if (key === "none") { delete mapping[control]; break; }
      if (key in KEY_CODES) { mapping[control] = key; break; }
      print("  Didn't recognise that key, try again.");
    }
    const again = ask("Map another control? [Y/n] ").trim().toLowerCase();
    if (again === "n" || again === "no") break;
  }
  saveMapping(mapping);
  print("Saved to " + CONFIG_PATH);
}

function run() {
  print("Thagobyte JoyKeys -- controller to keyboard\n");

  // Keep receiving controller input while the game, not Terminal, is in front.
  if ($.GCController.respondsToSelector("setShouldMonitorBackgroundEvents:")) {
    $.GCController.setShouldMonitorBackgroundEvents(true);
  }
  if (!$.AXIsProcessTrusted()) {
    print("macOS needs your OK before JoyKeys can press keys:");
    print("  System Settings > Privacy & Security > Accessibility > turn on Terminal");
    print("(If Terminal isn't listed, click + and add it from Applications > Utilities.)");
    print("Then quit Terminal completely and run JoyKeys again.\n");
  }

  let mapping = loadMapping();
  let controller = waitForController();
  print("\nCurrent mapping:");
  printMapping(mapping);
  const choice = ask("\nPress Enter to start, S to set up your own mapping, or D to go back to the defaults: ")
    .trim().toLowerCase();
  if (choice === "d") {
    mapping = Object.assign({}, DEFAULT_MAPPING);
    saveMapping(mapping);
    print("Back to the default mapping.");
  } else if (choice === "s") {
    setup(controller, mapping);
  }

  print("\nJoyKeys is running. Switch to your game and play. Ctrl+C to stop.");
  while (true) {
    pump(0.01);
    const active = isConnected(controller) ? activeControls(controller) : null;
    if (active === null) {
      setKeys(new Set());
      print("Controller disconnected.");
      controller = waitForController();
      continue;
    }
    const keys = new Set();
    for (const control of active) if (mapping[control]) keys.add(mapping[control]);
    setKeys(keys);
  }
}
