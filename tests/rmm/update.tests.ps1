#requires -Version 5.1
param([Parameter(Mandatory = $true)][string]$TestRoot)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version 2.0
Add-Type -AssemblyName System.IO.Compression.FileSystem
$repo = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
$updater = Join-Path $repo 'scripts\Update-TabMarker.ps1'
$root = Join-Path ([IO.Path]::GetFullPath($TestRoot)) ([guid]::NewGuid().ToString('N'))
[void][IO.Directory]::CreateDirectory($root)
$passed = 0
function Assert($Condition, [string]$Message) { if (!$Condition) { throw "ASSERTION FAILED: $Message" }; $script:passed++; Write-Output "PASS $Message" }
function Json([string]$Path, $Object) { [IO.File]::WriteAllText($Path, ($Object | ConvertTo-Json -Depth 30)) }
function Read([string]$Path) { return (Get-Content -LiteralPath $Path -Raw | ConvertFrom-Json) }
function Old([string]$Name) {
    $folder = Join-Path $root $Name
    [void][IO.Directory]::CreateDirectory($folder)
    Get-ChildItem -LiteralPath (Join-Path $repo 'dist') | Copy-Item -Destination $folder -Recurse
    $manifest = Read (Join-Path $folder 'manifest.json'); $manifest.version = '0.4.3'; Json (Join-Path $folder 'manifest.json') $manifest
    [IO.File]::Delete((Join-Path $folder 'update-status.json'))
    [IO.File]::WriteAllText((Join-Path $folder 'user-note.txt'), 'Keep this unrelated file')
    return $folder
}
function Zip([string]$Source, [string]$Name) {
    $path = Join-Path $root $Name; [IO.Compression.ZipFile]::CreateFromDirectory($Source, $path); return $path
}
function InvokeUpdate([string[]]$Arguments, [int]$ExpectedExit = 0) {
    $lines = @(& powershell.exe -NoLogo -NoProfile -File $updater @Arguments 2>&1 | ForEach-Object { "$_" })
    $code = $LASTEXITCODE
    $reportLine = @($lines | Where-Object { $_ -like 'TABMARKER_REPORT=*' })
    if ($code -ne $ExpectedExit -or $reportLine.Count -ne 1) { throw "Unexpected updater exit $code, expected $ExpectedExit : $($lines -join [Environment]::NewLine)" }
    $report = Read ($reportLine[0].Substring('TABMARKER_REPORT='.Length))
    if (!(Test-Path -LiteralPath $report.logPath -PathType Leaf)) { throw 'Persistent install.log was not created.' }
    if ((Get-Content -LiteralPath $report.logPath -Raw) -notlike '*Script started*') { throw 'Startup was not persisted before the operation.' }
    return $report
}
$releaseVersion = (Read (Join-Path $repo 'dist\manifest.json')).version
$parts = [version]$releaseVersion; $nextVersion = '{0}.{1}.{2}' -f $parts.Major, $parts.Minor, ($parts.Build + 1)
$zip = Zip (Join-Path $repo 'dist') 'release.zip'
$sha = (Get-FileHash -LiteralPath $zip -Algorithm SHA256).Hash
$chrome = Join-Path $root 'ChromeData'; [void][IO.Directory]::CreateDirectory($chrome)
$shared = Old 'shared-extension'; $second = Old 'second-extension'; $packed = Old 'packed-extension'
$profiles = @('Default', 'Profile 1', 'A custom profile')
foreach ($name in $profiles) { [void][IO.Directory]::CreateDirectory((Join-Path $chrome $name)) }
$records = @{ extensions = @{ settings = @{ ('a' * 32) = @{ location = 4; path = $shared }; ('b' * 32) = @{ location = 1; path = $packed } } } }
$pref1 = Join-Path $chrome 'Default\Secure Preferences'; Json $pref1 $records
$pref2 = Join-Path $chrome 'Profile 1\Preferences'; Json $pref2 $records
$pref3 = Join-Path $chrome 'A custom profile\Secure Preferences'; Json $pref3 @{ extensions = @{ settings = @{ ('c' * 32) = @{ location = 4; path = $second } } } }
$prefHashes = @{}; foreach ($file in @($pref1, $pref2, $pref3)) { $prefHashes[$file] = (Get-FileHash -LiteralPath $file).Hash }
$common = @('-PackagePath', $zip, '-Sha256', $sha, '-Version', $releaseVersion, '-ChromeUserDataRoot', $chrome, '-WorkRoot', (Join-Path $root 'runs'))
$dry = InvokeUpdate ($common + '-DryRun')
Assert (@($dry.results).Count -eq 2) 'discovers and deduplicates two unpacked folders from three profiles'
Assert (@($dry.results | Where-Object { $_.status -ne 'WouldUpdate' }).Count -eq 0) 'dry run plans changes without updating targets'
Assert ((Read (Join-Path $shared 'manifest.json')).version -eq '0.4.3') 'dry run keeps original version'
Assert (!(Test-Path -LiteralPath (Join-Path $shared '.tabmarker-rmm.lock'))) 'dry run does not create extension lock'
$updated = InvokeUpdate $common
Assert (@($updated.results | Where-Object { $_.status -eq 'Updated' }).Count -eq 2) 'updates both folders'
Assert ((Read (Join-Path $shared 'manifest.json')).version -eq $releaseVersion) 'writes expected release version'
Assert ((Read (Join-Path $shared 'update-status.json')).state -eq 'ready') 'publishes ready marker after verified update'
Assert ((Read (Join-Path $packed 'manifest.json')).version -eq '0.4.3') 'does not touch packed extension records'
Assert ((Get-Content -LiteralPath (Join-Path $shared 'user-note.txt') -Raw) -eq 'Keep this unrelated file') 'preserves unrelated files inside extension folder'
foreach ($file in $prefHashes.Keys) { Assert ((Get-FileHash -LiteralPath $file).Hash -eq $prefHashes[$file]) 'Chrome preference bytes remain unchanged' }
Assert (@($updated.results | Where-Object { !$_.reloadRequired -or $_.activeVersionVerified }).Count -eq 0) 'reports pending reload without claiming active runtime version'
$again = InvokeUpdate $common
Assert (@($again.results | Where-Object { $_.status -eq 'AlreadyCurrent' }).Count -eq 2) 'same release is idempotent'
$receipt = @($updated.results | Where-Object { $_.target -eq $shared })[0].receipt
$rollback = InvokeUpdate @('-RollbackReceipt', $receipt, '-ChromeUserDataRoot', $chrome, '-WorkRoot', (Join-Path $root 'runs'))
Assert ($rollback.results[0].status -eq 'RolledBack') 'explicit rollback succeeds'
Assert ((Read (Join-Path $shared 'manifest.json')).version -eq '0.4.3') 'rollback restores old manifest'
Assert ((Read (Join-Path $shared 'update-status.json')).version -eq '0.4.3') 'rollback publishes restored version for reload notice'
$badSha = InvokeUpdate @('-PackagePath', $zip, '-Sha256', ('0' * 64), '-Version', $releaseVersion, '-ExtensionPath', $shared, '-ChromeUserDataRoot', $chrome, '-WorkRoot', (Join-Path $root 'runs')) 1
Assert (($badSha.warnings -join ' ') -like '*SHA-256 mismatch*') 'wrong SHA-256 fails before deployment'
Assert ((Read (Join-Path $shared 'manifest.json')).version -eq '0.4.3') 'checksum failure leaves old files in place'
$badVersion = InvokeUpdate @('-PackagePath', $zip, '-Sha256', $sha, '-Version', $nextVersion, '-ExtensionPath', $shared, '-ChromeUserDataRoot', $chrome, '-WorkRoot', (Join-Path $root 'runs')) 1
Assert (($badVersion.warnings -join ' ') -like '*version does not match*') 'wrong expected version is rejected'
$emptyChrome = Join-Path $root 'empty-chrome'; [void][IO.Directory]::CreateDirectory($emptyChrome)
$none = InvokeUpdate @('-PackagePath', $zip, '-Sha256', $sha, '-Version', $releaseVersion, '-ChromeUserDataRoot', $emptyChrome, '-WorkRoot', (Join-Path $root 'runs')) 2
Assert ($none.results.Count -eq 0) 'missing installation returns exit 2'
$slipZip = Join-Path $root 'slip.zip'; $archive = [IO.Compression.ZipFile]::Open($slipZip, 'Create')
try { $entry = $archive.CreateEntry('../escape.txt'); $writer = New-Object IO.StreamWriter($entry.Open()); $writer.Write('bad'); $writer.Dispose() } finally { $archive.Dispose() }
$slip = InvokeUpdate @('-PackagePath', $slipZip, '-Sha256', (Get-FileHash -LiteralPath $slipZip).Hash, '-Version', $releaseVersion, '-ExtensionPath', $shared, '-ChromeUserDataRoot', $chrome, '-WorkRoot', (Join-Path $root 'runs')) 1
Assert (($slip.warnings -join ' ') -like '*Unsafe relative file path*') 'ZIP path traversal is rejected'
$source = Join-Path $root 'malformed-source'; [void][IO.Directory]::CreateDirectory($source); Get-ChildItem -LiteralPath (Join-Path $repo 'dist') | Copy-Item -Destination $source -Recurse
[IO.File]::Delete((Join-Path $source 'background.js')); $brokenZip = Zip $source 'missing-resource.zip'
$missing = InvokeUpdate @('-PackagePath', $brokenZip, '-Sha256', (Get-FileHash -LiteralPath $brokenZip).Hash, '-Version', $releaseVersion, '-ExtensionPath', $shared, '-ChromeUserDataRoot', $chrome, '-WorkRoot', (Join-Path $root 'runs')) 1
Assert (($missing.warnings -join ' ') -like '*Missing extension resource*') 'incomplete release is rejected'
# Force a failure after some writes, without mocking the updater: hold the old manifest open read-only.
$locked = Old 'locked-extension'
$handle = [IO.File]::Open((Join-Path $locked 'manifest.json'), [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]::Read)
try { $failure = InvokeUpdate @('-PackagePath', $zip, '-Sha256', $sha, '-Version', $releaseVersion, '-ExtensionPath', $locked, '-ChromeUserDataRoot', $emptyChrome, '-WorkRoot', (Join-Path $root 'runs')) 1 }
finally { $handle.Dispose() }
Assert ($failure.results[0].status -eq 'FailedRolledBack') 'interrupted write produces nonzero exit and completes automatic rollback'
Assert ((Read (Join-Path $locked 'manifest.json')).version -eq '0.4.3') 'locked manifest is never replaced by a partial deployment'
Assert (Test-Path -LiteralPath $failure.results[0].receipt) 'failed deployment retains verified rollback receipt'
# A lock on a new release asset can fail deployment while allowing a complete automatic rollback.
$auto = Old 'automatic-rollback'; $blocker = Join-Path $auto 'content.js'; [IO.File]::WriteAllText($blocker, 'old content')
$handle = [IO.File]::Open($blocker, [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]::Read)
try { $autoFail = InvokeUpdate @('-PackagePath', $zip, '-Sha256', $sha, '-Version', $releaseVersion, '-ExtensionPath', $auto, '-ChromeUserDataRoot', $emptyChrome, '-WorkRoot', (Join-Path $root 'runs')) 1 }
finally { $handle.Dispose() }
Assert ($autoFail.results[0].status -eq 'FailedRolledBack') 'locked code file is reported as a failure with successful rollback'
$badReceiptPath = @($updated.results | Where-Object { $_.target -eq $second })[0].receipt
$badReceipt = Read $badReceiptPath
$backupFile = Join-Path (Split-Path $badReceiptPath -Parent) ('files\' + $badReceipt.originalFiles[0].relative)
[IO.File]::AppendAllText($backupFile, 'tamper')
$receiptTarget = $badReceipt.target
if ((Read (Join-Path $receiptTarget 'manifest.json')).version -eq $releaseVersion) {
    $tampered = InvokeUpdate @('-RollbackReceipt', $badReceiptPath, '-ChromeUserDataRoot', $chrome, '-WorkRoot', (Join-Path $root 'runs')) 1
    Assert (($tampered.warnings -join ' ') -like '*Backup checksum mismatch*') 'tampered backup is rejected before rollback writes'
}
$sameVersionFile = Join-Path $second 'content.js'; [IO.File]::WriteAllText($sameVersionFile, 'modified installed code')
$sameVersion = InvokeUpdate @('-PackagePath', $zip, '-Sha256', $sha, '-Version', $releaseVersion, '-ExtensionPath', $second, '-ChromeUserDataRoot', $emptyChrome, '-WorkRoot', (Join-Path $root 'runs')) 1
Assert ($sameVersion.results[0].error -like '*Same version has different files*') 'modified same-version installation is not silently overwritten'
$keyed = Old 'keyed-extension'; $m = Read (Join-Path $keyed 'manifest.json'); $m | Add-Member -NotePropertyName key -NotePropertyValue 'existing-identity'; Json (Join-Path $keyed 'manifest.json') $m
$keyChange = InvokeUpdate @('-PackagePath', $zip, '-Sha256', $sha, '-Version', $releaseVersion, '-ExtensionPath', $keyed, '-ChromeUserDataRoot', $emptyChrome, '-WorkRoot', (Join-Path $root 'runs')) 1
Assert ($keyChange.results[0].error -like '*Extension key changed*') 'extension identity changes are rejected'
$newer = Old 'newer-extension'; $m = Read (Join-Path $newer 'manifest.json'); $m.version = $nextVersion; Json (Join-Path $newer 'manifest.json') $m
$downgrade = InvokeUpdate @('-PackagePath', $zip, '-Sha256', $sha, '-Version', $releaseVersion, '-ExtensionPath', $newer, '-ChromeUserDataRoot', $emptyChrome, '-WorkRoot', (Join-Path $root 'runs')) 1
Assert ($downgrade.results[0].error -like '*Downgrade refused*') 'ordinary deployment cannot downgrade an installation'
$sourceCopy = Old 'source-checkout'; [void][IO.Directory]::CreateDirectory((Join-Path $sourceCopy '.git'))
$sourceRefusal = InvokeUpdate @('-PackagePath', $zip, '-Sha256', $sha, '-Version', $releaseVersion, '-ExtensionPath', $sourceCopy, '-ChromeUserDataRoot', $emptyChrome, '-WorkRoot', (Join-Path $root 'runs')) 1
Assert (($sourceRefusal.warnings -join ' ') -like '*Source checkout or profile data*') 'source checkouts are refused as deployment targets'
$profileCopy = Join-Path $chrome 'Profile 9\extension'; [void][IO.Directory]::CreateDirectory($profileCopy); Get-ChildItem -LiteralPath (Join-Path $repo 'dist') | Copy-Item -Destination $profileCopy -Recurse
$profileRefusal = InvokeUpdate @('-PackagePath', $zip, '-Sha256', $sha, '-Version', $releaseVersion, '-ExtensionPath', $profileCopy, '-ChromeUserDataRoot', $chrome, '-WorkRoot', (Join-Path $root 'runs')) 1
Assert (($profileRefusal.warnings -join ' ') -like '*inside Chrome profile data*') 'profile data trees cannot be update destinations'
$duplicateZip = Join-Path $root 'duplicate.zip'; $archive = [IO.Compression.ZipFile]::Open($duplicateZip, 'Create')
try { [void]$archive.CreateEntry('manifest.json'); [void]$archive.CreateEntry('MANIFEST.json') } finally { $archive.Dispose() }
$duplicate = InvokeUpdate @('-PackagePath', $duplicateZip, '-Sha256', (Get-FileHash -LiteralPath $duplicateZip).Hash, '-Version', $releaseVersion, '-ExtensionPath', $shared, '-ChromeUserDataRoot', $emptyChrome, '-WorkRoot', (Join-Path $root 'runs')) 1
Assert (($duplicate.warnings -join ' ') -like '*duplicate paths*') 'case-insensitive duplicate ZIP paths are rejected'
$plainHttp = InvokeUpdate @('-PackageUrl', 'http://example.invalid/package.zip', '-Sha256', ('0' * 64), '-Version', $releaseVersion, '-ChromeUserDataRoot', $emptyChrome, '-WorkRoot', (Join-Path $root 'runs')) 1
Assert (($plainHttp.warnings -join ' ') -like '*must use HTTPS*') 'plain HTTP downloads are refused before any network request'
Assert (Test-Path -LiteralPath $dry.logPath -PathType Leaf) 'dry run writes a persistent install.log'
Assert ((Get-Content -LiteralPath $dry.logPath -Raw) -like '*[[]DiscoverProfiles[]]*') 'log captures discovery progress'
Assert ((Get-Content -LiteralPath $badSha.logPath -Raw) -like '*SHA-256 mismatch*') 'checksum errors are persisted in install.log'
Assert ($badSha.phase -eq 'ValidatePackage' -and $badSha.state -eq 'Failed') 'JSON report identifies the failed phase'
Assert ((Get-Content -LiteralPath $none.logPath -Raw) -like '*No validated unpacked*') 'no-installation failures leave a readable log'
$badRoot = InvokeUpdate @('-PackagePath', $zip, '-Sha256', $sha, '-Version', $releaseVersion, '-ChromeUserDataRoot', 'not-an-absolute-path', '-WorkRoot', (Join-Path $root 'runs')) 1
Assert ($badRoot.phase -eq 'DiscoverProfiles') 'failure before profile discovery completes still creates a report'
Assert ((Get-Content -LiteralPath $badRoot.logPath -Raw) -like '*Only absolute local Windows paths*') 'early discovery failure is recorded in install.log'
$blockedWork = Join-Path $root 'not-a-directory'; [IO.File]::WriteAllText($blockedWork, 'file blocks directory creation')
$fallbackData = Join-Path $root 'fallback-localappdata'; [void][IO.Directory]::CreateDirectory($fallbackData)
$previousLocalData = $env:LOCALAPPDATA
try {
    $env:LOCALAPPDATA = $fallbackData
    $fallback = InvokeUpdate @('-PackagePath', $zip, '-Sha256', $sha, '-Version', $releaseVersion, '-ChromeUserDataRoot', $emptyChrome, '-WorkRoot', $blockedWork) 1
} finally { $env:LOCALAPPDATA = $previousLocalData }
Assert ($fallback.diagnosticOnly -and $fallback.phase -eq 'Startup') 'unavailable work root produces diagnostic-only fallback report'
Assert ($fallback.logPath.StartsWith($fallbackData, [StringComparison]::OrdinalIgnoreCase)) 'fallback log uses the invoking account local app data'
Assert (!(Test-Path -LiteralPath (Join-Path $fallback.runPath 'package.zip'))) 'diagnostic fallback never downloads or deploys a package'
$previousLocalData = $env:LOCALAPPDATA
try {
    $env:LOCALAPPDATA = $blockedWork
    $noLogs = @(& powershell.exe -NoLogo -NoProfile -File $updater -PackagePath $zip -Sha256 $sha -Version $releaseVersion -ChromeUserDataRoot $emptyChrome -WorkRoot $blockedWork 2>&1 | ForEach-Object { "$_" })
    $noLogsExit = $LASTEXITCODE
} finally { $env:LOCALAPPDATA = $previousLocalData }
Assert ($noLogsExit -eq 1) 'no writable log directory returns failure'
Assert (($noLogs -join ' ') -like '*TABMARKER_START*' -and ($noLogs -join ' ') -like '*TABMARKER_REPORT_UNAVAILABLE=*') 'console still reports startup and missing log location when all log paths fail'
$junctionTarget = Old 'junction-destination'; $junction = Join-Path $root 'junction-extension'
[void](New-Item -ItemType Junction -Path $junction -Target $junctionTarget)
$linked = InvokeUpdate @('-PackagePath', $zip, '-Sha256', $sha, '-Version', $releaseVersion, '-ExtensionPath', $junction, '-ChromeUserDataRoot', $emptyChrome, '-WorkRoot', (Join-Path $root 'runs')) 1
Assert (($linked.warnings -join ' ') -like '*Redirecting or unsupported reparse point*') 'redirecting directory junction is still refused'
Assert ((Read (Join-Path $junctionTarget 'manifest.json')).version -eq '0.4.3') 'rejected junction destination stays unchanged'
Write-Output "RMM_TESTS_PASSED=$passed"
Write-Output "RMM_TEST_ROOT=$root"
