#requires -Version 5.1
param([Parameter(Mandatory = $true)][ValidatePattern('^chrome-extension://[a-p]{32}/$')][string]$Origin,
      [Parameter(Mandatory = $true)][ValidateSet('status', 'check', 'update')][string]$Action,
      [string]$ExpectedVersion)
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = New-Object Text.UTF8Encoding($false)
Set-StrictMode -Version 2.0
$exitCode = 1
try {
    # Load script-based utility exports at script scope before JSON-reading functions.
    Import-Module (Join-Path $PSHOME 'Modules\Microsoft.PowerShell.Utility\Microsoft.PowerShell.Utility.psd1') -ErrorAction Stop
    Import-Module (Join-Path $PSHOME 'Modules\Microsoft.PowerShell.Security\Microsoft.PowerShell.Security.psd1') -ErrorAction Stop
    . (Join-Path $PSScriptRoot 'Helper.Common.ps1')
    [void](HelperPath $PSScriptRoot)
    $config = ReadHelperJson (Join-Path $PSScriptRoot 'config.json')
    if ($config.product -cne 'TabMarker' -or $config.protocol -ne 1) { throw 'Helper configuration is invalid. Reinstall the helper.' }
    $id = $Origin.Substring(19, 32)
    $registrations = @($config.registrations | Where-Object { $_.id -ceq $id })
    if ($registrations.Count -ne 1) { throw 'This TabMarker installation is not authorized. Install its helper from Settings.' }
    $registration = $registrations[0]
    if ($Action -eq 'status') { $result = [ordered]@{ ok = $true; protocol = 1; helperVersion = $config.helperVersion }; $exitCode = 0 }
    else {
        $bindings = @(HelperBindings $id $registration.roots)
        if ($bindings.Count -eq 0) { throw 'This TabMarker installation is no longer registered in Chrome. Reinstall the helper from its Settings page.' }
        $release = HelperRelease
        if ($Action -eq 'check') { $result = [ordered]@{ ok = $true; protocol = 1; helperVersion = $config.helperVersion; release = $release }; $exitCode = 0 }
        else {
            if ($ExpectedVersion -cne $release.version) { throw 'The release changed. Check for updates again before installing.' }
            $updater = Join-Path $PSScriptRoot 'Update-TabMarker.ps1'
            if ((Get-FileHash -LiteralPath $updater -Algorithm SHA256).Hash.ToLowerInvariant() -cne $config.updaterSha256) { throw 'The installed updater checksum is invalid. Reinstall the helper.' }
            $arguments = @{ PackageUrl = $release.downloadUrl; Sha256 = $release.sha256; Version = $release.version; ChromeUserDataRoot = @($registration.roots); OnlyExtensionId = $id; WorkRoot = (Join-Path $env:LOCALAPPDATA 'TabMarker\Helper\runs') }
            $final = $null
            & $updater @arguments | ForEach-Object {
                $line = [string]$_
                if ($line.StartsWith('TABMARKER_REPORT_JSON=')) { $final = $line.Substring('TABMARKER_REPORT_JSON='.Length) | ConvertFrom-Json }
                else { Write-Output $line }
            }
            if ($null -eq $final) { throw 'Updater returned no final result. Review the helper run log.' }
            $exitCode = $final.exitCode
            $result = [ordered]@{ ok = ($exitCode -eq 0); protocol = 1; helperVersion = $config.helperVersion; report = $final; error = $(if ($exitCode -eq 0) { $null } else { 'Update failed. Review the log for details.' }) }
        }
    }
} catch { $result = [ordered]@{ ok = $false; error = $_.Exception.Message } }
Write-Output ('TABMARKER_HELPER_JSON=' + ($result | ConvertTo-Json -Depth 35 -Compress))
exit $exitCode
