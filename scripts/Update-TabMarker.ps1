#requires -Version 5.1
<#
.SYNOPSIS
Updates existing unpacked TabMarker installations without editing Chrome profiles.
.EXAMPLE
.\Update-TabMarker.ps1 -PackageUrl 'https://host/TabMarker-Chrome-0.4.4.zip' -Sha256 '<64 hex characters>' -Version '0.4.4' -DryRun
.EXAMPLE
.\Update-TabMarker.ps1 -RollbackReceipt 'C:\ProgramData\TabMarkerRMM\runs\<run>\backups\<target>\receipt.json'
#>
[CmdletBinding(DefaultParameterSetName = 'Update')]
param(
    [Parameter(ParameterSetName = 'Update')][string]$PackageUrl,
    [Parameter(ParameterSetName = 'Update')][string]$PackagePath,
    [Parameter(Mandatory = $true, ParameterSetName = 'Update')][ValidatePattern('^[a-fA-F0-9]{64}$')][string]$Sha256,
    [Parameter(Mandatory = $true, ParameterSetName = 'Update')][ValidatePattern('^\d+(\.\d+){0,3}$')][string]$Version,
    [Parameter(Mandatory = $true, ParameterSetName = 'Rollback')][string]$RollbackReceipt,
    [string[]]$ChromeUserDataRoot,
    [Parameter(ParameterSetName = 'Update')][string[]]$ExtensionPath,
    [string]$WorkRoot = "$env:ProgramData\TabMarkerRMM",
    [switch]$DryRun
)
Set-StrictMode -Version 2.0
$ErrorActionPreference = 'Stop'
$script:Results = New-Object 'System.Collections.Generic.List[object]'
$script:Warnings = New-Object 'System.Collections.Generic.List[string]'
$script:ChromeRoots = @()
$script:RunPath = $null
$script:ExitCode = 1
$script:MaxBytes = 104857600
$script:LogPath = $null
$script:Phase = 'Startup'
$script:LogWriteFailed = $false
$script:DiagnosticOnly = $false
$script:OwnedRunPath = $null
Write-Output ('TABMARKER_START PowerShell=' + $PSVersionTable.PSVersion + ' PID=' + $PID)

function Log([string]$Level, [string]$Message) {
    $line = [DateTime]::UtcNow.ToString('o') + ' [' + $Level + '] [' + $script:Phase + '] ' + $Message
    # Host output streams to the RMM console without polluting function return values.
    Write-Host ('TABMARKER_PROGRESS ' + $line)
    if ($script:LogPath) {
        try { [IO.File]::AppendAllText($script:LogPath, $line + [Environment]::NewLine, [Text.Encoding]::UTF8) }
        catch { $script:LogWriteFailed = $true; Write-Host ('TABMARKER_LOG_WRITE_FAILED=' + $_.Exception.Message) }
    }
}
function Warn([string]$Message) { $script:Warnings.Add($Message); Log 'WARN' $Message }
function Phase([string]$Name, [string]$Message) { $script:Phase = $Name; Log 'INFO' $Message }

function Value($Object, [string]$Name) {
    if ($null -eq $Object) { return $null }
    $property = $Object.PSObject.Properties[$Name]
    if ($null -ne $property) { return $property.Value }
    return $null
}
function FullPath([string]$Path) {
    if ($Path -notmatch '^[A-Za-z]:[\\/]') { throw 'Only absolute local Windows paths are supported.' }
    return [IO.Path]::GetFullPath($Path).TrimEnd('\')
}
function IsWithin([string]$Child, [string]$Parent) {
    return $Child.Equals($Parent, [StringComparison]::OrdinalIgnoreCase) -or $Child.StartsWith($Parent.TrimEnd('\') + '\', [StringComparison]::OrdinalIgnoreCase)
}
function IsCloudPlaceholder($Item) {
    # Only Microsoft's Cloud Files family is accepted. Junctions, symbolic links,
    # mount points and unknown providers remain blocked. Querying never changes the reparse data.
    $tool = Join-Path $env:SystemRoot 'System32\fsutil.exe'
    if ($env:PROCESSOR_ARCHITEW6432) { $tool = Join-Path $env:SystemRoot 'Sysnative\fsutil.exe' }
    $data = @(& $tool reparsepoint query $Item.FullName 2>&1)
    if ($LASTEXITCODE -ne 0) { throw "Could not inspect reparse tag: $($Item.FullName)" }
    $match = [regex]::Match(($data -join [Environment]::NewLine), '(?i)0x([0-9a-f]{8})')
    if (!$match.Success) { throw "Could not parse reparse tag: $($Item.FullName)" }
    $tag = [Convert]::ToUInt32($match.Groups[1].Value, 16)
    return (($tag -band 0xFFFF0FFFL) -eq 0x9000001AL)
}
function NoLinks([string]$Path) {
    $cursor = $Path
    while ($cursor) {
        if (Test-Path -LiteralPath $cursor) {
            $item = Get-Item -LiteralPath $cursor -Force
            if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -and !(IsCloudPlaceholder $item)) { throw "Redirecting or unsupported reparse point: $cursor" }
        }
        $parent = Split-Path -Path $cursor -Parent
        if ($parent -eq $cursor) { break }
        $cursor = $parent
    }
}
function ChildPath([string]$Root, [string]$Relative) {
    if ([string]::IsNullOrWhiteSpace($Relative) -or $Relative -match '[:\x00-\x1f]' -or $Relative -match '^[\\/]' -or $Relative -match '[\\/]$') { throw "Unsafe relative file path: $Relative" }
    foreach ($part in ($Relative -split '[\\/]')) {
        if ($part -eq '.' -or $part -eq '..' -or !$part -or $part -match '[ .]$' -or $part -match '[<>"|?*]' -or $part -match '^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(\.|$)') { throw "Unsafe relative file path: $Relative" }
    }
    $path = [IO.Path]::GetFullPath((Join-Path $Root $Relative))
    if (!(IsWithin $path $Root) -or $path -eq $Root) { throw 'File escaped its expected directory.' }
    NoLinks $path
    return $path
}
function ReadJson([string]$Path) {
    # Share reads with a running Chrome; never open preference files for writing.
    $stream = [IO.File]::Open($Path, [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]::ReadWrite -bor [IO.FileShare]::Delete)
    try { $reader = New-Object IO.StreamReader($stream); try { return ($reader.ReadToEnd() | ConvertFrom-Json) } finally { $reader.Dispose() } }
    finally { $stream.Dispose() }
}
function Hash([string]$Path) { return (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToLowerInvariant() }
function WriteAtomic([string]$Path, [byte[]]$Bytes) {
    NoLinks $Path
    $parent = Split-Path -Path $Path -Parent
    [void][IO.Directory]::CreateDirectory($parent)
    for ($attempt = 0; $attempt -lt 4; $attempt++) {
        $temp = Join-Path $parent ('.tabmarker-tmp-' + [guid]::NewGuid().ToString('N'))
        try {
            [IO.File]::WriteAllBytes($temp, $Bytes)
            if ([IO.File]::Exists($Path)) { [IO.File]::Replace($temp, $Path, [NullString]::Value) }
            else { [IO.File]::Move($temp, $Path) }
            return
        } catch {
            if ($attempt -eq 3) { throw "Cannot replace $Path : $($_.Exception.Message)" }
            # Retry the same operation for transient sharing/security holds; never weaken controls.
            Start-Sleep -Milliseconds 1000
        } finally { if ([IO.File]::Exists($temp)) { [IO.File]::Delete($temp) } }
    }
}
function WriteJson([string]$Path, $Object) { WriteAtomic $Path ([Text.Encoding]::UTF8.GetBytes(($Object | ConvertTo-Json -Depth 30))) }
function CopyAtomic([string]$Source, [string]$Destination) { WriteAtomic $Destination ([IO.File]::ReadAllBytes($Source)) }
function SafeWorkRoot([string]$Root) {
    $work = FullPath $Root; NoLinks $work
    foreach ($chromeRoot in @($ChromeUserDataRoot) + @($script:ChromeRoots)) {
        if ($chromeRoot -and $chromeRoot -match '^[A-Za-z]:[\\/]' -and (IsWithin $work (FullPath $chromeRoot))) { throw 'WorkRoot must be outside Chrome profile data.' }
    }
    if ($work -match '[\\/]Google[\\/]Chrome[^\\/]*[\\/]User Data([\\/]|$)') { throw 'WorkRoot must be outside Chrome profile data.' }
    foreach ($extension in @($ExtensionPath)) {
        if ($extension -and $extension -match '^[A-Za-z]:[\\/]' -and (IsWithin $work (FullPath $extension))) { throw 'WorkRoot must be outside the extension directory.' }
    }
    return $work
}
function InitializeRun([string]$Root) {
    $work = SafeWorkRoot $Root
    $script:RunPath = Join-Path $work ('runs\' + [DateTime]::UtcNow.ToString('yyyyMMddTHHmmssfffZ') + '-' + [guid]::NewGuid().ToString('N').Substring(0, 8))
    NoLinks $script:RunPath
    [void][IO.Directory]::CreateDirectory($script:RunPath)
    NoLinks $script:RunPath
    $script:OwnedRunPath = FullPath $script:RunPath
    $script:LogPath = Join-Path $script:RunPath 'install.log'
    [IO.File]::WriteAllText($script:LogPath, '', [Text.Encoding]::UTF8)
    Write-Host ('TABMARKER_LOG=' + $script:LogPath)
    Log 'INFO' ('Script started. PowerShell=' + $PSVersionTable.PSVersion + '; PID=' + $PID + '; DryRun=' + [bool]$DryRun)
    # Protect logs and backups before collecting user profile details.
    $acl = New-Object Security.AccessControl.DirectorySecurity
    $acl.SetAccessRuleProtection($true, $false)
    $account = [Security.Principal.WindowsIdentity]::GetCurrent()
    foreach ($sid in (@('S-1-5-18', 'S-1-5-32-544', $account.User.Value) | Select-Object -Unique)) {
        $identity = New-Object Security.Principal.SecurityIdentifier($sid)
        $rule = New-Object Security.AccessControl.FileSystemAccessRule($identity, 'FullControl', 'ContainerInherit,ObjectInherit', 'None', 'Allow')
        [void]$acl.AddAccessRule($rule)
    }
    Set-Acl -LiteralPath $script:RunPath -AclObject $acl
    Log 'INFO' ('Account=' + $account.Name + '; Process64Bit=' + [Environment]::Is64BitProcess)
}
function RemoveRunItem([string]$Path) {
    # Only this invocation's freshly created run directory is eligible. Never
    # recursively delete an unchecked path or follow a redirect out of it.
    if (!$script:OwnedRunPath) { throw 'Cleanup has no owned run directory.' }
    $pathToRemove = FullPath $Path
    $owned = FullPath $script:OwnedRunPath
    if ($owned -cne (FullPath $script:RunPath) -or $pathToRemove -eq $owned -or !(IsWithin $pathToRemove $owned) -or $pathToRemove -eq $script:LogPath) { throw 'Cleanup path is outside disposable run content.' }
    NoLinks $pathToRemove
    if (!(Test-Path -LiteralPath $pathToRemove)) { return }
    $item = Get-Item -LiteralPath $pathToRemove -Force
    if ($item.PSIsContainer) {
        foreach ($child in (Get-ChildItem -LiteralPath $pathToRemove -Force)) { RemoveRunItem $child.FullName }
    }
    for ($attempt = 0; $attempt -lt 4; $attempt++) {
        try {
            NoLinks $pathToRemove
            if ($item.PSIsContainer) { [IO.Directory]::Delete($pathToRemove, $false) }
            else { [IO.File]::Delete($pathToRemove) }
            return
        } catch {
            if ($attempt -eq 3) { throw "Cannot clean $pathToRemove : $($_.Exception.Message)" }
            Start-Sleep -Milliseconds 1000
        }
    }
}
function CleanupRun {
    if (!$script:OwnedRunPath) { return 'Unavailable' }
    $previousPhase = $script:Phase
    Phase 'Cleanup' 'Removing disposable files; keeping install.log.'
    $failed = $false; $retained = $false
    $recovery = @($script:Results | Where-Object { $_.status -eq 'RollbackFailed' -and (Value $_ 'receipt') } | ForEach-Object { FullPath (Split-Path $_.receipt -Parent) })
    try {
        NoLinks $script:OwnedRunPath
        foreach ($item in (Get-ChildItem -LiteralPath $script:OwnedRunPath -Force)) {
            if ($item.FullName -eq $script:LogPath) { continue }
            try {
                if ($item.Name -eq 'backups' -and $item.PSIsContainer -and $recovery.Count -gt 0) {
                    NoLinks $item.FullName
                    foreach ($backup in (Get-ChildItem -LiteralPath $item.FullName -Force)) {
                        if ((FullPath $backup.FullName) -in $recovery) { $retained = $true; Warn ('Recovery backup still needed after failed rollback: ' + $backup.FullName); continue }
                        RemoveRunItem $backup.FullName
                    }
                    if (!$retained) { RemoveRunItem $item.FullName }
                } else { RemoveRunItem $item.FullName }
            } catch { $failed = $true; Warn ('Cleanup failed: ' + $_.Exception.Message) }
        }
        foreach ($row in $script:Results) {
            $receipt = Value $row 'receipt'
            if ($receipt -and (IsWithin (FullPath $receipt) $script:OwnedRunPath) -and !(Test-Path -LiteralPath $receipt)) { $row.receipt = $null }
        }
    } catch { $failed = $true; Warn ('Cleanup failed: ' + $_.Exception.Message) }
    finally { $script:Phase = $previousPhase }
    if ($failed) { $script:ExitCode = 1; return 'Failed' }
    if ($retained) { return 'RecoveryRetained' }
    Log 'INFO' 'Cleanup complete. Only install.log remains in this run directory.'
    return 'Completed'
}
function Files([string]$Root) {
    NoLinks $Root
    $count = 0; $bytes = 0L
    $pending = New-Object 'System.Collections.Generic.Stack[string]'
    $pending.Push($Root); $directories = 0
    while ($pending.Count -gt 0) {
        $folder = $pending.Pop(); NoLinks $folder; $directories++
        if ($directories -gt 2500) { throw 'Extension directory has too many subdirectories.' }
        foreach ($item in (Get-ChildItem -LiteralPath $folder -Force)) {
            NoLinks $item.FullName
            if ($item.PSIsContainer) { $pending.Push($item.FullName); continue }
            if ($item.Name -eq '.tabmarker-rmm.lock') { continue }
            $count++; $bytes += $item.Length
            if ($count -gt 2500 -or $bytes -gt $script:MaxBytes) { throw 'Extension directory exceeds the 2500-file / 100 MiB safety limit.' }
            $relative = $item.FullName.Substring($Root.Length + 1)
            [void](ChildPath $Root $relative)
            [pscustomobject]@{ relative = $relative; sha256 = (Hash $item.FullName) }
        }
    }
}
function VersionNumber([string]$Text) {
    if ($Text -notmatch '^\d+(\.\d+){0,3}$') { throw "Invalid Chrome version: $Text" }
    $parts = @($Text.Split('.') | ForEach-Object { [int]$_ })
    if (@($parts | Where-Object { $_ -gt 65535 }).Count -gt 0) { throw 'Chrome version components exceed 65535.' }
    while ($parts.Count -lt 4) { $parts += 0 }
    return [version]($parts -join '.')
}
function Manifest([string]$Root) {
    $m = ReadJson (ChildPath $Root 'manifest.json')
    if ((Value $m 'name') -cne 'TabMarker' -or (Value $m 'manifest_version') -ne 3 -or (Value (Value $m 'background') 'service_worker') -cne 'background.js' -or (Value (Value $m 'action') 'default_popup') -cne 'popup.html' -or (Value $m 'options_page') -cne 'options.html') { throw "Not the expected TabMarker package: $Root" }
    [void](VersionNumber ([string](Value $m 'version')))
    $references = New-Object 'System.Collections.Generic.List[string]'
    foreach ($file in @('background.js', 'content.js', 'popup.html', 'options.html')) { $references.Add($file) }
    foreach ($icon in @((Value $m 'icons').PSObject.Properties)) { $references.Add([string]$icon.Value) }
    $actionIcons = Value (Value $m 'action') 'default_icon'
    if ($actionIcons -is [string]) { $references.Add($actionIcons) }
    elseif ($null -ne $actionIcons) { foreach ($icon in $actionIcons.PSObject.Properties) { $references.Add([string]$icon.Value) } }
    $foundContent = $false
    foreach ($content in @(Value $m 'content_scripts')) {
        foreach ($file in @((Value $content 'js')) + @((Value $content 'css'))) {
            if ($file) { $references.Add([string]$file); if ($file -ceq 'content.js') { $foundContent = $true } }
        }
    }
    if (!$foundContent) { throw 'TabMarker content script registration is missing.' }
    foreach ($file in $references) { if (!(Test-Path -LiteralPath (ChildPath $Root $file) -PathType Leaf)) { throw "Missing extension resource: $file" } }
    # Vite's hashed UI assets are not manifest entries. Validate local HTML resources too.
    foreach ($html in @('popup.html', 'options.html')) {
        $text = [IO.File]::ReadAllText((ChildPath $Root $html))
        foreach ($match in [regex]::Matches($text, '(?:src|href)=["''](\.?/?assets/[^"'']+)["'']')) {
            $relative = $match.Groups[1].Value -replace '^\./', ''
            if (!(Test-Path -LiteralPath (ChildPath $Root $relative) -PathType Leaf)) { throw "Missing UI asset: $relative" }
        }
    }
    return $m
}
function SafeTarget([string]$Path) {
    $target = FullPath $Path
    NoLinks $target
    if (!(Test-Path -LiteralPath $target -PathType Container)) { throw "Extension directory not found: $target" }
    if ($target -eq [IO.Path]::GetPathRoot($target).TrimEnd('\') -or (Split-Path $target -Leaf) -match '^(Users|Windows|Program Files( \(x86\))?|ProgramData|Documents|Downloads|Desktop|AppData|User Data|Default|Profile \d+)$') { throw "Refusing a broad or profile directory: $target" }
    if ($env:windir -and (IsWithin $target (FullPath $env:windir))) { throw 'Refusing a Windows system directory.' }
    foreach ($root in $script:ChromeRoots) { if (IsWithin $target $root) { throw 'Refusing to update files inside Chrome profile data.' } }
    if ($target -match '[\\/]Google[\\/]Chrome[^\\/]*[\\/]User Data([\\/]|$)') { throw 'Refusing a Chrome profile data directory.' }
    foreach ($name in @('.git', 'node_modules', 'src', 'Preferences', 'Secure Preferences', 'Local State', 'Local Extension Settings', 'IndexedDB')) {
        if (Test-Path -LiteralPath (Join-Path $target $name)) { throw "Source checkout or profile data found in target ($name). Select the built extension folder." }
    }
    if ((IsWithin $script:RunPath $target) -or (IsWithin $target $script:RunPath)) { throw 'The deployment work directory must be outside the extension directory.' }
    return $target
}
function DiscoverRoots {
    if ($ChromeUserDataRoot) { return @($ChromeUserDataRoot | ForEach-Object { FullPath $_ } | Select-Object -Unique) }
    $users = New-Object 'System.Collections.Generic.List[string]'
    $keys = @()
    try { $keys = @(Get-ChildItem 'HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion\ProfileList' -ErrorAction Stop) }
    catch { Warn ('Cannot enumerate Windows profiles: ' + $_.Exception.Message) }
    foreach ($key in $keys) {
        # These are Windows service accounts, not desktop Chrome users. Their
        # protected directories must never abort an ordinary user deployment.
        if ($key.PSChildName -in @('S-1-5-18', 'S-1-5-19', 'S-1-5-20')) { continue }
        try {
            $entry = Get-ItemProperty -LiteralPath $key.PSPath -ErrorAction Stop
            $profile = [Environment]::ExpandEnvironmentVariables([string](Value $entry 'ProfileImagePath'))
            if ($profile -and (Test-Path -LiteralPath $profile -PathType Container -ErrorAction Stop)) { $users.Add($profile) }
        } catch { Warn ("Cannot inspect Windows profile $($key.PSChildName): " + $_.Exception.Message) }
    }
    # Current-user discovery remains useful when another profile is inaccessible.
    if ($env:USERPROFILE -and $env:USERPROFILE -notmatch '[\\/]Windows[\\/](System32[\\/]config[\\/]systemprofile|ServiceProfiles[\\/])') {
        $users.Add($env:USERPROFILE)
    }
    foreach ($user in @($users | Select-Object -Unique)) {
        foreach ($channel in @('Chrome', 'Chrome Beta', 'Chrome Dev', 'Chrome SxS')) {
            $root = Join-Path $user "AppData\Local\Google\$channel\User Data"
            try { if (Test-Path -LiteralPath $root -PathType Container -ErrorAction Stop) { FullPath $root } }
            catch { Warn ("Cannot inspect Chrome data root $root : " + $_.Exception.Message) }
        }
    }
}
function DiscoverTargets {
    $targets = @{}
    foreach ($root in $script:ChromeRoots) {
        try {
            if (!(Test-Path -LiteralPath $root -PathType Container)) { Warn "Chrome data root missing: $root"; continue }
            NoLinks $root
            $profiles = @(Get-ChildItem -LiteralPath $root -Directory -Force)
        } catch { Warn ("Cannot list Chrome profiles in $root : " + $_.Exception.Message); continue }
        foreach ($profile in $profiles) {
            if ($profile.Attributes -band [IO.FileAttributes]::ReparsePoint) { continue }
            foreach ($file in @('Secure Preferences', 'Preferences')) {
                $prefs = Join-Path $profile.FullName $file
                try {
                    if (!(Test-Path -LiteralPath $prefs -PathType Leaf)) { continue }
                    NoLinks $prefs
                    $settings = Value (Value (ReadJson $prefs) 'extensions') 'settings'
                    if ($null -eq $settings) { continue }
                    foreach ($record in $settings.PSObject.Properties) {
                        # Chromium ManifestLocation::kUnpacked = 4. Packed/store installs are excluded.
                        if ((Value $record.Value 'location') -ne 4 -or $record.Name -notmatch '^[a-p]{32}$') { continue }
                        $path = [string](Value $record.Value 'path')
                        if (!$path) { continue }
                        $isTabMarker = $false
                        try {
                            $candidate = FullPath $path
                            $manifestPath = Join-Path $candidate 'manifest.json'
                            if (!(Test-Path -LiteralPath $manifestPath -PathType Leaf)) { continue }
                            # Unpacked records do not normally cache the manifest; read it from disk.
                            if ((Value (ReadJson $manifestPath) 'name') -cne 'TabMarker') { continue }
                            $isTabMarker = $true
                            $candidate = SafeTarget $candidate
                            [void](Manifest $candidate)
                            if (!$targets.ContainsKey($candidate)) { $targets[$candidate] = [pscustomobject]@{ path = $candidate; profiles = @(); extensionIds = @() } }
                            $targets[$candidate].profiles = @($targets[$candidate].profiles + $profile.FullName | Select-Object -Unique)
                            $targets[$candidate].extensionIds = @($targets[$candidate].extensionIds + $record.Name | Select-Object -Unique)
                        } catch {
                            Warn "Skipped unpacked record $($record.Name) in $prefs : $($_.Exception.Message)"
                            if ($isTabMarker) { $script:Results.Add([pscustomobject]@{ target = $path; status = 'Failed'; error = $_.Exception.Message; reloadRequired = $false; activeVersionVerified = $false }) }
                        }
                    }
                } catch { Warn "Could not read $prefs : $($_.Exception.Message)" }
            }
        }
    }
    foreach ($path in @($ExtensionPath)) {
        if (!$path) { continue }
        $target = SafeTarget $path
        [void](Manifest $target)
        if (!$targets.ContainsKey($target)) { $targets[$target] = [pscustomobject]@{ path = $target; profiles = @(); extensionIds = @() } }
    }
    return @($targets.Values | Sort-Object path)
}
function Download([string]$Url, [string]$Destination) {
    [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
    for ($redirect = 0; $redirect -le 5; $redirect++) {
        $uri = [uri]$Url
        if (!$uri.IsAbsoluteUri -or $uri.Scheme -ne 'https' -or $uri.UserInfo) { throw 'Package URL and redirects must use HTTPS without embedded credentials.' }
        $request = [Net.HttpWebRequest]::Create($uri)
        $request.AllowAutoRedirect = $false; $request.Timeout = 120000; $request.ReadWriteTimeout = 120000
        $request.UserAgent = 'TabMarker-RMM/1.0'
        $response = $request.GetResponse()
        try {
            if ([int]$response.StatusCode -in @(301, 302, 303, 307, 308)) {
                $Url = ([uri]::new($uri, $response.Headers['Location'])).AbsoluteUri
                continue
            }
            if ([int]$response.StatusCode -ne 200 -or $response.ContentLength -gt $script:MaxBytes) { throw 'Unexpected response or package exceeds 100 MiB.' }
            $inputStream = $response.GetResponseStream(); $outputStream = [IO.File]::Create($Destination)
            try {
                $buffer = New-Object byte[] 65536; $total = 0L
                while (($count = $inputStream.Read($buffer, 0, $buffer.Length)) -gt 0) {
                    $total += $count; if ($total -gt $script:MaxBytes) { throw 'Package exceeds 100 MiB.' }
                    $outputStream.Write($buffer, 0, $count)
                }
            } finally { $outputStream.Dispose(); $inputStream.Dispose() }
            return
        } finally { $response.Dispose() }
    }
    throw 'Too many download redirects.'
}
function ExtractPackage([string]$Zip, [string]$Destination) {
    [void][IO.Directory]::CreateDirectory($Destination)
    $archive = [IO.Compression.ZipFile]::OpenRead($Zip)
    try {
        $seen = @{}; $size = 0L
        if ($archive.Entries.Count -gt 2500) { throw 'ZIP has too many entries.' }
        foreach ($entry in $archive.Entries) {
            $name = $entry.FullName.Replace('/', '\').TrimEnd('\')
            $path = ChildPath $Destination $name
            if ($seen.ContainsKey($path)) { throw 'ZIP contains duplicate paths.' }; $seen[$path] = $true
            if (($entry.ExternalAttributes -band 0xF0000000L) -eq 0xA0000000L) { throw 'ZIP symbolic links are unsupported.' }
            $size += $entry.Length; if ($size -gt $script:MaxBytes) { throw 'Extracted package exceeds 100 MiB.' }
            if ($entry.FullName -match '[\\/]$') { [void][IO.Directory]::CreateDirectory($path); continue }
            [void][IO.Directory]::CreateDirectory((Split-Path $path -Parent))
            [IO.Compression.ZipFileExtensions]::ExtractToFile($entry, $path, $false)
        }
    } finally { $archive.Dispose() }
}
function Marker([string]$Target, [string]$State, [string]$TargetVersion) {
    WriteJson (ChildPath $Target 'update-status.json') ([ordered]@{ schemaVersion = 1; product = 'TabMarker'; state = $State; version = $TargetVersion; deployedAtUtc = [DateTime]::UtcNow.ToString('o') })
}
function Restore($Receipt, [string]$BackupRoot) {
    if ((Value $Receipt 'schemaVersion') -ne 1 -or (Value $Receipt 'product') -cne 'TabMarker') { throw 'Invalid rollback receipt.' }
    $target = SafeTarget ([string]$Receipt.target)
    $backup = Join-Path $BackupRoot 'files'
    $backupManifest = Manifest $backup
    if ($backupManifest.version -cne $Receipt.oldVersion) { throw 'Backup manifest does not match the rollback version.' }
    $currentManifest = ReadJson (ChildPath $target 'manifest.json')
    if ([string](Value $currentManifest 'key') -cne [string](Value $backupManifest 'key')) { throw 'Backup key differs from installed extension identity.' }
    [void](VersionNumber $Receipt.oldVersion); [void](VersionNumber $Receipt.newVersion)
    $manifestFile = @($Receipt.originalFiles | Where-Object { $_.relative -eq 'manifest.json' })
    if ($manifestFile.Count -ne 1 -or @($Receipt.originalFiles).Count -gt 2500 -or @($Receipt.addedFiles).Count -gt 2500) { throw 'Invalid rollback file inventory.' }
    $seen = @{}
    foreach ($file in $Receipt.originalFiles) {
        if ($seen.ContainsKey([string]$file.relative)) { throw 'Duplicate rollback file entry.' }; $seen[[string]$file.relative] = $true
        $source = ChildPath $backup $file.relative
        if ((Hash $source) -ne $file.sha256) { throw "Backup checksum mismatch: $($file.relative)" }
        [void](ChildPath $target $file.relative)
    }
    foreach ($relative in $Receipt.addedFiles) {
        if ($seen.ContainsKey([string]$relative)) { throw 'Overlapping rollback file inventory.' }; $seen[[string]$relative] = $true
        [void](ChildPath $target $relative)
    }
    if ($DryRun) { return }
    Marker $target 'applying' $Receipt.oldVersion
    foreach ($file in $Receipt.originalFiles) {
        if ($file.relative -in @('manifest.json', 'update-status.json')) { continue }
        $destination = ChildPath $target $file.relative
        if (!(Test-Path -LiteralPath $destination -PathType Leaf) -or (Hash $destination) -ne $file.sha256) {
            CopyAtomic (ChildPath $backup $file.relative) $destination
        }
    }
    foreach ($relative in $Receipt.addedFiles) {
        if ($relative -eq 'update-status.json') { continue }
        $added = ChildPath $target $relative
        if ([IO.File]::Exists($added)) { [IO.File]::Delete($added) }
    }
    $manifestTarget = ChildPath $target 'manifest.json'
    if (!(Test-Path -LiteralPath $manifestTarget -PathType Leaf) -or (Hash $manifestTarget) -ne $manifestFile[0].sha256) {
        CopyAtomic (ChildPath $backup 'manifest.json') $manifestTarget
    }
    foreach ($file in $Receipt.originalFiles) {
        if ($file.relative -eq 'update-status.json') { continue }
        if ((Hash (ChildPath $target $file.relative)) -ne $file.sha256) { throw "Rollback verification failed: $($file.relative)" }
    }
    Marker $target 'ready' $Receipt.oldVersion
}
function Deploy($Target, [string]$Stage, $NewManifest) {
    $path = SafeTarget $Target.path
    $current = Manifest $path
    $row = [ordered]@{ target = $path; profiles = $Target.profiles; extensionIds = $Target.extensionIds; oldVersion = $current.version; newVersion = $NewManifest.version; status = 'Failed'; reloadRequired = $false; activeVersionVerified = $false; receipt = $null; error = $null }
    $lock = $null; $receipt = $null; $backupRoot = $null; $changed = $false
    try {
        Log 'INFO' ("Target $path : $($current.version) -> $($NewManifest.version)")
        if ([string](Value $current 'key') -cne [string](Value $NewManifest 'key')) { throw 'Extension key changed. Refusing an update that could change extension identity.' }
        $comparison = (VersionNumber $NewManifest.version).CompareTo((VersionNumber $current.version))
        if ($comparison -lt 0) { throw 'Downgrade refused. Use a verified rollback receipt instead.' }
        $packageFiles = @(Files $Stage)
        if ($comparison -eq 0) {
            $different = @($packageFiles | Where-Object { $_.relative -ne 'update-status.json' -and (!(Test-Path -LiteralPath (ChildPath $path $_.relative) -PathType Leaf) -or (Hash (ChildPath $path $_.relative)) -ne $_.sha256) })
            if ($different.Count -gt 0) { throw 'Same version has different files. Publish a higher version or roll back explicitly.' }
            $row.status = 'AlreadyCurrent'; $row.reloadRequired = $true
            return [pscustomobject]$row
        }
        if ($DryRun) { $row.status = 'WouldUpdate'; return [pscustomobject]$row }
        $lock = [IO.File]::Open((Join-Path $path '.tabmarker-rmm.lock'), [IO.FileMode]::OpenOrCreate, [IO.FileAccess]::ReadWrite, [IO.FileShare]::None)
        # Revalidate after acquiring the per-folder lock.
        $again = Manifest $path
        if ($again.version -cne $current.version) { throw 'Extension changed during discovery. Run again.' }
        Log 'INFO' ("Capturing verified backup for $path")
        $original = @(Files $path)
        $oldNames = @{}; foreach ($file in $original) { $oldNames[$file.relative] = $true }
        $added = @($packageFiles | Where-Object { !$oldNames.ContainsKey($_.relative) } | ForEach-Object { $_.relative })
        if (!$oldNames.ContainsKey('update-status.json') -and 'update-status.json' -notin $added) { $added += 'update-status.json' }
        $backupRoot = Join-Path $script:RunPath ('backups\' + [guid]::NewGuid().ToString('N'))
        foreach ($file in $original) {
            $backupFile = ChildPath (Join-Path $backupRoot 'files') $file.relative
            CopyAtomic (ChildPath $path $file.relative) $backupFile
            if ((Hash $backupFile) -ne $file.sha256) { throw 'Backup changed during capture. No update was applied.' }
        }
        $receipt = [pscustomobject]@{ schemaVersion = 1; product = 'TabMarker'; target = $path; oldVersion = $current.version; newVersion = $NewManifest.version; originalFiles = $original; addedFiles = $added; packageSha256 = $Sha256.ToLowerInvariant(); capturedAtUtc = [DateTime]::UtcNow.ToString('o') }
        $row.receipt = Join-Path $backupRoot 'receipt.json'; WriteJson $row.receipt $receipt
        $changed = $true
        Marker $path 'applying' $NewManifest.version
        Log 'INFO' ("Backup ready. Deploying files to $path")
        # Hashed assets precede the HTML/entry points that reference them.
        foreach ($file in ($packageFiles | Sort-Object { if ($_.relative -match '^assets[\\/]') { 0 } elseif ($_.relative -match '\.(html|js)$') { 1 } else { 0 } })) {
            if ($file.relative -in @('manifest.json', 'update-status.json')) { continue }
            $destination = ChildPath $path $file.relative
            if (!(Test-Path -LiteralPath $destination -PathType Leaf) -or (Hash $destination) -ne $file.sha256) {
                CopyAtomic (ChildPath $Stage $file.relative) $destination
            }
            if ((Hash $destination) -ne $file.sha256) { throw "Deployed checksum mismatch: $($file.relative)" }
        }
        CopyAtomic (ChildPath $Stage 'manifest.json') (ChildPath $path 'manifest.json')
        [void](Manifest $path)
        if ((Hash (ChildPath $path 'manifest.json')) -ne (Hash (ChildPath $Stage 'manifest.json'))) { throw 'Deployed manifest checksum mismatch.' }
        Marker $path 'ready' $NewManifest.version
        $row.status = 'Updated'; $row.reloadRequired = $true
        Log 'INFO' ("Files updated to $($NewManifest.version). Chrome reload required: $path")
    } catch {
        $row.error = $_.Exception.Message
        Log 'ERROR' ("Target $path failed: " + $row.error)
        if ($changed -and $null -ne $receipt) {
            try { Log 'WARN' ("Restoring backup for $path"); Restore $receipt $backupRoot; $row.status = 'FailedRolledBack'; $row.reloadRequired = $true; Log 'INFO' 'Automatic rollback completed.' }
            catch { $row.status = 'RollbackFailed'; $row.error += ' | Rollback failed: ' + $_.Exception.Message; Log 'ERROR' $row.error }
        }
    } finally { if ($null -ne $lock) { $lock.Dispose() } }
    return [pscustomobject]$row
}

try {
    InitializeRun $WorkRoot
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    Phase 'DiscoverProfiles' 'Discovering accessible desktop Chrome profiles.'
    $script:ChromeRoots = @(DiscoverRoots)
    [void](SafeWorkRoot $WorkRoot)
    Log 'INFO' ('Chrome data roots found: ' + $script:ChromeRoots.Count)
    if ($PSCmdlet.ParameterSetName -eq 'Rollback') {
        Phase 'Rollback' 'Validating rollback receipt and backup files.'
        $receiptPath = FullPath $RollbackReceipt; NoLinks $receiptPath
        $receipt = ReadJson $receiptPath
        $target = SafeTarget ([string](Value $receipt 'target'))
        $current = Manifest $target
        if ($current.version -cne [string](Value $receipt 'newVersion') -and $current.version -cne [string](Value $receipt 'oldVersion')) { throw 'Current version does not match this rollback receipt. Refusing to overwrite another deployment.' }
        $lock = $null
        try {
            if (!$DryRun) { $lock = [IO.File]::Open((Join-Path $target '.tabmarker-rmm.lock'), [IO.FileMode]::OpenOrCreate, [IO.FileAccess]::ReadWrite, [IO.FileShare]::None) }
            Restore $receipt (Split-Path $receiptPath -Parent)
            $status = 'RolledBack'; if ($DryRun) { $status = 'WouldRollback' }
            $script:Results.Add([pscustomobject]@{ target = $target; oldVersion = $current.version; newVersion = $receipt.oldVersion; status = $status; reloadRequired = !$DryRun; activeVersionVerified = $false; receipt = $receiptPath })
        } finally { if ($null -ne $lock) { $lock.Dispose() } }
    } else {
        [void](VersionNumber $Version)
        if ((!$PackageUrl -and !$PackagePath) -or ($PackageUrl -and $PackagePath)) { throw 'Provide exactly one of -PackageUrl or -PackagePath.' }
        $zip = Join-Path $script:RunPath 'package.zip'
        Phase 'AcquirePackage' 'Acquiring the pinned extension package.'
        if ($PackageUrl) { Download $PackageUrl $zip }
        else {
            $source = FullPath $PackagePath; NoLinks $source
            if ((Get-Item -LiteralPath $source).Length -gt $script:MaxBytes) { throw 'ZIP exceeds 100 MiB.' }
            Copy-Item -LiteralPath $source -Destination $zip
        }
        Phase 'ValidatePackage' 'Checking package size, SHA-256, version and extension resources.'
        if ((Get-Item -LiteralPath $zip).Length -gt $script:MaxBytes) { throw 'ZIP exceeds 100 MiB.' }
        if ((Hash $zip) -ne $Sha256.ToLowerInvariant()) { throw 'Package SHA-256 mismatch. No extension files changed.' }
        $stage = Join-Path $script:RunPath 'staging'; ExtractPackage $zip $stage
        $new = Manifest $stage
        if ($new.version -cne $Version) { throw 'Package version does not match -Version.' }
        $marker = ReadJson (ChildPath $stage 'update-status.json')
        if ((Value $marker 'schemaVersion') -ne 1 -or (Value $marker 'product') -cne 'TabMarker' -or (Value $marker 'state') -cne 'ready' -or (Value $marker 'version') -cne $Version) { throw 'Package deployment marker is missing or invalid.' }
        foreach ($reserved in @('.git', 'src', 'node_modules', 'Preferences', 'Secure Preferences', 'Local State', '.tabmarker-rmm.lock')) {
            if (Test-Path -LiteralPath (Join-Path $stage $reserved)) { throw "Unexpected package content: $reserved" }
        }
        Phase 'DiscoverTargets' 'Package verified. Locating existing unpacked TabMarker installations.'
        $targets = @(DiscoverTargets)
        Log 'INFO' ('Validated extension folders found: ' + $targets.Count)
        if ($targets.Count -eq 0) { if ($script:Results.Count -eq 0) { $script:ExitCode = 2 }; throw 'No validated unpacked TabMarker installations found. Use -ChromeUserDataRoot for custom Chrome data locations or -ExtensionPath for a known built folder.' }
        Phase 'Deploy' 'Processing validated extension folders.'
        foreach ($target in $targets) {
            try { $script:Results.Add((Deploy $target $stage $new)) }
            catch { $script:Results.Add([pscustomobject]@{ target = $target.path; status = 'Failed'; error = $_.Exception.Message; reloadRequired = $false; activeVersionVerified = $false }) }
        }
    }
    $failed = @($script:Results | Where-Object { $_.status -in @('Failed', 'FailedRolledBack', 'RollbackFailed') })
    if ($failed.Count -eq 0) { $script:ExitCode = 0 }
} catch {
    $failure = $_.Exception.Message
    $failurePhase = $script:Phase
    if (!$script:LogPath) {
        $script:DiagnosticOnly = $true
        try {
            # Diagnostics only: if the requested work directory is unavailable,
            # record the failure in the invoking account's local app data. No deployment follows.
            $localData = $env:LOCALAPPDATA
            if (!$localData) { $localData = [Environment]::GetFolderPath('LocalApplicationData') }
            InitializeRun (Join-Path $localData 'TabMarkerRMM\diagnostics')
            Log 'WARN' ('Diagnostic fallback only. Requested work root: ' + $WorkRoot)
        } catch { Write-Host ('TABMARKER_LOG_INIT_FAILED=' + $_.Exception.Message) }
    }
    $script:Phase = $failurePhase
    Warn $failure
} finally {
    foreach ($row in $script:Results) { Log 'INFO' ('Target result: ' + $row.status + ' ' + $row.target) }
    $cleanup = CleanupRun
    Log 'INFO' ('Finalizing run. Deployment exit code=' + $script:ExitCode)
    if ($script:LogWriteFailed) { $script:ExitCode = 1; $script:Warnings.Add('One or more install.log writes failed. Review console output.') }
    $state = 'Failed'; if ($script:ExitCode -eq 0) { $state = 'Completed' }
    $report = [ordered]@{ schemaVersion = 2; product = 'TabMarker'; state = $state; phase = $script:Phase; runPath = $script:RunPath; logPath = $script:LogPath; cleanup = $cleanup; diagnosticOnly = $script:DiagnosticOnly; completedAtUtc = [DateTime]::UtcNow.ToString('o'); dryRun = [bool]$DryRun; exitCode = $script:ExitCode; results = @($script:Results.ToArray()); warnings = @($script:Warnings.ToArray()) }
    $reportJson = $report | ConvertTo-Json -Depth 30 -Compress
    Log 'INFO' ('TABMARKER_REPORT_JSON=' + $reportJson)
    if ($script:LogWriteFailed -and $script:ExitCode -ne 1) {
        $script:ExitCode = 1; $report.exitCode = 1; $report.state = 'Failed'
        $reportJson = $report | ConvertTo-Json -Depth 30 -Compress
    }
    foreach ($row in $script:Results) { Write-Output ('TABMARKER_TARGET ' + ($row | ConvertTo-Json -Depth 8 -Compress)) }
    foreach ($warning in $script:Warnings) { Write-Output ('TABMARKER_WARNING ' + $warning) }
    Write-Output ('TABMARKER_REPORT_JSON=' + $reportJson)
    if (!$script:LogPath -or $script:LogWriteFailed) { Write-Output 'TABMARKER_LOG_UNAVAILABLE=No reliable writable log location. See the console error and TABMARKER_LOG_INIT_FAILED.' }
    Write-Output ('TABMARKER_EXIT_CODE=' + $script:ExitCode)
}
exit $script:ExitCode
