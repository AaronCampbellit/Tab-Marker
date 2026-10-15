#requires -Version 5.1
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'Helper.Common.ps1')
$expected = HelperPath (Join-Path $env:LOCALAPPDATA 'TabMarker\Helper')
if ($expected -cne (HelperPath $PSScriptRoot)) { throw 'Run the uninstaller from its installed helper folder.' }
$path = 'Software\Google\Chrome\NativeMessagingHosts\' + $HelperName
$views = @([Microsoft.Win32.RegistryView]::Registry32); if ([Environment]::Is64BitOperatingSystem) { $views += [Microsoft.Win32.RegistryView]::Registry64 }
foreach ($view in $views) {
    $base = [Microsoft.Win32.RegistryKey]::OpenBaseKey([Microsoft.Win32.RegistryHive]::CurrentUser, $view)
    try { $key = $base.OpenSubKey($path); $matches = $false; if ($key) { try { $matches = $key.GetValue('') -eq (Join-Path $expected 'host.json') } finally { $key.Dispose() } }; if ($matches) { $base.DeleteSubKeyTree($path, $false) } } finally { $base.Dispose() }
}
foreach ($name in @('TabMarkerHelper.exe', 'Invoke-TabMarkerHelper.ps1', 'Update-TabMarker.ps1', 'config.json', 'host.json', 'Uninstall-TabMarkerHelper.ps1', 'Helper.Common.ps1')) { $file = HelperPath (Join-Path $expected $name); if ([IO.File]::Exists($file)) { [IO.File]::Delete($file) } }
Write-Output 'TabMarker helper removed. Logs and any needed recovery backups were kept. Saved browser rules are unchanged.'
