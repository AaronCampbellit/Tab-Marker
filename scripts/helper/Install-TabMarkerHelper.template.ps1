#requires -Version 5.1
<# Download from TabMarker Settings, then run once as the same Windows user as Chrome. #>
[CmdletBinding()]
param([ValidatePattern('^[a-p]{32}$')][string]$ExtensionId = '__TABMARKER_EXTENSION_ID__',
      [string[]]$ChromeUserDataRoot, [switch]$DryRun)
Set-StrictMode -Version 2.0
$ErrorActionPreference = 'Stop'
$log = $null; $stage = $null
$filesWritten = New-Object 'System.Collections.Generic.List[string]'
$original = @{}; $registryOriginal = @{}
try {
    Import-Module (Join-Path $PSHOME 'Modules\Microsoft.PowerShell.Utility\Microsoft.PowerShell.Utility.psd1') -ErrorAction Stop
    Import-Module (Join-Path $PSHOME 'Modules\Microsoft.PowerShell.Security\Microsoft.PowerShell.Security.psd1') -ErrorAction Stop
    $account = [Security.Principal.WindowsIdentity]::GetCurrent()
    if ($account.User.Value -in @('S-1-5-18', 'S-1-5-19', 'S-1-5-20')) { throw 'Run helper setup as the Windows user who uses Chrome, not a service account.' }
    $payload = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('__TABMARKER_HELPER_PAYLOAD__')) | ConvertFrom-Json
    $common = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($payload.files.'Helper.Common.ps1'.content))
    . ([scriptblock]::Create($common))
    $install = HelperPath (Join-Path $env:LOCALAPPDATA 'TabMarker\Helper')
    [void][IO.Directory]::CreateDirectory($install)
    [void](HelperPath $install)
    $directory = New-Object IO.DirectoryInfo($install)
    $acl = $directory.GetAccessControl([Security.AccessControl.AccessControlSections]::Access)
    $acl.SetAccessRuleProtection($true, $false)
    foreach ($sid in @('S-1-5-18', 'S-1-5-32-544', $account.User.Value)) {
        $identity = New-Object Security.Principal.SecurityIdentifier($sid)
        $rule = New-Object Security.AccessControl.FileSystemAccessRule($identity, 'FullControl', 'ContainerInherit,ObjectInherit', 'None', 'Allow'); [void]$acl.SetAccessRule($rule)
    }
    # Persist only the DACL; reinstall must not request audit/SACL privileges.
    $directory.SetAccessControl($acl)
    $logs = HelperPath (Join-Path $install 'logs'); [void][IO.Directory]::CreateDirectory($logs)
    $log = Join-Path $logs ('setup-' + [DateTime]::UtcNow.ToString('yyyyMMddTHHmmssfffZ') + '.log')
    [IO.File]::WriteAllText($log, ('Helper setup started for ' + $ExtensionId + '; DryRun=' + [bool]$DryRun + [Environment]::NewLine))
    Write-Output ('HELPER_INSTALL_LOG=' + $log)
    $roots = @(HelperRoots $ChromeUserDataRoot)
    $bindings = @(HelperBindings $ExtensionId $roots)
    if ($bindings.Count -eq 0) { throw 'Could not find this TabMarker installation. Open Chrome and retry. For a custom Chrome profile location, pass -ChromeUserDataRoot with its User Data folder.' }
    $names = @('TabMarkerHelper.exe', 'Helper.Common.ps1', 'Invoke-TabMarkerHelper.ps1', 'Update-TabMarker.ps1', 'Uninstall-TabMarkerHelper.ps1')
    if (@($payload.files.PSObject.Properties).Count -ne $names.Count) { throw 'Unexpected installer payload.' }
    foreach ($name in $names) {
        $entry = $payload.files.$name
        $bytes = [Convert]::FromBase64String($entry.content); $hasher = [Security.Cryptography.SHA256]::Create()
        try { $hash = ([BitConverter]::ToString($hasher.ComputeHash($bytes))).Replace('-', '').ToLowerInvariant() } finally { $hasher.Dispose() }
        if ($hash -cne $entry.sha256) { throw "Installer payload checksum mismatch: $name" }
    }
    $configPath = Join-Path $install 'config.json'
    $registrations = @()
    if (Test-Path -LiteralPath $configPath) {
        [void](HelperPath $configPath)
        $existing = ReadHelperJson $configPath
        if ($existing.product -cne 'TabMarker' -or $existing.protocol -ne 1) { throw 'An incompatible helper already occupies the install folder.' }
        if ([version]$existing.helperVersion -gt [version]$payload.version) { throw 'A newer helper is already installed. Download its installer from the latest TabMarker Settings.' }
        $registrations = @($existing.registrations | Where-Object { $_.id -cne $ExtensionId })
    }
    $registrations += [pscustomobject]@{ id = $ExtensionId; roots = @($bindings.root | Select-Object -Unique) }
    $config = [ordered]@{ product = 'TabMarker'; protocol = 1; helperVersion = $payload.version; updaterSha256 = $payload.files.'Update-TabMarker.ps1'.sha256; registrations = $registrations }
    $hostManifest = [ordered]@{ name = $HelperName; description = 'TabMarker verified GitHub updater'; path = (Join-Path $install 'TabMarkerHelper.exe'); type = 'stdio'; allowed_origins = @($registrations | ForEach-Object { 'chrome-extension://' + $_.id + '/' }) }
    if ($DryRun) { [IO.File]::AppendAllText($log, 'Validation complete. Dry run: no helper program files or registration written.'); Write-Output ('HELPER_WOULD_INSTALL=' + $install); Write-Output ('HELPER_EXTENSION_ID=' + $ExtensionId); Write-Output ('HELPER_TARGETS=' + (($bindings.target | Select-Object -Unique) -join ', ')); exit 0 }
    $stage = Join-Path $install ('setup-' + [guid]::NewGuid().ToString('N')); [void][IO.Directory]::CreateDirectory($stage)
    foreach ($name in $names) { [IO.File]::WriteAllBytes((Join-Path $stage $name), [Convert]::FromBase64String($payload.files.$name.content)) }
    [IO.File]::WriteAllText((Join-Path $stage 'config.json'), ($config | ConvertTo-Json -Depth 15), [Text.Encoding]::UTF8)
    [IO.File]::WriteAllText((Join-Path $stage 'host.json'), ($hostManifest | ConvertTo-Json -Depth 15), [Text.Encoding]::UTF8)
    foreach ($name in $names + @('config.json', 'host.json')) {
        $destination = HelperPath (Join-Path $install $name)
        $original[$name] = $null; if ([IO.File]::Exists($destination)) { $original[$name] = [IO.File]::ReadAllBytes($destination) }
        $filesWritten.Add($name)
        for ($attempt = 0; $attempt -lt 4; $attempt++) {
            try { if ([IO.File]::Exists($destination)) { [IO.File]::Replace((Join-Path $stage $name), $destination, [NullString]::Value) } else { [IO.File]::Move((Join-Path $stage $name), $destination) }; break }
            catch { if ($attempt -eq 3) { throw }; Start-Sleep -Milliseconds 1000 }
        }
    }
    $registryPath = 'Software\Google\Chrome\NativeMessagingHosts\' + $HelperName
    $views = @([Microsoft.Win32.RegistryView]::Registry32); if ([Environment]::Is64BitOperatingSystem) { $views += [Microsoft.Win32.RegistryView]::Registry64 }
    foreach ($view in $views) {
        $base = [Microsoft.Win32.RegistryKey]::OpenBaseKey([Microsoft.Win32.RegistryHive]::CurrentUser, $view)
        try {
            $old = $base.OpenSubKey($registryPath); try { $registryOriginal[[string]$view] = $(if ($old) { $old.GetValue('') } else { $null }) } finally { if ($old) { $old.Dispose() } }
        } finally { $base.Dispose() }
    }
    foreach ($view in $views) {
        $base = [Microsoft.Win32.RegistryKey]::OpenBaseKey([Microsoft.Win32.RegistryHive]::CurrentUser, $view)
        try { $key = $base.CreateSubKey($registryPath); try { $key.SetValue('', (Join-Path $install 'host.json')) } finally { $key.Dispose() } } finally { $base.Dispose() }
    }
    [IO.File]::AppendAllText($log, ('Helper ready. Return to TabMarker Settings and click Check connection.' + [Environment]::NewLine))
    Write-Output 'HELPER_INSTALLED=Return to TabMarker Settings and click Check connection.'
} catch {
    $failure = $_.Exception.Message
    foreach ($name in $filesWritten) {
        try { $destination = Join-Path $install $name; if ($null -eq $original[$name]) { [IO.File]::Delete($destination) } else { [IO.File]::WriteAllBytes($destination, $original[$name]) } } catch { Write-Warning ('Could not restore helper file: ' + $name) }
    }
    foreach ($viewName in $registryOriginal.Keys) {
        $base = [Microsoft.Win32.RegistryKey]::OpenBaseKey([Microsoft.Win32.RegistryHive]::CurrentUser, [Microsoft.Win32.RegistryView]::$viewName)
        try { if ($null -eq $registryOriginal[$viewName]) { $base.DeleteSubKeyTree($registryPath, $false) } else { $key = $base.CreateSubKey($registryPath); try { $key.SetValue('', $registryOriginal[$viewName]) } finally { $key.Dispose() } } } finally { $base.Dispose() }
    }
    if ($log) { [IO.File]::AppendAllText($log, ('FAILED: ' + $failure + [Environment]::NewLine)) }
    Write-Error $failure -ErrorAction Continue
    exit 1
} finally {
    if ($stage -and [IO.Directory]::Exists($stage)) {
        # Setup staging contains only this invocation's known flat payload files.
        try { [void](HelperPath $stage); foreach ($file in (Get-ChildItem -LiteralPath $stage -File -Force)) { [void](HelperPath $file.FullName); [IO.File]::Delete($file.FullName) }; [IO.Directory]::Delete($stage, $false) }
        catch { Write-Warning ('Setup cleanup failed: ' + $_.Exception.Message) }
    }
}
