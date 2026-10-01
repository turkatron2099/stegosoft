<# : Thagobyte Windows Backup -- batch launcher (the PowerShell below does the work)
@echo off
setlocal
title Thagobyte Windows Backup
set "TB_SELF=%~f0"
powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "Invoke-Expression ([System.IO.File]::ReadAllText($env:TB_SELF))"
endlocal
goto :eof
#>

# =============================================================================
#  Thagobyte Windows Backup
#  https://thagobyte.com/windows-backup.html
#
#  Gathers a Windows user's files and settings into a .zip you can carry to a
#  new computer (Mac or PC). It reads only; nothing on this PC is changed or
#  deleted. Run it as Administrator so it can reach every user profile.
#
#  What it gathers (each category can be switched on/off before it starts):
#    - Desktop, Documents, Downloads, Pictures, Music, Videos (follows folders
#      redirected to OneDrive or another drive)
#    - Favorites, Links, Contacts, Saved Games, other folders in the profile
#    - Outlook: every .pst on the PC's drives, AutoComplete / nickname (.nk2)
#      files, a readable list of AutoComplete addresses (.csv + .vcf),
#      signatures, rules (.rwz), stationery, templates (.oft), VBA macros
#    - Browser bookmarks (Chrome, Edge, Brave, Vivaldi, Opera -> also exported
#      as a bookmarks .html any Mac browser imports), Firefox and Thunderbird
#      profiles (portable as-is to a Mac)
#    - Office templates, custom dictionaries, Quick Parts, Excel/Word startup
#    - User fonts, Sticky Notes, desktop wallpaper, iPhone/iPad backups
#    - Optional: cloud folders (OneDrive/Dropbox/Google Drive/iCloud), data
#      folders elsewhere on the drives, saved Wi-Fi passwords
#    - A report: installed programs, printers, mapped drives, what was skipped
#
#  Works on Windows 10/11 with the built-in Windows PowerShell 5.1.
# =============================================================================

$ErrorActionPreference = 'Stop'
trap {
    Write-Host ''
    Write-Host "  Something went wrong: $($_.Exception.Message)" -ForegroundColor Red
    Write-Host "  (line $($_.InvocationInfo.ScriptLineNumber))" -ForegroundColor DarkGray
    Read-Host '  Press Enter to close this window' | Out-Null
    exit 1
}
$ProgressPreference = 'Continue'
$TBVersion = '1.0'

function Write-Title($text) {
    Write-Host ''
    Write-Host ('=' * 70) -ForegroundColor DarkCyan
    Write-Host "  $text" -ForegroundColor Cyan
    Write-Host ('=' * 70) -ForegroundColor DarkCyan
}
function Write-Info($text)  { Write-Host "  $text" }
function Write-Note($text)  { Write-Host "  $text" -ForegroundColor DarkGray }
function Write-Warn2($text) { Write-Host "  ! $text" -ForegroundColor Yellow }
function Write-Good($text)  { Write-Host "  $text" -ForegroundColor Green }

function Read-YesNo($prompt, [bool]$default) {
    $hint = if ($default) { '[Y/n]' } else { '[y/N]' }
    while ($true) {
        $a = (Read-Host "  $prompt $hint").Trim().ToLower()
        if ($a -eq '') { return $default }
        if ($a -in @('y', 'yes')) { return $true }
        if ($a -in @('n', 'no')) { return $false }
    }
}

function Format-Size([double]$bytes) {
    if ($bytes -ge 1TB) { return '{0:N2} TB' -f ($bytes / 1TB) }
    if ($bytes -ge 1GB) { return '{0:N2} GB' -f ($bytes / 1GB) }
    if ($bytes -ge 1MB) { return '{0:N1} MB' -f ($bytes / 1MB) }
    if ($bytes -ge 1KB) { return '{0:N0} KB' -f ($bytes / 1KB) }
    return "$bytes B"
}

# Runs a Windows command-line tool without its error text tripping 'Stop'.
function Invoke-Native([string]$exe, [string[]]$arguments) {
    $ErrorActionPreference = 'Continue'
    & $exe @arguments 2>$null | Out-Null
    return $LASTEXITCODE
}

function Exit-Backup($code) {
    Write-Host ''
    Read-Host '  Press Enter to close this window' | Out-Null
    exit $code
}

# --- Elevation ---------------------------------------------------------------
$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$isAdmin = (New-Object Security.Principal.WindowsPrincipal $identity).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin) {
    if ($env:TB_SELF -and (Test-Path -LiteralPath $env:TB_SELF)) {
        Write-Host 'Asking Windows for Administrator rights...'
        try {
            Start-Process -FilePath $env:TB_SELF -Verb RunAs
            exit 0
        } catch {
            Write-Warn2 'Administrator rights were declined.'
        }
    }
    Write-Warn2 'Not running as Administrator: only your own profile can be backed up,'
    Write-Warn2 'and files other programs have open may be skipped.'
    if (-not (Read-YesNo 'Continue anyway?' $false)) { Exit-Backup 1 }
}

Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem
Add-Type -AssemblyName System.Web.Extensions

# --- Long path support -------------------------------------------------------
# Paths deeper than 260 characters need the \\?\ prefix. Older .NET builds
# reject it, so probe once and fall back to plain paths if it isn't supported.
$script:UseLongPrefix = $false
try {
    $probe = New-Object IO.DirectoryInfo ('\\?\' + $env:SystemRoot)
    if ($probe.Exists) { $script:UseLongPrefix = $true }
} catch { }

function ConvertTo-IoPath([string]$path) {
    if (-not $script:UseLongPrefix -or $path.StartsWith('\\?\')) { return $path }
    if ($path.StartsWith('\\')) { return '\\?\UNC\' + $path.Substring(2) }
    return '\\?\' + $path
}
function ConvertFrom-IoPath([string]$path) {
    if ($path.StartsWith('\\?\UNC\')) { return '\\' + $path.Substring(8) }
    if ($path.StartsWith('\\?\')) { return $path.Substring(4) }
    return $path
}

# --- Manifest -----------------------------------------------------------------
# Every file to back up becomes one item: where it is, where it goes in the
# zip, and which category it belongs to. The first category to claim a file
# keeps it, so e.g. a PST inside Documents is filed under Outlook only once.

$script:Categories = [ordered]@{}
$script:Claimed = New-Object 'System.Collections.Generic.HashSet[string]' ([StringComparer]::OrdinalIgnoreCase)
$script:CloudOnly = @{}          # category key -> [count, bytes] of online-only files skipped
$script:ScanErrors = New-Object System.Collections.Generic.List[string]
$script:GeneratedFiles = New-Object System.Collections.Generic.List[object]  # text files written into the zip
$script:Notes = New-Object System.Collections.Generic.List[string]

function Add-Category($key, $label, [bool]$default, $description) {
    $script:Categories[$key] = [pscustomobject]@{
        Key = $key; Label = $label; Enabled = $default; Description = $description
        Items = New-Object System.Collections.Generic.List[object]
        Bytes = [long]0
    }
}

Add-Category 'desktop'   'Desktop'                               $true  ''
Add-Category 'documents' 'Documents'                             $true  ''
Add-Category 'downloads' 'Downloads'                             $true  ''
Add-Category 'pictures'  'Pictures'                              $true  ''
Add-Category 'music'     'Music'                                 $true  ''
Add-Category 'videos'    'Videos'                                $true  ''
Add-Category 'outlook'   'Outlook data (PST, AutoComplete, signatures, rules)' $true 'Also searches every drive for .pst files'
Add-Category 'misc'      'Favorites, Links, Contacts, Saved Games' $true ''
Add-Category 'profile'   'Other folders in the user profile'     $true  'Anything saved directly in C:\Users\<name>'
Add-Category 'browsers'  'Browser bookmarks, Firefox & Thunderbird' $true ''
Add-Category 'office'    'Office templates, dictionaries, Quick Parts' $true ''
Add-Category 'personal'  'Fonts, Sticky Notes, wallpaper'        $true  ''
Add-Category 'iphone'    'iPhone / iPad backups (iTunes)'        $true  'Copy into ~/Library/Application Support/MobileSync/Backup on a Mac'
Add-Category 'cloud'     'Cloud folders (OneDrive, Dropbox, Google Drive, iCloud)' $false 'Already in the cloud -- just sign in on the new computer'
Add-Category 'extra'     'Data folders elsewhere on the drives'  $false 'Non-system folders like C:\Scans or D:\Photos'

$CompressedExtensions = New-Object 'System.Collections.Generic.HashSet[string]' ([StringComparer]::OrdinalIgnoreCase)
@('.jpg', '.jpeg', '.png', '.gif', '.heic', '.heif', '.webp', '.mp4', '.mov', '.m4v', '.mkv', '.avi', '.wmv',
  '.mp3', '.m4a', '.aac', '.ogg', '.flac', '.wma', '.zip', '.7z', '.rar', '.gz', '.bz2', '.xz', '.cab',
  '.docx', '.xlsx', '.pptx', '.docm', '.xlsm', '.pptm', '.odt', '.ods', '.epub', '.jar', '.apk', '.msi', '.iso') |
    ForEach-Object { [void]$CompressedExtensions.Add($_) }

# Junk that never needs to move.
$SkipFileNames = New-Object 'System.Collections.Generic.HashSet[string]' ([StringComparer]::OrdinalIgnoreCase)
@('desktop.ini', 'thumbs.db', 'ehthumbs.db', 'ehthumbs_vista.db', '.DS_Store', 'NTUSER.DAT', 'ntuser.dat.LOG1',
  'ntuser.dat.LOG2', 'ntuser.ini', 'ntuser.pol', 'UsrClass.dat') | ForEach-Object { [void]$SkipFileNames.Add($_) }

$OnlineOnlyMask = 0x00400000 -bor 0x00040000 -bor 0x00001000   # recall-on-data-access, recall-on-open, offline

function Test-SkipFile([IO.FileInfo]$file) {
    $n = $file.Name
    if ($SkipFileNames.Contains($n)) { return $true }
    if ($n.StartsWith('~$')) { return $true }                         # Office lock files
    if ($n.StartsWith('ntuser.dat', [StringComparison]::OrdinalIgnoreCase)) { return $true }
    $ext = $file.Extension.ToLower()
    if ($ext -in @('.tmp', '.ost', '.lnk.tmp', '.crdownload', '.partial')) { return $true }
    return $false
}

# Adds one file to a category. $zipPath uses / separators, relative to the zip root.
function Add-FileItem($catKey, [IO.FileInfo]$file, [string]$zipPath) {
    $cat = $script:Categories[$catKey]
    $plain = ConvertFrom-IoPath $file.FullName
    if (-not $script:Claimed.Add($plain)) { return }
    if (([int]$file.Attributes -band $OnlineOnlyMask) -ne 0) {
        if (-not $script:CloudOnly.ContainsKey($catKey)) { $script:CloudOnly[$catKey] = @(0, [long]0) }
        $script:CloudOnly[$catKey][0]++
        $script:CloudOnly[$catKey][1] += $file.Length
        return
    }
    $cat.Items.Add([pscustomobject]@{ Source = $file.FullName; Display = $plain; ZipPath = $zipPath; Length = $file.Length; Time = $file.LastWriteTime })
    $cat.Bytes += $file.Length
}

# Walks a folder tree and adds every file under it. Skips junctions/symlinks
# (Windows puts "My Music"-style loops in old profiles) and named subfolders.
function Add-Folder($catKey, [string]$folder, [string]$zipPrefix, [string[]]$excludeDirs = @(), [scriptblock]$fileFilter = $null, [switch]$quiet) {
    $rootIo = ConvertTo-IoPath $folder.TrimEnd('\')
    try { $root = New-Object IO.DirectoryInfo $rootIo; if (-not $root.Exists) { return } } catch { return }
    $exclude = New-Object 'System.Collections.Generic.HashSet[string]' ([StringComparer]::OrdinalIgnoreCase)
    foreach ($e in $excludeDirs) { [void]$exclude.Add($e) }
    $stack = New-Object System.Collections.Generic.Stack[object]
    $stack.Push(@($root, $zipPrefix.TrimEnd('/')))
    while ($stack.Count -gt 0) {
        $pair = $stack.Pop(); $dir = $pair[0]; $prefix = $pair[1]
        if ($script:SkipDirs.Contains((ConvertFrom-IoPath $dir.FullName).TrimEnd('\'))) { continue }
        try { $entries = $dir.GetFileSystemInfos() } catch {
            if (-not $quiet) { $script:ScanErrors.Add("Could not read folder: $(ConvertFrom-IoPath $dir.FullName) ($($_.Exception.Message))") }; continue
        }
        foreach ($entry in $entries) {
            $isLink = ($entry.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0
            if ($entry -is [IO.DirectoryInfo]) {
                # OneDrive-style cloud folders are reparse points too but are real folders; only skip true links.
                if ($isLink -and (([int]$entry.Attributes -band $OnlineOnlyMask) -eq 0) -and -not (Test-CloudReparse $entry)) { continue }
                if ($exclude.Contains($entry.Name)) { continue }
                $stack.Push(@($entry, "$prefix/$($entry.Name)"))
            } else {
                if (Test-SkipFile $entry) { continue }
                if ($fileFilter -and -not (& $fileFilter $entry)) { continue }
                Add-FileItem $catKey $entry "$prefix/$($entry.Name)"
            }
        }
    }
}

# Cloud-sync placeholder folders (OneDrive Files On-Demand) carry a reparse
# point but are ordinary folders; junctions and symlinks have a LinkType.
function Test-CloudReparse([IO.DirectoryInfo]$dir) {
    try {
        $item = Get-Item -LiteralPath (ConvertFrom-IoPath $dir.FullName) -Force
        return -not $item.LinkType
    } catch { return $false }
}

function Add-SingleFile($catKey, [string]$path, [string]$zipPath) {
    try {
        $f = New-Object IO.FileInfo (ConvertTo-IoPath $path)
        if ($f.Exists) { Add-FileItem $catKey $f $zipPath }
    } catch { }
}

function Get-SafeName([string]$name) {
    $bad = [IO.Path]::GetInvalidFileNameChars() + [char[]]'/'
    foreach ($c in $bad) { $name = $name.Replace([string]$c, '_') }
    return $name.Trim()
}

# Text the backup writes itself (bookmark exports, reports, README).
function Add-GeneratedFile([string]$zipPath, [string]$text) {
    $script:GeneratedFiles.Add([pscustomobject]@{ ZipPath = $zipPath; Text = $text })
}

# --- Registry access for each user -----------------------------------------
# Other users' settings live in their NTUSER.DAT hive. If they're signed in
# it's already loaded under HKEY_USERS\<SID>; otherwise load it briefly.

function Get-UserRegistryInfo($prof) {
    $info = @{ ShellFolders = @{}; MappedDrives = @(); PstPaths = @(); Programs = @() }
    $hiveRoot = $null; $loadedName = $null
    if (Test-Path -LiteralPath "Registry::HKEY_USERS\$($prof.SID)") {
        $hiveRoot = "Registry::HKEY_USERS\$($prof.SID)"
    } else {
        $hivePath = Join-Path $prof.Path 'NTUSER.DAT'
        if (Test-Path -LiteralPath $hivePath) {
            $loadedName = 'TB_' + ($prof.SID -replace '[^0-9]', '')
            if ((Invoke-Native 'reg.exe' @('load', "HKU\$loadedName", $hivePath)) -eq 0) { $hiveRoot = "Registry::HKEY_USERS\$loadedName" } else { $loadedName = $null }
        }
    }
    if (-not $hiveRoot) { return $info }
    try {
        $usf = "$hiveRoot\Software\Microsoft\Windows\CurrentVersion\Explorer\User Shell Folders"
        if (Test-Path -LiteralPath $usf) {
            $key = Get-Item -LiteralPath $usf
            foreach ($name in $key.GetValueNames()) {
                $raw = $key.GetValue($name, $null, 'DoNotExpandEnvironmentNames')
                if ($raw -is [string]) {
                    $val = $raw -replace '(?i)%USERPROFILE%', $prof.Path
                    $val = $val -replace '(?i)%SystemDrive%', $env:SystemDrive
                    if ($val -notmatch '%') { $info.ShellFolders[$name] = $val }
                }
            }
            $key.Close()
        }
        $net = "$hiveRoot\Network"
        if (Test-Path -LiteralPath $net) {
            foreach ($k in Get-ChildItem -LiteralPath $net) {
                $info.MappedDrives += [pscustomobject]@{ Drive = "$($k.PSChildName):"; Path = $k.GetValue('RemotePath') }
                $k.Close()
            }
        }
        $office = "$hiveRoot\Software\Microsoft\Office"
        if (Test-Path -LiteralPath $office) {
            foreach ($ver in Get-ChildItem -LiteralPath $office -ErrorAction SilentlyContinue) {
                $search = Join-Path $ver.PSPath 'Outlook\Search'
                if (Test-Path -LiteralPath $search) {
                    $sk = Get-Item -LiteralPath $search
                    $info.PstPaths += $sk.GetValueNames() | Where-Object { $_ -like '*.pst' }
                    $sk.Close()
                }
                $ver.Close()
            }
        }
        $uninst = "$hiveRoot\Software\Microsoft\Windows\CurrentVersion\Uninstall"
        if (Test-Path -LiteralPath $uninst) {
            $info.Programs = @(Get-ChildItem -LiteralPath $uninst -ErrorAction SilentlyContinue | ForEach-Object {
                $p = [pscustomobject]@{ Name = $_.GetValue('DisplayName'); Version = $_.GetValue('DisplayVersion'); Publisher = $_.GetValue('Publisher'); Scope = "User: $($prof.Name)" }
                $_.Close(); $p
            } | Where-Object { $_.Name })
        }
    } catch {
        $script:ScanErrors.Add("Registry read for $($prof.Name) was incomplete: $($_.Exception.Message)")
    } finally {
        if ($loadedName) {
            [GC]::Collect(); [GC]::WaitForPendingFinalizers()
            [void](Invoke-Native 'reg.exe' @('unload', "HKU\$loadedName"))
        }
    }
    return $info
}

# --- Outlook AutoComplete ------------------------------------------------------
# The nickname cache (.nk2 / Stream_Autocomplete_*.dat) is a binary format no
# Mac app can read, so pull the email addresses out of it into a CSV and a
# vCard file that Outlook for Mac and Apple Contacts can both import.
function Get-AutoCompleteAddresses([string[]]$files) {
    $found = New-Object 'System.Collections.Generic.HashSet[string]' ([StringComparer]::OrdinalIgnoreCase)
    $rx = [regex]"[A-Za-z0-9._%+'\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,24}"
    foreach ($f in $files) {
        try {
            $bytes = [IO.File]::ReadAllBytes((ConvertTo-IoPath $f))
            $texts = @([Text.Encoding]::Unicode.GetString($bytes), [Text.Encoding]::ASCII.GetString($bytes))
            if ($bytes.Length -gt 1) { $texts += [Text.Encoding]::Unicode.GetString($bytes, 1, $bytes.Length - 1) }
            foreach ($t in $texts) {
                foreach ($m in $rx.Matches($t)) {
                    $addr = $m.Value.Trim('.').ToLower()
                    if ($addr -notmatch '^(sip:|smtp:)' -and $addr.Length -lt 120) { [void]$found.Add($addr) }
                }
            }
        } catch { $script:ScanErrors.Add("Could not read AutoComplete file $f") }
    }
    return @($found | Sort-Object)
}

# --- Chromium bookmarks -> HTML ----------------------------------------------
$script:Json = New-Object System.Web.Script.Serialization.JavaScriptSerializer
$script:Json.MaxJsonLength = [int]::MaxValue

function ConvertTo-HtmlText([string]$s) { return [System.Net.WebUtility]::HtmlEncode($s) }

function ConvertTo-ChromeTime($v) {
    # Chromium stores microseconds since 1601-01-01; bookmark HTML wants Unix seconds.
    try { $n = [long]$v; if ($n -gt 11644473600000000) { return [long](($n - 11644473600000000) / 1000000) } } catch { }
    return 0
}

function Write-BookmarkNode($node, [Text.StringBuilder]$sb, [int]$depth) {
    $pad = '    ' * $depth
    if ($node['type'] -eq 'folder') {
        $sb.AppendLine("$pad<DT><H3 ADD_DATE=`"$(ConvertTo-ChromeTime $node['date_added'])`">$(ConvertTo-HtmlText $node['name'])</H3>") | Out-Null
        $sb.AppendLine("$pad<DL><p>") | Out-Null
        foreach ($child in @($node['children'])) { if ($child) { Write-BookmarkNode $child $sb ($depth + 1) } }
        $sb.AppendLine("$pad</DL><p>") | Out-Null
    } elseif ($node['type'] -eq 'url') {
        $sb.AppendLine("$pad<DT><A HREF=`"$(ConvertTo-HtmlText $node['url'])`" ADD_DATE=`"$(ConvertTo-ChromeTime $node['date_added'])`">$(ConvertTo-HtmlText $node['name'])</A>") | Out-Null
    }
}

function Convert-ChromeBookmarks([string]$path) {
    $data = $script:Json.DeserializeObject([IO.File]::ReadAllText((ConvertTo-IoPath $path), [Text.Encoding]::UTF8))
    $sb = New-Object Text.StringBuilder
    $sb.AppendLine('<!DOCTYPE NETSCAPE-Bookmark-file-1>') | Out-Null
    $sb.AppendLine('<META HTTP-EQUIV="Content-Type" CONTENT="text/html; charset=UTF-8">') | Out-Null
    $sb.AppendLine('<TITLE>Bookmarks</TITLE>') | Out-Null
    $sb.AppendLine('<H1>Bookmarks</H1>') | Out-Null
    $sb.AppendLine('<DL><p>') | Out-Null
    $roots = $data['roots']
    foreach ($rootName in @('bookmark_bar', 'other', 'synced')) {
        if ($roots.ContainsKey($rootName) -and $roots[$rootName]) { Write-BookmarkNode $roots[$rootName] $sb 1 }
    }
    $sb.AppendLine('</DL><p>') | Out-Null
    return $sb.ToString()
}

# =============================================================================
#  1. Who and where
# =============================================================================
Clear-Host
Write-Title "Thagobyte Windows Backup v$TBVersion"
Write-Info 'Packs up your files and settings into a .zip for your new computer.'
Write-Info 'Nothing on this PC is changed or deleted.'

# Programs that lock their data files while open.
$lockers = @(
    @{ Proc = 'OUTLOOK';   Name = 'Outlook (PST files)' },
    @{ Proc = 'thunderbird'; Name = 'Thunderbird' },
    @{ Proc = 'firefox';   Name = 'Firefox' }
)
$running = @($lockers | Where-Object { Get-Process -Name $_.Proc -ErrorAction SilentlyContinue })
if ($running.Count -gt 0) {
    Write-Host ''
    Write-Warn2 "These programs are open and lock their data files: $(($running | ForEach-Object { $_.Name }) -join ', ')"
    if (Read-YesNo 'Close them now? (Save any open work first)' $true) {
        foreach ($r in $running) {
            Get-Process -Name $r.Proc -ErrorAction SilentlyContinue | ForEach-Object { [void]$_.CloseMainWindow() }
        }
        Write-Note 'Waiting for them to close...'
        for ($i = 0; $i -lt 30; $i++) {
            if (-not ($running | Where-Object { Get-Process -Name $_.Proc -ErrorAction SilentlyContinue })) { break }
            Start-Sleep -Seconds 1
        }
        $still = @($running | Where-Object { Get-Process -Name $_.Proc -ErrorAction SilentlyContinue })
        if ($still.Count -gt 0) {
            if (Read-YesNo "$(($still | ForEach-Object { $_.Name }) -join ', ') did not close. Force them closed?" $false) {
                $still | ForEach-Object { Get-Process -Name $_.Proc -ErrorAction SilentlyContinue | Stop-Process -Force }
                Start-Sleep -Seconds 2
            } else {
                Write-Note 'OK -- files they hold open may be skipped (listed in the report).'
            }
        }
    }
}

# --- Profiles ------------------------------------------------------------------
$profiles = @(Get-CimInstance Win32_UserProfile -ErrorAction SilentlyContinue |
    Where-Object { -not $_.Special -and $_.LocalPath -and (Test-Path -LiteralPath $_.LocalPath) -and ($_.LocalPath -like "$env:SystemDrive\Users\*") } |
    ForEach-Object { [pscustomobject]@{ Name = Split-Path $_.LocalPath -Leaf; Path = $_.LocalPath; SID = $_.SID; LastUse = $_.LastUseTime } } |
    Where-Object { $_.Name -notin @('Default', 'Default User', 'Public', 'All Users', 'defaultuser0', 'WDAGUtilityAccount') } |
    Sort-Object Name)

if (-not $isAdmin) {
    $profiles = @($profiles | Where-Object { $_.Path -eq $env:USERPROFILE })
}
if ($profiles.Count -eq 0) {
    $profiles = @([pscustomobject]@{ Name = $env:USERNAME; Path = $env:USERPROFILE; SID = $identity.User.Value; LastUse = Get-Date })
}

Write-Title 'Step 1 of 4: Choose user accounts'
for ($i = 0; $i -lt $profiles.Count; $i++) {
    $p = $profiles[$i]
    $last = if ($p.LastUse) { 'last used ' + ([datetime]$p.LastUse).ToString('yyyy-MM-dd') } else { '' }
    $me = if ($p.Path -eq $env:USERPROFILE) { ' (you)' } else { '' }
    Write-Info ("{0,3}. {1}{2}   {3}" -f ($i + 1), $p.Name, $me, $last)
}
$selected = $profiles
if ($profiles.Count -gt 1) {
    while ($true) {
        $a = (Read-Host '  Numbers to back up, separated by commas (Enter = all)').Trim()
        if ($a -eq '') { break }
        $nums = $a -split '[,\s]+' | Where-Object { $_ -match '^\d+$' } | ForEach-Object { [int]$_ }
        $pick = @($nums | Where-Object { $_ -ge 1 -and $_ -le $profiles.Count } | Select-Object -Unique | ForEach-Object { $profiles[$_ - 1] })
        if ($pick.Count -gt 0) { $selected = $pick; break }
    }
}
Write-Good "Backing up: $(($selected | ForEach-Object { $_.Name }) -join ', ')"

# --- Destination --------------------------------------------------------------
Write-Title 'Step 2 of 4: Choose where to save the backup'
$drives = @(Get-CimInstance Win32_LogicalDisk -ErrorAction SilentlyContinue |
    Where-Object { $_.DriveType -in 2, 3, 4 -and $_.FreeSpace } | Sort-Object DeviceID)
$fixedDriveLetters = @($drives | Where-Object { $_.DriveType -eq 3 } | ForEach-Object { $_.DeviceID })
for ($i = 0; $i -lt $drives.Count; $i++) {
    $d = $drives[$i]
    $kind = switch ($d.DriveType) { 2 { 'USB / removable' } 3 { 'internal' } 4 { 'network' } }
    $label = if ($d.VolumeName) { " `"$($d.VolumeName)`"" } else { '' }
    Write-Info ("{0,3}. {1}{2}  {3}, {4} free, {5}" -f ($i + 1), $d.DeviceID, $label, $kind, (Format-Size $d.FreeSpace), $d.FileSystem)
}
Write-Note 'An external USB drive is best. Choosing C: works too -- copy the zip off afterwards.'
$defaultIdx = 0
$removable = @($drives | Where-Object { $_.DriveType -eq 2 } | Sort-Object FreeSpace -Descending)
if ($removable.Count -gt 0) { $defaultIdx = [array]::IndexOf($drives, $removable[0]) }
elseif ($drives.Count -gt 0) {
    $sys = @($drives | Where-Object { $_.DeviceID -eq $env:SystemDrive })
    if ($sys.Count -gt 0) { $defaultIdx = [array]::IndexOf($drives, $sys[0]) }
}
$destRoot = $null
while (-not $destRoot) {
    $prompt = if ($drives.Count -gt 0) { "  Drive number, or type a folder path (Enter = $($drives[$defaultIdx].DeviceID))" } else { '  Type a folder path' }
    $a = (Read-Host $prompt).Trim().Trim('"')
    if ($a -eq '' -and $drives.Count -gt 0) { $destRoot = $drives[$defaultIdx].DeviceID + '\Thagobyte Backups' }
    elseif ($a -match '^\d+$' -and [int]$a -ge 1 -and [int]$a -le $drives.Count) { $destRoot = $drives[[int]$a - 1].DeviceID + '\Thagobyte Backups' }
    elseif ($a -match '^[A-Za-z]:\\|^\\\\') { $destRoot = $a.TrimEnd('\') }
}
try { New-Item -ItemType Directory -Force -Path $destRoot | Out-Null } catch {
    Write-Warn2 "Could not create $destRoot : $($_.Exception.Message)"; Exit-Backup 1
}
$destRoot = (Resolve-Path -LiteralPath $destRoot).ProviderPath
$destFs = $null; $destFree = $null
$destDriveLetter = if ($destRoot -match '^([A-Za-z]:)') { $Matches[1].ToUpper() } else { $null }
if ($destDriveLetter) {
    $dd = $drives | Where-Object { $_.DeviceID -eq $destDriveLetter } | Select-Object -First 1
    if ($dd) { $destFs = $dd.FileSystem; $destFree = [long]$dd.FreeSpace }
}
Write-Good "Saving to: $destRoot"

# Never back up the backup folder itself.
$script:SkipDirs = New-Object 'System.Collections.Generic.HashSet[string]' ([StringComparer]::OrdinalIgnoreCase)
[void]$script:SkipDirs.Add($destRoot.TrimEnd('\'))

$includeWifi = $false
if ($isAdmin) {
    Write-Host ''
    Write-Info 'Saved Wi-Fi networks and their passwords can be included as a text list'
    Write-Info 'so you can join the same networks on the new computer.'
    Write-Note 'The passwords are stored readable inside the zip -- keep the zip private.'
    $includeWifi = Read-YesNo 'Include Wi-Fi passwords?' $false
}

# =============================================================================
#  2. Scan
# =============================================================================
Write-Title 'Step 3 of 4: Looking for files (this can take a few minutes)'

$computer = $env:COMPUTERNAME
$stamp = Get-Date -Format 'yyyy-MM-dd_HHmm'
$allPrograms = New-Object System.Collections.Generic.List[object]
$mappedReport = New-Object System.Collections.Generic.List[string]
$ostReport = New-Object System.Collections.Generic.List[string]
$pstFromRegistry = New-Object System.Collections.Generic.List[string]
$userCloudRoots = New-Object System.Collections.Generic.List[string]

$ChromiumBrowsers = @(
    @{ Name = 'Google Chrome';  Base = 'Local';   Path = 'Google\Chrome\User Data' },
    @{ Name = 'Microsoft Edge'; Base = 'Local';   Path = 'Microsoft\Edge\User Data' },
    @{ Name = 'Brave';          Base = 'Local';   Path = 'BraveSoftware\Brave-Browser\User Data' },
    @{ Name = 'Vivaldi';        Base = 'Local';   Path = 'Vivaldi\User Data' },
    @{ Name = 'Opera';          Base = 'Roaming'; Path = 'Opera Software' }
)

$KnownFolderMap = [ordered]@{
    desktop   = @{ Reg = 'Desktop';  Default = 'Desktop';   Zip = 'Desktop' }
    documents = @{ Reg = 'Personal'; Default = 'Documents'; Zip = 'Documents' }
    downloads = @{ Reg = '{374DE290-123F-4565-9164-39C4925E467B}'; Default = 'Downloads'; Zip = 'Downloads' }
    pictures  = @{ Reg = 'My Pictures'; Default = 'Pictures'; Zip = 'Pictures' }
    music     = @{ Reg = 'My Music'; Default = 'Music';     Zip = 'Music' }
    videos    = @{ Reg = 'My Video'; Default = 'Videos';    Zip = 'Videos' }
}

# Profile folders that are handled elsewhere or are just application caches.
$ProfileSkip = @('AppData', 'Application Data', 'Local Settings', 'Cookies', 'NetHood', 'PrintHood', 'Recent',
    'SendTo', 'Start Menu', 'Templates', 'My Documents', 'Searches', 'IntelGraphicsProfiles', 'MicrosoftEdgeBackups',
    'Desktop', 'Documents', 'Downloads', 'Pictures', 'Music', 'Videos', 'Favorites', 'Links', 'Contacts', 'Saved Games',
    '.cache', '.nuget', '.gradle', '.m2', '.npm', '.cargo', '.rustup', '.conda', '.android', '.vscode', '.vscode-server',
    '.docker', '.dotnet', '.templateengine', '.ms-ad', '.pyenv', '.thumbnails', 'node_modules', 'ansel', 'Tracing',
    'Apple', 'iCloudDrive', 'iCloud Drive', 'iCloudPhotos', 'Dropbox', 'Google Drive', 'My Drive', 'Box', 'Box Sync', 'Creative Cloud Files')

foreach ($prof in $selected) {
    $u = Get-SafeName $prof.Name
    $zu = "Users/$u"
    Write-Info "Scanning $($prof.Name)..."
    $reg = Get-UserRegistryInfo $prof
    $appRoam = Join-Path $prof.Path 'AppData\Roaming'
    $appLocal = Join-Path $prof.Path 'AppData\Local'

    foreach ($p in $reg.Programs) { $allPrograms.Add($p) }
    foreach ($m in $reg.MappedDrives) { $mappedReport.Add("$($prof.Name): $($m.Drive) -> $($m.Path)") }
    foreach ($pst in $reg.PstPaths) { $pstFromRegistry.Add($pst) }

    # Cloud folders: anything under the profile named OneDrive*, Dropbox, etc.
    $cloudDirs = @(Get-ChildItem -LiteralPath $prof.Path -Directory -Force -ErrorAction SilentlyContinue |
        Where-Object { $_.Name -like 'OneDrive*' -or $_.Name -in @('Dropbox', 'Google Drive', 'My Drive', 'iCloudDrive', 'iCloud Drive', 'iCloudPhotos', 'Box', 'Box Sync', 'Creative Cloud Files') })
    foreach ($c in $cloudDirs) { $userCloudRoots.Add($c.FullName) }

    # 1) Outlook first, so PSTs saved inside Documents are filed under Outlook.
    $zo = "$zu/Outlook"
    $docsPath = if ($reg.ShellFolders['Personal']) { $reg.ShellFolders['Personal'] } else { Join-Path $prof.Path 'Documents' }
    $pstFilter = { param($f) $f.Extension -in @('.pst', '.nk2') }
    Add-Folder 'outlook' (Join-Path $docsPath 'Outlook Files') "$zo/Data Files (PST)" -fileFilter $pstFilter
    Add-Folder 'outlook' (Join-Path $appLocal 'Microsoft\Outlook') "$zo/Data Files (PST)" -excludeDirs @('RoamCache', 'Offline Address Books') -fileFilter $pstFilter
    Add-Folder 'outlook' (Join-Path $appLocal 'Microsoft\Outlook\RoamCache') "$zo/AutoComplete" -fileFilter { param($f) $f.Name -like 'Stream_Autocomplete*' }
    Add-Folder 'outlook' (Join-Path $appRoam 'Microsoft\Outlook') "$zo/Settings" -fileFilter { param($f) $f.Extension -in @('.nk2', '.rwz', '.otm', '.xml', '.srs', '.dat', '.oft', '.pst') }
    Add-Folder 'outlook' $prof.Path "$zo/Data Files (PST)/Found in profile" -fileFilter $pstFilter -quiet
    Add-Folder 'outlook' (Join-Path $appRoam 'Microsoft\Signatures') "$zo/Signatures"
    Add-Folder 'outlook' (Join-Path $appRoam 'Microsoft\Stationery') "$zo/Stationery"
    Add-Folder 'outlook' (Join-Path $appRoam 'Microsoft\Templates') "$zo/Templates (.oft)" -fileFilter { param($f) $f.Extension -eq '.oft' }
    Get-ChildItem -LiteralPath (Join-Path $appLocal 'Microsoft\Outlook') -Filter '*.ost' -Force -ErrorAction SilentlyContinue |
        ForEach-Object { $ostReport.Add("$($prof.Name): $($_.FullName) ($(Format-Size $_.Length))") }

    # AutoComplete -> readable address list
    $acFiles = @($script:Categories['outlook'].Items | Where-Object { $_.ZipPath.StartsWith("$zu/") -and ($_.ZipPath -like '*/AutoComplete/*' -or $_.ZipPath -like '*.nk2') } | ForEach-Object { $_.Source })
    if ($acFiles.Count -gt 0) {
        $addrs = Get-AutoCompleteAddresses $acFiles
        if ($addrs.Count -gt 0) {
            Add-GeneratedFile "$zo/AutoComplete/AutoComplete Addresses.csv" ("Email Address`r`n" + (($addrs | ForEach-Object { "`"$_`"" }) -join "`r`n"))
            $vcf = New-Object Text.StringBuilder
            foreach ($a in $addrs) {
                $vcf.Append("BEGIN:VCARD`r`nVERSION:3.0`r`nFN:$a`r`nN:;;;;`r`nEMAIL;TYPE=INTERNET:$a`r`nNOTE:From Outlook AutoComplete`r`nEND:VCARD`r`n") | Out-Null
            }
            Add-GeneratedFile "$zo/AutoComplete/AutoComplete Addresses.vcf" $vcf.ToString()
        }
    }

    # 2) Known folders (following redirection to OneDrive or other drives)
    foreach ($k in $KnownFolderMap.Keys) {
        $kf = $KnownFolderMap[$k]
        $path = $reg.ShellFolders[$kf.Reg]
        if (-not $path) { $path = Join-Path $prof.Path $kf.Default }
        Add-Folder $k $path "$zu/$($kf.Zip)" -excludeDirs @('My Music', 'My Pictures', 'My Videos')
        # Also catch a leftover un-redirected copy of the folder in the profile.
        $plainPath = Join-Path $prof.Path $kf.Default
        if ($plainPath -ne $path) { Add-Folder $k $plainPath "$zu/$($kf.Zip) (local)" }
    }

    # 3) Misc profile folders
    $favPath = if ($reg.ShellFolders['Favorites']) { $reg.ShellFolders['Favorites'] } else { Join-Path $prof.Path 'Favorites' }
    Add-Folder 'misc' $favPath "$zu/Favorites"
    foreach ($f in @('Links', 'Contacts', 'Saved Games')) { Add-Folder 'misc' (Join-Path $prof.Path $f) "$zu/$f" }

    # 4) Browsers
    $zb = "$zu/Browsers"
    foreach ($b in $ChromiumBrowsers) {
        $base = if ($b.Base -eq 'Local') { $appLocal } else { $appRoam }
        $udata = Join-Path $base $b.Path
        if (-not (Test-Path -LiteralPath $udata)) { continue }
        $names = @{}
        try {
            $ls = $script:Json.DeserializeObject([IO.File]::ReadAllText((Join-Path $udata 'Local State'), [Text.Encoding]::UTF8))
            $cache = $ls['profile']['info_cache']
            foreach ($key in $cache.Keys) { $names[$key] = $cache[$key]['name'] }
        } catch { }
        foreach ($bm in Get-ChildItem -LiteralPath $udata -Recurse -Depth 1 -Filter 'Bookmarks' -File -Force -ErrorAction SilentlyContinue) {
            $pdir = $bm.Directory.Name
            $pname = if ($names[$pdir]) { "$($names[$pdir]) ($pdir)" } else { $pdir }
            $zdir = "$zb/$($b.Name)/$(Get-SafeName $pname)"
            Add-SingleFile 'browsers' $bm.FullName "$zdir/Bookmarks (raw).json"
            try {
                Add-GeneratedFile "$zdir/Bookmarks - import this.html" (Convert-ChromeBookmarks $bm.FullName)
            } catch { $script:ScanErrors.Add("Could not convert $($b.Name) bookmarks for $($prof.Name): $($_.Exception.Message)") }
        }
    }
    $mozCacheDirs = @('cache2', 'startupCache', 'thumbnails', 'crashes', 'minidumps', 'datareporting', 'saved-telemetry-pings',
        'shader-cache', 'jumpListCache', 'OfflineCache', 'Crash Reports', 'Pending Pings', 'safebrowsing')
    Add-Folder 'browsers' (Join-Path $appRoam 'Mozilla\Firefox') "$zb/Firefox" -excludeDirs $mozCacheDirs
    Add-Folder 'browsers' (Join-Path $appRoam 'Thunderbird') "$zu/Thunderbird" -excludeDirs $mozCacheDirs

    # 5) Office customizations
    $zf = "$zu/Office"
    Add-Folder 'office' (Join-Path $appRoam 'Microsoft\Templates') "$zf/Templates" -excludeDirs @('LiveContent')
    Add-Folder 'office' (Join-Path $appRoam 'Microsoft\UProof') "$zf/Custom Dictionaries"
    Add-Folder 'office' (Join-Path $appRoam 'Microsoft\Proof') "$zf/Custom Dictionaries (older Office)"
    Add-Folder 'office' (Join-Path $appRoam 'Microsoft\Document Building Blocks') "$zf/Quick Parts (Building Blocks)"
    Add-Folder 'office' (Join-Path $appRoam 'Microsoft\Excel\XLSTART') "$zf/Excel Startup (XLSTART)"
    Add-Folder 'office' (Join-Path $appRoam 'Microsoft\Word\STARTUP') "$zf/Word Startup"
    Add-Folder 'office' (Join-Path $appRoam 'Microsoft\AddIns') "$zf/Add-ins"
    Add-Folder 'office' (Join-Path $appRoam 'Microsoft\QuickStyles') "$zf/Quick Styles"

    # 6) Fonts, Sticky Notes, wallpaper
    $zp = "$zu/Personal Settings"
    Add-Folder 'personal' (Join-Path $appLocal 'Microsoft\Windows\Fonts') "$zp/Fonts"
    Add-Folder 'personal' (Join-Path $appLocal 'Packages\Microsoft.MicrosoftStickyNotes_8wekyb3d8bbwe\LocalState') "$zp/Sticky Notes"
    Add-Folder 'personal' (Join-Path $appRoam 'Microsoft\Sticky Notes') "$zp/Sticky Notes (Windows 7)"
    Add-SingleFile 'personal' (Join-Path $appRoam 'Microsoft\Windows\Themes\TranscodedWallpaper') "$zp/Wallpaper/Current Wallpaper.jpg"
    Add-Folder 'personal' (Join-Path $appRoam 'Microsoft\Windows\Themes\CachedFiles') "$zp/Wallpaper"

    # 7) iPhone / iPad backups (iTunes and the Apple Devices app)
    Add-Folder 'iphone' (Join-Path $appRoam 'Apple Computer\MobileSync\Backup') "$zu/iPhone Backups"
    Add-Folder 'iphone' (Join-Path $prof.Path 'Apple\MobileSync\Backup') "$zu/iPhone Backups"

    # 8) Cloud folders
    foreach ($c in $cloudDirs) { Add-Folder 'cloud' $c.FullName "$zu/Cloud Folders/$(Get-SafeName $c.Name)" }

    # 9) Everything else saved directly in the profile
    foreach ($item in Get-ChildItem -LiteralPath $prof.Path -Force -ErrorAction SilentlyContinue) {
        if ($item.Name -in $ProfileSkip -or $item.Name -like 'OneDrive*') { continue }
        if ($item.PSIsContainer) {
            if ($item.LinkType) { continue }
            Add-Folder 'profile' $item.FullName "$zu/Other Profile Folders/$($item.Name)"
        } else {
            if (Test-SkipFile $item) { continue }
            Add-SingleFile 'profile' $item.FullName "$zu/Other Profile Folders/$($item.Name)"
        }
    }
}

# --- Drive-wide search: PST files and extra data folders ------------------------
$SystemRootNames = @('Windows', 'Windows.old', 'Program Files', 'Program Files (x86)', 'ProgramData', 'Users',
    '$Recycle.Bin', 'System Volume Information', 'Recovery', 'PerfLogs', 'MSOCache', 'Intel', 'AMD', 'NVIDIA',
    'Drivers', 'Dell', 'HP', 'SWSetup', 'Lenovo', 'OEM', 'ESD', 'inetpub', 'Config.Msi', 'Documents and Settings',
    '$WinREAgent', '$Windows.~BT', '$Windows.~WS', '$SysReset', '$GetCurrent', 'OneDriveTemp', 'WindowsApps',
    'XboxGames', 'SteamLibrary', 'Program Files (Arm)', 'Boot', 'Temp', 'tmp', 'Thagobyte Backups', '$AV_ASW', 'found.000')

Write-Info 'Searching all internal drives for Outlook data files (.pst)...'
$pstSearch = { param($f) $f.Extension -in @('.pst', '.nk2') }
foreach ($dl in $fixedDriveLetters) {
    $rootDir = "$dl\"
    foreach ($top in Get-ChildItem -LiteralPath $rootDir -Directory -Force -ErrorAction SilentlyContinue) {
        if ($top.Name -in @('Windows', 'Users', 'ProgramData', '$Recycle.Bin', 'System Volume Information', 'Program Files', 'Program Files (x86)', 'Windows.old', '$WinREAgent', 'Recovery')) { continue }
        if ($top.LinkType) { continue }
        Add-Folder 'outlook' $top.FullName "Found Elsewhere/Outlook Files/$($dl.TrimEnd(':'))/$($top.Name)" -fileFilter $pstSearch -quiet
    }
}
foreach ($pst in $pstFromRegistry | Select-Object -Unique) {
    $leaf = Split-Path $pst -Leaf
    Add-SingleFile 'outlook' $pst "Found Elsewhere/Outlook Files/From Outlook settings/$(Get-SafeName $leaf)"
}

Write-Info 'Looking for data folders outside the user profiles...'
foreach ($dl in $fixedDriveLetters) {
    foreach ($top in Get-ChildItem -LiteralPath "$dl\" -Force -ErrorAction SilentlyContinue) {
        if ($top.Name -in $SystemRootNames -or $top.Name.StartsWith('$')) { continue }
        if ($script:SkipDirs.Contains($top.FullName.TrimEnd('\'))) { continue }
        if ($top.PSIsContainer) {
            if ($top.LinkType) { continue }
            Add-Folder 'extra' $top.FullName "Found Elsewhere/$($dl.TrimEnd(':')) drive/$($top.Name)"
        } elseif ($top.Extension -notin @('.sys', '.log', '.bin', '.ini', '.dat', '.tmp') -and -not $top.Attributes.HasFlag([IO.FileAttributes]::Hidden)) {
            Add-SingleFile 'extra' $top.FullName "Found Elsewhere/$($dl.TrimEnd(':')) drive/$($top.Name)"
        }
    }
}

# --- System inventory --------------------------------------------------------
Write-Info 'Recording installed programs, printers and network settings...'
$uninstallKeys = @('HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall', 'HKLM:\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall')
foreach ($k in $uninstallKeys) {
    Get-ItemProperty -Path "$k\*" -ErrorAction SilentlyContinue | Where-Object { $_.DisplayName -and -not $_.SystemComponent -and -not $_.ParentKeyName } | ForEach-Object {
        $allPrograms.Add([pscustomobject]@{ Name = $_.DisplayName; Version = $_.DisplayVersion; Publisher = $_.Publisher; Scope = 'All users' })
    }
}
$programs = @($allPrograms | Sort-Object Name, Version -Unique)
$progCsv = ($programs | Select-Object Name, Version, Publisher, Scope | ConvertTo-Csv -NoTypeInformation) -join "`r`n"
Add-GeneratedFile 'System Info/Installed Programs.csv' $progCsv
Add-GeneratedFile 'System Info/Installed Programs.txt' ((
    "Programs installed on $computer (reinstall the ones you need on the new computer)`r`n" + ('-' * 70) + "`r`n" +
    (($programs | ForEach-Object { $v = if ($_.Version) { "  ($($_.Version))" } else { '' }; "$($_.Name)$v" }) -join "`r`n")))

$storeApps = @()
try {
    $storeApps = @(Get-AppxPackage -AllUsers -ErrorAction Stop | Where-Object { $_.SignatureKind -eq 'Store' -and -not $_.IsFramework } |
        Sort-Object Name -Unique | ForEach-Object { $_.Name })
} catch { }
if ($storeApps.Count) { Add-GeneratedFile 'System Info/Microsoft Store Apps.txt' ($storeApps -join "`r`n") }

$printerText = try {
    (Get-Printer -ErrorAction Stop | Sort-Object Name | ForEach-Object { "$($_.Name)`r`n    Driver: $($_.DriverName)`r`n    Port:   $($_.PortName)" }) -join "`r`n"
} catch { 'Printer list unavailable.' }
Add-GeneratedFile 'System Info/Printers.txt' $printerText
if ($mappedReport.Count) { Add-GeneratedFile 'System Info/Mapped Network Drives.txt' ($mappedReport -join "`r`n") }

if ($includeWifi) {
    $wifiDir = Join-Path $env:TEMP "tb-wifi-$([guid]::NewGuid().ToString('N'))"
    New-Item -ItemType Directory -Path $wifiDir | Out-Null
    try {
        [void](Invoke-Native 'netsh.exe' @('wlan', 'export', 'profile', 'key=clear', "folder=$wifiDir"))
        $lines = @()
        foreach ($x in Get-ChildItem -LiteralPath $wifiDir -Filter '*.xml') {
            try {
                [xml]$doc = Get-Content -LiteralPath $x.FullName -Raw
                $ssid = $doc.WLANProfile.SSIDConfig.SSID.name
                $key = $doc.WLANProfile.MSM.security.sharedKey.keyMaterial
                $auth = $doc.WLANProfile.MSM.security.authEncryption.authentication
                $lines += "Network:  $ssid`r`nPassword: $(if ($key) { $key } else { '(none / enterprise login)' })`r`nSecurity: $auth`r`n"
                Add-GeneratedFile "System Info/Wi-Fi/Windows profiles/$($x.Name)" (Get-Content -LiteralPath $x.FullName -Raw)
            } catch { }
        }
        if ($lines.Count) { Add-GeneratedFile 'System Info/Wi-Fi/Wi-Fi Passwords.txt' ($lines -join "`r`n") }
    } finally { Remove-Item -LiteralPath $wifiDir -Recurse -Force -ErrorAction SilentlyContinue }
}

# =============================================================================
#  3. Review and confirm
# =============================================================================
$keys = @($script:Categories.Keys)
while ($true) {
    Write-Title 'Step 4 of 4: Review what will be backed up'
    $total = [long]0; $count = 0
    for ($i = 0; $i -lt $keys.Count; $i++) {
        $c = $script:Categories[$keys[$i]]
        $mark = if ($c.Enabled) { '[x]' } else { '[ ]' }
        $color = if ($c.Enabled) { 'White' } else { 'DarkGray' }
        $line = "{0,3}. {1} {2,-58} {3,10}" -f ($i + 1), $mark, $c.Label, (Format-Size $c.Bytes)
        if ($c.Items.Count -eq 0) { $line = "{0,3}. {1} {2,-58} {3,10}" -f ($i + 1), $mark, $c.Label, 'none found' }
        Write-Host "  $line" -ForegroundColor $color
        if ($c.Description) { Write-Host "            $($c.Description)" -ForegroundColor DarkGray }
        if ($c.Enabled) { $total += $c.Bytes; $count += $c.Items.Count }
    }
    $cloudCount = 0; $cloudBytes = [long]0
    foreach ($v in $script:CloudOnly.Values) { $cloudCount += $v[0]; $cloudBytes += $v[1] }
    Write-Host ''
    Write-Host ("  Total: {0:N0} files, {1} before compression" -f $count, (Format-Size $total)) -ForegroundColor Cyan
    if ($cloudCount) { Write-Note ("{0:N0} online-only cloud files ({1}) are skipped -- they stay in the cloud." -f $cloudCount, (Format-Size $cloudBytes)) }
    if ($destFree -and $total -gt $destFree) { Write-Warn2 "The destination only has $(Format-Size $destFree) free. The zip is usually smaller, but it may not fit." }
    Write-Host ''
    $a = (Read-Host '  Type a number to switch a category on/off, or press Enter to start').Trim()
    if ($a -eq '') { break }
    if ($a -match '^\d+$' -and [int]$a -ge 1 -and [int]$a -le $keys.Count) {
        $c = $script:Categories[$keys[[int]$a - 1]]; $c.Enabled = -not $c.Enabled
    }
}

# =============================================================================
#  4. Write the zip
# =============================================================================
$items = New-Object System.Collections.Generic.List[object]
foreach ($c in $script:Categories.Values) { if ($c.Enabled) { $items.AddRange($c.Items) } }
$totalBytes = [long]0; foreach ($it in $items) { $totalBytes += $it.Length }

# FAT32 drives can't hold files over 4 GB, so split into parts that fit.
$partLimit = [long]::MaxValue
if ($destFs -eq 'FAT32') {
    $partLimit = [long]3.5GB
    Write-Warn2 'The destination drive is FAT32 (4 GB file limit) -- the backup will be split into several zip files.'
}

$baseName = "Thagobyte-Backup_${computer}_$stamp"
$rootFolder = "Thagobyte Backup - $computer"
$failed = New-Object System.Collections.Generic.List[string]
$tooBig = New-Object System.Collections.Generic.List[string]
$zipFiles = New-Object System.Collections.Generic.List[string]
$script:zip = $null; $script:zipStream = $null; $script:partBytes = [long]0; $script:partNo = 0
$usedNames = New-Object 'System.Collections.Generic.HashSet[string]' ([StringComparer]::OrdinalIgnoreCase)
$minDate = New-Object DateTime 1980, 1, 2
$maxDate = New-Object DateTime 2107, 12, 30

function Open-Part {
    if ($script:zip) { $script:zip.Dispose(); $script:zipStream.Dispose() }
    $script:partNo++
    $name = if ($partLimit -eq [long]::MaxValue) { "$baseName.zip" } else { "${baseName}_Part$($script:partNo).zip" }
    $path = Join-Path $destRoot $name
    $script:zipStream = New-Object IO.FileStream $path, ([IO.FileMode]::Create), ([IO.FileAccess]::ReadWrite), ([IO.FileShare]::None)
    $script:zip = New-Object IO.Compression.ZipArchive $script:zipStream, ([IO.Compression.ZipArchiveMode]::Create), $false, ([Text.Encoding]::UTF8)
    $script:partBytes = 0
    $zipFiles.Add($path)
}

function Get-UniqueEntryName([string]$name) {
    if ($usedNames.Add($name)) { return $name }
    $dot = $name.LastIndexOf('.'); $slash = $name.LastIndexOf('/')
    if ($dot -le $slash) { $dot = $name.Length }
    for ($n = 2; ; $n++) {
        $try = $name.Substring(0, $dot) + " ($n)" + $name.Substring($dot)
        if ($usedNames.Add($try)) { return $try }
    }
}

function Add-TextEntry([string]$zipPath, [string]$text) {
    $entry = $script:zip.CreateEntry((Get-UniqueEntryName "$rootFolder/$zipPath"), [IO.Compression.CompressionLevel]::Optimal)
    $w = New-Object IO.StreamWriter ($entry.Open()), (New-Object Text.UTF8Encoding $true)
    try { $w.Write($text) } finally { $w.Dispose() }
}

Write-Title 'Creating the backup'
Write-Note 'Leave this window open. Large backups can take a while.'
$started = Get-Date
$done = [long]0; $lastUpdate = [DateTime]::MinValue
$buffer = New-Object byte[] (1MB)
Open-Part
try {
    for ($i = 0; $i -lt $items.Count; $i++) {
        $it = $items[$i]
        if ($partLimit -ne [long]::MaxValue -and $it.Length -ge 4GB) { $tooBig.Add("$($it.Display) ($(Format-Size $it.Length))"); continue }
        if ($script:partBytes -gt 0 -and ($script:partBytes + $it.Length) -gt $partLimit) { Open-Part }

        $now = Get-Date
        if (($now - $lastUpdate).TotalMilliseconds -gt 300) {
            $pct = if ($totalBytes -gt 0) { [int](100 * $done / $totalBytes) } else { 100 }
            $elapsed = ($now - $started).TotalSeconds
            $eta = if ($done -gt 0 -and $elapsed -gt 5) { ' -- about ' + [TimeSpan]::FromSeconds([int]($elapsed * ($totalBytes - $done) / $done)).ToString() + ' left' } else { '' }
            Write-Progress -Activity 'Backing up' -Status ("{0} of {1}{2}" -f (Format-Size $done), (Format-Size $totalBytes), $eta) -CurrentOperation $it.Display -PercentComplete ([Math]::Min(100, $pct))
            $lastUpdate = $now
        }

        $level = if ($CompressedExtensions.Contains([IO.Path]::GetExtension($it.ZipPath))) { [IO.Compression.CompressionLevel]::NoCompression } else { [IO.Compression.CompressionLevel]::Fastest }
        $src = $null
        try {
            # ReadWrite sharing lets us read files another program still has open.
            $src = New-Object IO.FileStream (ConvertTo-IoPath $it.Source), ([IO.FileMode]::Open), ([IO.FileAccess]::Read), ([IO.FileShare]::ReadWrite -bor [IO.FileShare]::Delete), 1048576
        } catch {
            $e = $_.Exception; while ($e.InnerException) { $e = $e.InnerException }
            $failed.Add("$($it.Display) -- $($e.Message)")
            $done += $it.Length; continue
        }
        try {
            $entry = $script:zip.CreateEntry((Get-UniqueEntryName "$rootFolder/$($it.ZipPath)"), $level)
            $t = $it.Time; if ($t -lt $minDate) { $t = $minDate } elseif ($t -gt $maxDate) { $t = $maxDate }
            $entry.LastWriteTime = $t
            $dst = $entry.Open()
            try {
                while (($n = $src.Read($buffer, 0, $buffer.Length)) -gt 0) { $dst.Write($buffer, 0, $n) }
            } finally { $dst.Dispose() }
            $script:partBytes += $it.Length
        } catch {
            $failed.Add("$($it.Display) -- $($_.Exception.Message)")
            if ($_.Exception -is [IO.IOException] -and $_.Exception.HResult -eq -2147024784) {  # disk full
                Write-Warn2 'The destination drive is full. Stopping.'
                break
            }
        } finally { $src.Dispose() }
        $done += $it.Length
    }
    Write-Progress -Activity 'Backing up' -Completed

    # --- Generated files, README and report go in the last part ---
    foreach ($g in $script:GeneratedFiles) { Add-TextEntry $g.ZipPath $g.Text }

    $enabled = @($script:Categories.Values | Where-Object { $_.Enabled })
    $r = New-Object Text.StringBuilder
    [void]$r.AppendLine("Thagobyte Windows Backup v$TBVersion -- report")
    [void]$r.AppendLine(('=' * 70))
    [void]$r.AppendLine("Computer:    $computer")
    [void]$r.AppendLine("Windows:     $((Get-CimInstance Win32_OperatingSystem -ErrorAction SilentlyContinue).Caption)")
    [void]$r.AppendLine("Created:     $(Get-Date -Format 'yyyy-MM-dd HH:mm')")
    [void]$r.AppendLine("Users:       $(($selected | ForEach-Object { $_.Name }) -join ', ')")
    [void]$r.AppendLine("Zip files:   $(($zipFiles | ForEach-Object { Split-Path $_ -Leaf }) -join ', ')")
    [void]$r.AppendLine('')
    [void]$r.AppendLine('Included')
    [void]$r.AppendLine(('-' * 70))
    foreach ($c in $enabled) { [void]$r.AppendLine(("  {0,-58} {1,6:N0} files  {2}" -f $c.Label, $c.Items.Count, (Format-Size $c.Bytes))) }
    [void]$r.AppendLine('')
    [void]$r.AppendLine('Left out')
    [void]$r.AppendLine(('-' * 70))
    foreach ($c in @($script:Categories.Values | Where-Object { -not $_.Enabled -and $_.Items.Count })) {
        [void]$r.AppendLine(("  {0,-58} {1,6:N0} files  {2}" -f $c.Label, $c.Items.Count, (Format-Size $c.Bytes)))
    }
    if ($script:CloudOnly.Count) {
        $cc = 0; $cb = [long]0; foreach ($v in $script:CloudOnly.Values) { $cc += $v[0]; $cb += $v[1] }
        [void]$r.AppendLine(("  Online-only cloud files (not downloaded on this PC): {0:N0} files, {1}" -f $cc, (Format-Size $cb)))
        [void]$r.AppendLine('    These are safe in OneDrive/iCloud/etc. -- sign in on the new computer to get them.')
    }
    if ($ostReport.Count) {
        [void]$r.AppendLine('')
        [void]$r.AppendLine('Outlook .ost files (NOT backed up)')
        [void]$r.AppendLine(('-' * 70))
        [void]$r.AppendLine('  An .ost is a cached copy of a mailbox that lives on a mail server (Microsoft 365,')
        [void]$r.AppendLine('  Exchange, Outlook.com, IMAP). It re-downloads when you add the account on the new')
        [void]$r.AppendLine('  computer and cannot be opened there. If one of these accounts no longer exists on')
        [void]$r.AppendLine('  the server, export it from Outlook first: File > Open & Export > Import/Export >')
        [void]$r.AppendLine('  Export to a file > Outlook Data File (.pst), then run this backup again.')
        foreach ($o in $ostReport) { [void]$r.AppendLine("    $o") }
    }
    if ($failed.Count) {
        [void]$r.AppendLine('')
        [void]$r.AppendLine("Files that could not be read ($($failed.Count))")
        [void]$r.AppendLine(('-' * 70))
        [void]$r.AppendLine('  Usually because a program had them locked. Close it and run the backup again,')
        [void]$r.AppendLine('  or copy these by hand.')
        foreach ($f in $failed) { [void]$r.AppendLine("    $f") }
    }
    if ($tooBig.Count) {
        [void]$r.AppendLine('')
        [void]$r.AppendLine('Files over 4 GB skipped (the destination drive is FAT32)')
        [void]$r.AppendLine(('-' * 70))
        foreach ($f in $tooBig) { [void]$r.AppendLine("    $f") }
    }
    if ($script:ScanErrors.Count) {
        [void]$r.AppendLine('')
        [void]$r.AppendLine('Folders that could not be searched')
        [void]$r.AppendLine(('-' * 70))
        foreach ($f in $script:ScanErrors | Select-Object -Unique) { [void]$r.AppendLine("    $f") }
    }
    $reportText = $r.ToString()
    Add-TextEntry 'Backup Report.txt' $reportText

    $readme = @"
THAGOBYTE WINDOWS BACKUP -- HOW TO RESTORE
==========================================
Made on $computer, $(Get-Date -Format 'yyyy-MM-dd'). See "Backup Report.txt" for exactly what is inside.
More help: https://thagobyte.com/windows-backup.html

UNZIPPING ON A MAC
  Double-click the .zip. If the Archive Utility gives an error (large backups
  sometimes do), open Terminal and run:
      ditto -x -k ~/Downloads/<name of the zip>.zip ~/Desktop/
  If the backup came in several _Part zips, unzip all of them -- together they
  make up one "Thagobyte Backup" folder.

YOUR FILES  (Users/<name>/...)
  Desktop, Documents, Downloads, Pictures, Music, Videos: drag the contents of
  each into the matching folder in your Mac's home folder (Finder > Go > Home).
  Pictures: to get them into the Photos app, use File > Import in Photos.
  Music: in the Music app, File > Import.
  Folders ending in "(local)" were left behind in the profile after Windows
  moved that folder to OneDrive or another drive.

OUTLOOK  (Users/<name>/Outlook and Found Elsewhere/Outlook Files)
  Data Files (PST):  Outlook for Mac > File > Import > "Outlook for Windows
      archive file (.pst)". If you don't see Import, turn off "New Outlook"
      (Outlook menu > Legacy Outlook), import, then switch back if you like.
      Microsoft 365 / Exchange / Outlook.com mail is on the server already --
      just sign in; you only need to import PSTs (archives, POP accounts).
  AutoComplete:  Outlook for Mac can't read the Windows AutoComplete
      (nickname / .nk2) file, so the addresses in it were saved to
      "AutoComplete Addresses.csv" (to read) and ".vcf" (to import).
      Importing the .vcf into Outlook for Mac (File > Import) or Apple
      Contacts makes those addresses auto-complete again. The original
      Stream_Autocomplete / .nk2 files are kept for a Windows computer.
  Signatures:  open each .htm file in a browser, copy, and paste it into
      Outlook > Settings > Signatures.
  Rules (.rwz), macros (VbaProject.OTM), templates (.oft): Windows Outlook
      only. Recreate rules by hand on a Mac (the .rwz can be imported by
      Outlook on Windows: Rules > Manage Rules > Options > Import).

BROWSERS  (Users/<name>/Browsers)
  Chrome / Edge / Brave / Vivaldi / Opera: each profile has a
      "Bookmarks - import this.html".
      Safari:  File > Import From > Bookmarks HTML File.
      Chrome:  Bookmarks > Bookmark manager > (three dots) > Import bookmarks.
      Firefox: Bookmarks > Manage bookmarks > Import and Backup > Import Bookmarks from HTML.
      Saved passwords are locked to Windows and can't be moved this way --
      turn on browser sync (or export passwords from the browser's password
      settings) before you retire this PC.
  Firefox: the folder is a complete Firefox profile (bookmarks, passwords,
      history, extensions). On the Mac, quit Firefox, open
      ~/Library/Application Support/Firefox/Profiles/, and copy the contents of
      the backed-up profile folder (Firefox/Profiles/xxxx.default-release) over
      the Mac's own *.default-release folder.
  Thunderbird: same idea -- ~/Library/Thunderbird/Profiles/.

OFFICE  (Users/<name>/Office)
  Templates (.dotx/.dotm/.xltx/.potx): Word for Mac > File > New from Template,
      or copy into ~/Library/Group Containers/UBF8T346G9.Office/User Content/Templates
  Custom dictionaries (CUSTOM.DIC): Word > Preferences > Spelling & Grammar >
      Dictionaries > Add.

PERSONAL SETTINGS  (Users/<name>/Personal Settings)
  Fonts: double-click a font file and click Install (Font Book).
  Wallpaper: right-click the image > Set Desktop Picture.
  Sticky Notes: if you sign in to Sticky Notes with a Microsoft account, your
      notes are already in OneNote and Outlook on the web. Otherwise read them
      on a Mac with Terminal:
          sqlite3 "plum.sqlite" "select Text from Note"

IPHONE / IPAD BACKUPS  (Users/<name>/iPhone Backups)
  Copy each backup folder into ~/Library/Application Support/MobileSync/Backup/
  (Finder > Go > Go to Folder... and paste that path). Then restore from
  Finder when the iPhone is connected.

SYSTEM INFO
  Installed Programs: a checklist of what to reinstall (Mac versions exist for
      most of these, e.g. Microsoft Office, Chrome, Zoom).
  Printers / Mapped Network Drives: what to set up again.
      Mac: System Settings > Printers & Scanners;  Finder > Go > Connect to Server
      (type smb://server/share for a \\server\share path).
  Wi-Fi: network names and passwords, if you chose to include them.

RESTORING ON ANOTHER WINDOWS PC
  The same folders apply: copy files back into the user's folders, double-click
  PSTs in Outlook (File > Open & Export > Open Outlook Data File), put
  Stream_Autocomplete*.dat files back in %LOCALAPPDATA%\Microsoft\Outlook\RoamCache,
  and Signatures in %APPDATA%\Microsoft\Signatures. Wi-Fi profiles import with:
  netsh wlan add profile filename="<file>.xml"
"@
    Add-TextEntry 'README - How to Restore.txt' $readme
} finally {
    if ($script:zip) { $script:zip.Dispose() }
    if ($script:zipStream) { $script:zipStream.Dispose() }
}

# --- Verify ----------------------------------------------------------------------
$entryCount = 0; $zipBytes = [long]0; $verified = $true
foreach ($zf in $zipFiles) {
    try {
        $z = [IO.Compression.ZipFile]::OpenRead($zf)
        $entryCount += $z.Entries.Count
        $z.Dispose()
        $zipBytes += (Get-Item -LiteralPath $zf).Length
    } catch { $verified = $false; Write-Warn2 "Could not re-open $zf to check it: $($_.Exception.Message)" }
}
# Keep a copy of the report next to the zip for quick reference.
try { [IO.File]::WriteAllText((Join-Path $destRoot "$baseName - Report.txt"), $reportText, (New-Object Text.UTF8Encoding $true)) } catch { }

$elapsed = (Get-Date) - $started
Write-Title 'Done!'
if ($verified) { Write-Good ("Backed up {0:N0} files in {1:hh\:mm\:ss}." -f $entryCount, $elapsed) }
foreach ($zf in $zipFiles) { Write-Info "$zf  ($(Format-Size (Get-Item -LiteralPath $zf).Length))" }
if ($failed.Count) { Write-Warn2 "$($failed.Count) file(s) could not be read (probably open in a program) -- see the report." }
if ($tooBig.Count) { Write-Warn2 "$($tooBig.Count) file(s) over 4 GB didn't fit on this FAT32 drive -- see the report." }
Write-Info ''
Write-Info 'Copy the zip to your new computer and open "README - How to Restore.txt" inside it.'
try { Start-Process explorer.exe "/select,`"$($zipFiles[0])`"" } catch { }
Exit-Backup 0
