#requires -Version 5.1
[CmdletBinding()]
param([Parameter(Mandatory = $true)][string]$OutputDirectory)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.IO.Compression.FileSystem
$repo = Split-Path $PSScriptRoot -Parent
$dist = Join-Path $repo 'dist'
$manifest = Get-Content -LiteralPath (Join-Path $dist 'manifest.json') -Raw | ConvertFrom-Json
$marker = Get-Content -LiteralPath (Join-Path $dist 'update-status.json') -Raw | ConvertFrom-Json
if ($manifest.name -cne 'TabMarker' -or $manifest.version -notmatch '^\d+(\.\d+){0,3}$' -or $marker.version -cne $manifest.version -or $marker.state -cne 'ready') { throw 'Build and deployment metadata do not match. Run npm run build first.' }
$destination = [IO.Path]::GetFullPath($OutputDirectory)
if ($destination.StartsWith($dist + '\', [StringComparison]::OrdinalIgnoreCase) -or $destination -eq $dist) { throw 'OutputDirectory must be outside dist.' }
[void][IO.Directory]::CreateDirectory($destination)
$packageName = "TabMarker-Chrome-$($manifest.version).zip"
$zip = Join-Path $destination $packageName
if (Test-Path -LiteralPath $zip) { throw 'Release ZIP already exists. Use a new output directory or version.' }
[IO.Compression.ZipFile]::CreateFromDirectory($dist, $zip, [IO.Compression.CompressionLevel]::Optimal, $false)
$checksum = (Get-FileHash -LiteralPath $zip -Algorithm SHA256).Hash.ToLowerInvariant()
Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'Update-TabMarker.ps1') -Destination $destination
$guide = [IO.File]::ReadAllText((Join-Path $repo 'docs\RMM-DEPLOYMENT.md')).Replace('Deploy-TabMarker-0.4.4.ps1', "Deploy-TabMarker-$($manifest.version).ps1").Replace('TabMarker-Chrome-0.4.4.zip', $packageName)
[IO.File]::WriteAllText((Join-Path $destination 'README-RMM.md'), $guide)
[IO.File]::WriteAllText((Join-Path $destination 'SHA256SUMS.txt'), "$checksum  $packageName`r`n")
$release = [ordered]@{ product = 'TabMarker'; version = $manifest.version; file = $packageName; sha256 = $checksum; bytes = (Get-Item -LiteralPath $zip).Length; builtAtUtc = [DateTime]::UtcNow.ToString('o') }
[IO.File]::WriteAllText((Join-Path $destination 'release.json'), ($release | ConvertTo-Json))
$wrapper = @'
#requires -Version 5.1
# Upload this script, Update-TabMarker.ps1 and the versioned extension ZIP together.
[CmdletBinding()]
param(
    [string]$PackageUrl,
    [string[]]$ChromeUserDataRoot,
    [string[]]$ExtensionPath,
    [string]$WorkRoot = "$env:ProgramData\TabMarkerRMM",
    [switch]$DryRun
)
$ErrorActionPreference = 'Stop'
$updateArgs = @{ Sha256 = '{{SHA256}}'; Version = '{{VERSION}}'; WorkRoot = $WorkRoot; DryRun = [bool]$DryRun }
if ($PackageUrl) { $updateArgs.PackageUrl = $PackageUrl }
else { $updateArgs.PackagePath = Join-Path $PSScriptRoot '{{PACKAGE}}' }
if ($ChromeUserDataRoot) { $updateArgs.ChromeUserDataRoot = $ChromeUserDataRoot }
if ($ExtensionPath) { $updateArgs.ExtensionPath = $ExtensionPath }
& (Join-Path $PSScriptRoot 'Update-TabMarker.ps1') @updateArgs
exit $LASTEXITCODE
'@
$wrapper = $wrapper.Replace('{{SHA256}}', $checksum).Replace('{{VERSION}}', $manifest.version).Replace('{{PACKAGE}}', $packageName)
[IO.File]::WriteAllText((Join-Path $destination "Deploy-TabMarker-$($manifest.version).ps1"), $wrapper)
Write-Output ($release | ConvertTo-Json)
