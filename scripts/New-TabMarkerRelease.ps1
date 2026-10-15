#requires -Version 5.1
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][string]$OutputDirectory,
    [ValidatePattern('^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$')][string]$Repository = 'AaronCampbellit/Tab-Marker'
)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.IO.Compression.FileSystem
$repo = Split-Path $PSScriptRoot -Parent
& node (Join-Path $PSScriptRoot 'sync-version.mjs') --check
if ($LASTEXITCODE -ne 0) { throw 'Version checks failed. Bump/synchronize the version and rebuild before packaging.' }
$source = Get-Content -LiteralPath (Join-Path $repo 'package.json') -Raw | ConvertFrom-Json
$dist = Join-Path $repo 'dist'
$manifest = Get-Content -LiteralPath (Join-Path $dist 'manifest.json') -Raw | ConvertFrom-Json
$marker = Get-Content -LiteralPath (Join-Path $dist 'update-status.json') -Raw | ConvertFrom-Json
if ($manifest.name -cne 'TabMarker' -or $manifest.version -notmatch '^\d+(\.\d+){0,3}$' -or $manifest.version -cne $source.version -or $marker.version -cne $manifest.version -or $marker.state -cne 'ready') { throw 'Build, source and deployment metadata do not match. Run npm run build first.' }
$destination = [IO.Path]::GetFullPath($OutputDirectory)
if ($destination.StartsWith($dist + '\', [StringComparison]::OrdinalIgnoreCase) -or $destination -eq $dist) { throw 'OutputDirectory must be outside dist.' }
[void][IO.Directory]::CreateDirectory($destination)
$packageName = "TabMarker-Chrome-$($manifest.version).zip"
$zip = Join-Path $destination $packageName
if (Test-Path -LiteralPath $zip) { throw 'Release ZIP already exists. Use a new output directory or version.' }
[IO.Compression.ZipFile]::CreateFromDirectory($dist, $zip, [IO.Compression.CompressionLevel]::Optimal, $false)
$checksum = (Get-FileHash -LiteralPath $zip -Algorithm SHA256).Hash.ToLowerInvariant()
$downloadUrl = "https://github.com/$Repository/releases/download/v$($manifest.version)/$packageName"
Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'Update-TabMarker.ps1') -Destination $destination
$guide = [IO.File]::ReadAllText((Join-Path $repo 'docs\RMM-DEPLOYMENT.md')).Replace('<version>', $manifest.version).Replace('AaronCampbellit/Tab-Marker', $Repository)
[IO.File]::WriteAllText((Join-Path $destination 'README-RMM.md'), $guide)
[IO.File]::WriteAllText((Join-Path $destination 'SHA256SUMS.txt'), "$checksum  $packageName`r`n")
$release = [ordered]@{ product = 'TabMarker'; version = $manifest.version; file = $packageName; downloadUrl = $downloadUrl; sha256 = $checksum; bytes = (Get-Item -LiteralPath $zip).Length; builtAtUtc = [DateTime]::UtcNow.ToString('o') }
[IO.File]::WriteAllText((Join-Path $destination 'release.json'), ($release | ConvertTo-Json))
$wrapper = @'
#requires -Version 5.1
# Standalone RMM launcher. Downloads only the pinned built release by default.
[CmdletBinding(DefaultParameterSetName = 'Update')]
param(
    [Parameter(ParameterSetName = 'Update')][string]$PackageUrl = '{{URL}}',
    [Parameter(ParameterSetName = 'Update')][string]$PackagePath,
    [Parameter(ParameterSetName = 'Update')][ValidateSet('{{SHA256}}')][string]$Sha256 = '{{SHA256}}',
    [Parameter(ParameterSetName = 'Update')][ValidateSet('{{VERSION}}')][string]$Version = '{{VERSION}}',
    [Parameter(Mandatory = $true, ParameterSetName = 'Rollback')][string]$RollbackReceipt,
    [string[]]$ChromeUserDataRoot,
    [string[]]$ExtensionPath,
    [string]$WorkRoot = "$env:ProgramData\TabMarkerRMM",
    [switch]$DryRun
)
# An explicit local ZIP switches off the default online download.
if ($PSBoundParameters.ContainsKey('PackagePath') -and !$PSBoundParameters.ContainsKey('PackageUrl')) { $PackageUrl = $null }
'@
$wrapper = $wrapper.Replace('{{SHA256}}', $checksum).Replace('{{VERSION}}', $manifest.version).Replace('{{URL}}', $downloadUrl)
$updater = [IO.File]::ReadAllText((Join-Path $PSScriptRoot 'Update-TabMarker.ps1'))
$bodyStart = $updater.IndexOf('Set-StrictMode -Version 2.0', [StringComparison]::Ordinal)
if ($bodyStart -lt 0) { throw 'Cannot find updater implementation to embed in launcher.' }
$wrapper += [Environment]::NewLine + $updater.Substring($bodyStart)
[IO.File]::WriteAllText((Join-Path $destination "Deploy-TabMarker-$($manifest.version).ps1"), $wrapper)
Write-Output ($release | ConvertTo-Json)
