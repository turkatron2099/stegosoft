<# : Thagobyte JoyKeys -- batch launcher (the PowerShell below does the work)
@echo off
setlocal
title Thagobyte JoyKeys
set "TB_SELF=%~f0"
powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "Invoke-Expression ([System.IO.File]::ReadAllText($env:TB_SELF))"
endlocal
goto :eof
#>

# =============================================================================
#  Thagobyte JoyKeys for Windows
#  https://thagobyte.com/joykeys.html
#
#  Turns joystick / gamepad buttons into keyboard keys, so a controller can
#  play any game that only understands the keyboard. Out of the box the
#  D-pad and left stick press the arrow keys, button 1 (A) presses Space,
#  buttons 2 (B) and 8 (Start) press Enter, and button 7 (Back) presses
#  Escape. Choose "S" at the start to map any control to any key; your
#  mapping is saved in %USERPROFILE%\thagobyte-joykeys.txt (plain text you
#  can also edit by hand).
#
#  Reads the controller with the built-in Windows joystick API (winmm) and
#  types with SendInput. Nothing is installed. Close the window to stop.
# =============================================================================

$ErrorActionPreference = 'Stop'

Add-Type -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.IO;
using System.Runtime.InteropServices;
using System.Threading;

public static class JoyKeys
{
    [StructLayout(LayoutKind.Sequential)]
    struct JOYINFOEX
    {
        public uint dwSize, dwFlags, dwXpos, dwYpos, dwZpos, dwRpos, dwUpos, dwVpos;
        public uint dwButtons, dwButtonNumber, dwPOV, dwReserved1, dwReserved2;
    }

    [StructLayout(LayoutKind.Sequential)]
    struct MOUSEINPUT { public int dx, dy; public uint mouseData, dwFlags, time; public IntPtr dwExtraInfo; }

    [StructLayout(LayoutKind.Sequential)]
    struct KEYBDINPUT { public ushort wVk, wScan; public uint dwFlags, time; public IntPtr dwExtraInfo; }

    [StructLayout(LayoutKind.Explicit)]
    struct InputUnion { [FieldOffset(0)] public MOUSEINPUT mi; [FieldOffset(0)] public KEYBDINPUT ki; }

    [StructLayout(LayoutKind.Sequential)]
    struct INPUT { public uint type; public InputUnion u; }

    [DllImport("winmm.dll")] static extern uint joyGetPosEx(uint id, ref JOYINFOEX info);
    [DllImport("user32.dll")] static extern uint SendInput(uint count, INPUT[] inputs, int size);
    [DllImport("user32.dll")] static extern uint MapVirtualKey(uint code, uint mapType);

    const uint JOY_RETURNALL = 0xFF;
    const uint KEYEVENTF_EXTENDEDKEY = 0x1, KEYEVENTF_KEYUP = 0x2, KEYEVENTF_SCANCODE = 0x8;

    static readonly Dictionary<string, ushort> KeyCodes = new Dictionary<string, ushort>();
    static readonly HashSet<string> ExtendedKeys = new HashSet<string> { "up", "down", "left", "right" };
    static readonly Dictionary<string, string> KeyAliases = new Dictionary<string, string> {
        { "esc", "escape" }, { "return", "enter" }, { " ", "space" }, { "control", "ctrl" }
    };

    static readonly Dictionary<string, string> DefaultMapping = new Dictionary<string, string> {
        { "axis X -", "left" }, { "axis X +", "right" }, { "axis Y -", "up" }, { "axis Y +", "down" },
        { "pov up", "up" }, { "pov down", "down" }, { "pov left", "left" }, { "pov right", "right" },
        { "button 1", "space" }, { "button 2", "enter" }, { "button 8", "enter" }, { "button 7", "escape" }
    };

    static readonly string ConfigPath = Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.UserProfile), "thagobyte-joykeys.txt");

    static readonly string[] AxisNames = { "X", "Y", "Z", "R", "U", "V" };
    static double[] rest = new double[6];
    static HashSet<string> held = new HashSet<string>();

    static JoyKeys()
    {
        for (char c = 'a'; c <= 'z'; c++) KeyCodes[c.ToString()] = (ushort)char.ToUpper(c);
        for (char c = '0'; c <= '9'; c++) KeyCodes[c.ToString()] = (ushort)c;
        for (int i = 1; i <= 12; i++) KeyCodes["f" + i] = (ushort)(0x6F + i);
        KeyCodes["space"] = 0x20; KeyCodes["enter"] = 0x0D; KeyCodes["escape"] = 0x1B;
        KeyCodes["tab"] = 0x09; KeyCodes["backspace"] = 0x08; KeyCodes["shift"] = 0xA0;
        KeyCodes["ctrl"] = 0xA2; KeyCodes["alt"] = 0xA4; KeyCodes["left"] = 0x25;
        KeyCodes["up"] = 0x26; KeyCodes["right"] = 0x27; KeyCodes["down"] = 0x28;
    }

    static string NormalizeKey(string name)
    {
        name = (name ?? "").Trim().ToLowerInvariant();
        string alias;
        return KeyAliases.TryGetValue(name, out alias) ? alias : name;
    }

    // --- Mapping file -------------------------------------------------------

    static Dictionary<string, string> LoadMapping()
    {
        if (!File.Exists(ConfigPath)) return new Dictionary<string, string>(DefaultMapping);
        var mapping = new Dictionary<string, string>();
        foreach (var raw in File.ReadAllLines(ConfigPath))
        {
            var line = raw.Split('#')[0].Trim();
            int eq = line.LastIndexOf('=');
            if (eq < 0) continue;
            var key = NormalizeKey(line.Substring(eq + 1));
            if (KeyCodes.ContainsKey(key)) mapping[line.Substring(0, eq).Trim()] = key;
        }
        return mapping;
    }

    static void SaveMapping(Dictionary<string, string> mapping)
    {
        var lines = new List<string> { "# Thagobyte JoyKeys mapping:  joystick control = keyboard key" };
        foreach (var control in Sorted(mapping.Keys)) lines.Add(control + " = " + mapping[control]);
        File.WriteAllLines(ConfigPath, lines);
    }

    static List<string> Sorted(IEnumerable<string> items)
    {
        var list = new List<string>(items);
        list.Sort(StringComparer.Ordinal);
        return list;
    }

    static void PrintMapping(Dictionary<string, string> mapping)
    {
        if (mapping.Count == 0) Console.WriteLine("  (nothing mapped)");
        foreach (var control in Sorted(mapping.Keys))
            Console.WriteLine("  {0,-20} -> {1}", control, mapping[control]);
    }

    // --- Joystick -----------------------------------------------------------

    static bool Read(uint id, out JOYINFOEX info)
    {
        info = new JOYINFOEX();
        info.dwSize = (uint)Marshal.SizeOf(typeof(JOYINFOEX));
        info.dwFlags = JOY_RETURNALL;
        return joyGetPosEx(id, ref info) == 0;
    }

    static uint[] Axes(JOYINFOEX info)
    {
        return new[] { info.dwXpos, info.dwYpos, info.dwZpos, info.dwRpos, info.dwUpos, info.dwVpos };
    }

    static double Norm(uint value) { return value / 32767.5 - 1.0; }

    static uint WaitForJoystick()
    {
        bool announced = false;
        while (true)
        {
            JOYINFOEX info;
            for (uint id = 0; id < 16; id++)
            {
                if (!Read(id, out info)) continue;
                var axes = Axes(info);
                for (int i = 0; i < 6; i++) rest[i] = Norm(axes[i]);
                Console.WriteLine("Joystick found (#{0}).", id + 1);
                return id;
            }
            if (!announced)
            {
                Console.WriteLine("Waiting for a joystick... plug one in (close this window to quit).");
                announced = true;
            }
            Thread.Sleep(1000);
        }
    }

    // Returns null if the joystick was unplugged.
    static HashSet<string> ActiveControls(uint id)
    {
        JOYINFOEX info;
        if (!Read(id, out info)) return null;
        var active = new HashSet<string>();
        for (int b = 0; b < 32; b++)
            if ((info.dwButtons & (1u << b)) != 0) active.Add("button " + (b + 1));
        var axes = Axes(info);
        for (int i = 0; i < 6; i++)
        {
            double n = Norm(axes[i]);
            string name = "axis " + AxisNames[i];
            if (rest[i] < -0.5) { if (n > 0) active.Add(name + " +"); }  // trigger/throttle resting at one end
            else if (n > 0.5) active.Add(name + " +");
            else if (n < -0.5) active.Add(name + " -");
        }
        uint pov = info.dwPOV;
        if (pov != 0xFFFF && pov <= 36000)
        {
            if (pov >= 31500 || pov <= 4500) active.Add("pov up");
            if (pov >= 4500 && pov <= 13500) active.Add("pov right");
            if (pov >= 13500 && pov <= 22500) active.Add("pov down");
            if (pov >= 22500 && pov <= 31500) active.Add("pov left");
        }
        return active;
    }

    // --- Keyboard -----------------------------------------------------------

    static void SendKey(string key, bool down)
    {
        var input = new INPUT { type = 1 };
        input.u.ki.wScan = (ushort)MapVirtualKey(KeyCodes[key], 0);
        input.u.ki.dwFlags = KEYEVENTF_SCANCODE
            | (ExtendedKeys.Contains(key) ? KEYEVENTF_EXTENDEDKEY : 0)
            | (down ? 0 : KEYEVENTF_KEYUP);
        SendInput(1, new[] { input }, Marshal.SizeOf(typeof(INPUT)));
    }

    static void SetKeys(HashSet<string> keys)
    {
        foreach (var key in held) if (!keys.Contains(key)) SendKey(key, false);
        foreach (var key in keys) if (!held.Contains(key)) SendKey(key, true);
        held = new HashSet<string>(keys);
    }

    // --- Setup and run ------------------------------------------------------

    static HashSet<string> Poll(uint id)
    {
        Thread.Sleep(10);
        return ActiveControls(id) ?? new HashSet<string>();
    }

    static void Setup(uint id, Dictionary<string, string> mapping)
    {
        Console.WriteLine();
        Console.WriteLine("Keys you can use: a-z, 0-9, space, enter, escape, tab, backspace,");
        Console.WriteLine("shift, ctrl, alt, up, down, left, right, f1-f12  (or 'none' to clear)");
        Console.WriteLine();
        while (true)
        {
            Console.WriteLine("Press or move the joystick control you want to map...");
            while (Poll(id).Count > 0) { }  // wait for everything to be let go
            var baseline = Poll(id);
            string control = null;
            while (control == null)
            {
                var fresh = Poll(id);
                fresh.ExceptWith(baseline);
                if (fresh.Count > 0) control = Sorted(fresh)[0];
            }
            Console.WriteLine("  Got: " + control + (mapping.ContainsKey(control) ? "  (now: " + mapping[control] + ")" : ""));
            while (true)
            {
                Console.Write("  Keyboard key for it: ");
                var key = NormalizeKey(Console.ReadLine());
                if (key == "none") { mapping.Remove(control); break; }
                if (KeyCodes.ContainsKey(key)) { mapping[control] = key; break; }
                Console.WriteLine("  Didn't recognise that key, try again.");
            }
            Console.Write("Map another control? [Y/n] ");
            var again = (Console.ReadLine() ?? "").Trim().ToLowerInvariant();
            if (again == "n" || again == "no") break;
        }
        SaveMapping(mapping);
        Console.WriteLine("Saved to " + ConfigPath);
    }

    public static void Main()
    {
        Console.WriteLine("Thagobyte JoyKeys -- joystick to keyboard");
        Console.WriteLine();
        var mapping = LoadMapping();
        Console.CancelKeyPress += delegate { SetKeys(new HashSet<string>()); };

        uint id = WaitForJoystick();
        Console.WriteLine();
        Console.WriteLine("Current mapping:");
        PrintMapping(mapping);
        Console.WriteLine();
        Console.Write("Press Enter to start, S to set up your own mapping, or D to go back to the defaults: ");
        var choice = (Console.ReadLine() ?? "").Trim().ToLowerInvariant();
        if (choice == "d")
        {
            mapping = new Dictionary<string, string>(DefaultMapping);
            SaveMapping(mapping);
            Console.WriteLine("Back to the default mapping.");
        }
        else if (choice == "s")
        {
            Setup(id, mapping);
        }

        Console.WriteLine();
        Console.WriteLine("JoyKeys is running. Switch to your game and play. Close this window to stop.");
        while (true)
        {
            Thread.Sleep(10);
            var active = ActiveControls(id);
            if (active == null)
            {
                SetKeys(new HashSet<string>());
                Console.WriteLine("Joystick disconnected.");
                id = WaitForJoystick();
                continue;
            }
            var keys = new HashSet<string>();
            foreach (var control in active)
                if (mapping.ContainsKey(control)) keys.Add(mapping[control]);
            SetKeys(keys);
        }
    }
}
'@

try {
    [JoyKeys]::Main()
} catch {
    Write-Host ""
    Write-Host "Something went wrong: $($_.Exception.Message)" -ForegroundColor Red
    Read-Host "Press Enter to close"
}
