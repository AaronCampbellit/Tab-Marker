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
Add-Type -AssemblyName System.IO.Compression.FileSystem
$script:Results = New-Object 'System.Collections.Generic.List[object]'
$script:Warnings = New-Object 'System.Collections.Generic.List[string]'
$script:ChromeRoots = @()
$script:RunPath = $null
$script:ExitCode = 1
$script:MaxBytes = 104857600

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
function NoLinks([string]$Path) {
    $cursor = $Path
    while ($cursor) {
        if (Test-Path -LiteralPath $cursor) {
            if ((Get-Item -LiteralPath $cursor -Force).Attributes -band [IO.FileAttributes]::ReparsePoint) { throw "Reparse points are unsupported: $cursor" }
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
function Files([string]$Root) {
    NoLinks $Root
    $count = 0; $bytes = 0L
    foreach ($item in (Get-ChildItem -LiteralPath $Root -Recurse -Force)) {
        if ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw "Reparse point inside extension: $($item.FullName)" }
        if (!$item.PSIsContainer -and $item.Name -ne '.tabmarker-rmm.lock') {
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
    foreach ($entry in (Get-ItemProperty 'HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion\ProfileList\*')) {
        $profile = [Environment]::ExpandEnvironmentVariables([string](Value $entry 'ProfileImagePath'))
        if ($profile -and (Test-Path -LiteralPath $profile -PathType Container)) { $users.Add($profile) }
    }
    foreach ($user in @($users | Select-Object -Unique)) {
        foreach ($channel in @('Chrome', 'Chrome Beta', 'Chrome Dev', 'Chrome SxS')) {
            $root = Join-Path $user "AppData\Local\Google\$channel\User Data"
            if (Test-Path -LiteralPath $root -PathType Container) { FullPath $root }
        }
    }
}
function DiscoverTargets {
    $targets = @{}
    foreach ($root in $script:ChromeRoots) {
        if (!(Test-Path -LiteralPath $root -PathType Container)) { $script:Warnings.Add("Chrome data root missing: $root"); continue }
        NoLinks $root
        foreach ($profile in (Get-ChildItem -LiteralPath $root -Directory -Force)) {
            if ($profile.Attributes -band [IO.FileAttributes]::ReparsePoint) { continue }
            foreach ($file in @('Secure Preferences', 'Preferences')) {
                $prefs = Join-Path $profile.FullName $file
                if (!(Test-Path -LiteralPath $prefs -PathType Leaf)) { continue }
                try {
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
                            $script:Warnings.Add("Skipped unpacked record $($record.Name) in $prefs : $($_.Exception.Message)")
                            if ($isTabMarker) { $script:Results.Add([pscustomobject]@{ target = $path; status = 'Failed'; error = $_.Exception.Message; reloadRequired = $false; activeVersionVerified = $false }) }
                        }
                    }
                } catch { $script:Warnings.Add("Could not read $prefs : $($_.Exception.Message)") }
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
    } catch {
        $row.error = $_.Exception.Message
        if ($changed -and $null -ne $receipt) {
            try { Restore $receipt $backupRoot; $row.status = 'FailedRolledBack'; $row.reloadRequired = $true }
            catch { $row.status = 'RollbackFailed'; $row.error += ' | Rollback failed: ' + $_.Exception.Message }
        }
    } finally { if ($null -ne $lock) { $lock.Dispose() } }
    return [pscustomobject]$row
}

try {
    $script:ChromeRoots = @(DiscoverRoots)
    $work = FullPath $WorkRoot; NoLinks $work
    foreach ($root in $script:ChromeRoots) { if (IsWithin $work $root) { throw 'WorkRoot must be outside Chrome profile data.' } }
    if ($work -match '[\\/]Google[\\/]Chrome[^\\/]*[\\/]User Data([\\/]|$)') { throw 'WorkRoot must be outside Chrome profile data.' }
    $script:RunPath = Join-Path $work ('runs\' + [DateTime]::UtcNow.ToString('yyyyMMddTHHmmssfffZ') + '-' + [guid]::NewGuid().ToString('N').Substring(0, 8))
    NoLinks $script:RunPath
    [void][IO.Directory]::CreateDirectory($script:RunPath)
    NoLinks $script:RunPath
    # Backups may contain user-created files. Restrict each run to admins, SYSTEM, and the invoking identity.
    $acl = New-Object Security.AccessControl.DirectorySecurity
    $acl.SetAccessRuleProtection($true, $false)
    $sids = @('S-1-5-18', 'S-1-5-32-544', [Security.Principal.WindowsIdentity]::GetCurrent().User.Value) | Select-Object -Unique
    foreach ($sid in $sids) {
        $identity = New-Object Security.Principal.SecurityIdentifier($sid)
        $rule = New-Object Security.AccessControl.FileSystemAccessRule($identity, 'FullControl', 'ContainerInherit,ObjectInherit', 'None', 'Allow')
        [void]$acl.AddAccessRule($rule)
    }
    Set-Acl -LiteralPath $script:RunPath -AclObject $acl
    if ($PSCmdlet.ParameterSetName -eq 'Rollback') {
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
        if ($PackageUrl) { Download $PackageUrl $zip }
        else {
            $source = FullPath $PackagePath; NoLinks $source
            if ((Get-Item -LiteralPath $source).Length -gt $script:MaxBytes) { throw 'ZIP exceeds 100 MiB.' }
            Copy-Item -LiteralPath $source -Destination $zip
        }
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
        $targets = @(DiscoverTargets)
        if ($targets.Count -eq 0) { if ($script:Results.Count -eq 0) { $script:ExitCode = 2 }; throw 'No validated unpacked TabMarker installations found. Use -ChromeUserDataRoot for custom Chrome data locations or -ExtensionPath for a known built folder.' }
        foreach ($target in $targets) {
            try { $script:Results.Add((Deploy $target $stage $new)) }
            catch { $script:Results.Add([pscustomobject]@{ target = $target.path; status = 'Failed'; error = $_.Exception.Message; reloadRequired = $false; activeVersionVerified = $false }) }
        }
    }
    $failed = @($script:Results | Where-Object { $_.status -in @('Failed', 'FailedRolledBack', 'RollbackFailed') })
    if ($failed.Count -eq 0) { $script:ExitCode = 0 }
} catch {
    $script:Warnings.Add($_.Exception.Message)
} finally {
    $report = [ordered]@{ schemaVersion = 1; product = 'TabMarker'; runPath = $script:RunPath; completedAtUtc = [DateTime]::UtcNow.ToString('o'); dryRun = [bool]$DryRun; exitCode = $script:ExitCode; results = @($script:Results.ToArray()); warnings = @($script:Warnings.ToArray()) }
    if ($script:RunPath -and (Test-Path -LiteralPath $script:RunPath -PathType Container)) {
        try { WriteJson (Join-Path $script:RunPath 'report.json') $report } catch { $script:ExitCode = 1; Write-Output ('REPORT_WRITE_FAILED=' + $_.Exception.Message) }
    }
    foreach ($row in $script:Results) { Write-Output ('TABMARKER_TARGET ' + ($row | ConvertTo-Json -Depth 8 -Compress)) }
    foreach ($warning in $script:Warnings) { Write-Output ('TABMARKER_WARNING ' + $warning) }
    if ($script:RunPath) { Write-Output ('TABMARKER_REPORT=' + (Join-Path $script:RunPath 'report.json')) }
    Write-Output ('TABMARKER_EXIT_CODE=' + $script:ExitCode)
}
exit $script:ExitCode
