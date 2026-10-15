Set-StrictMode -Version 2.0
$ErrorActionPreference = 'Stop'
$HelperName = 'com.rarity.tabmarker'
$Repository = 'AaronCampbellit/Tab-Marker'
function ReadHelperJson([string]$Path) {
    $stream = [IO.File]::Open($Path, 'Open', 'Read', [IO.FileShare]::ReadWrite -bor [IO.FileShare]::Delete)
    try { $reader = New-Object IO.StreamReader($stream); try { return ($reader.ReadToEnd() | ConvertFrom-Json) } finally { $reader.Dispose() } } finally { $stream.Dispose() }
}
function HelperValue($Object, [string]$Name) {
    if ($null -eq $Object) { return $null }; $p = $Object.PSObject.Properties[$Name]; if ($p) { return $p.Value }; return $null
}
function HelperPath([string]$Path, [switch]$AllowCloud) {
    if ($Path -notmatch '^[A-Za-z]:[\\/]' -or $Path -match '["\x00-\x1f]') { throw 'Expected an absolute local Windows path.' }
    $full = [IO.Path]::GetFullPath($Path).TrimEnd('\'); $cursor = $full
    while ($cursor) {
        if (Test-Path -LiteralPath $cursor) {
            $item = Get-Item -LiteralPath $cursor -Force
            if ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) {
                $cloud = $false
                if ($AllowCloud) {
                    $fsutil = Join-Path $env:SystemRoot 'System32\fsutil.exe'; if ($env:PROCESSOR_ARCHITEW6432) { $fsutil = Join-Path $env:SystemRoot 'Sysnative\fsutil.exe' }
                    $tagData = @(& $fsutil reparsepoint query $cursor 2>&1)
                    $match = [regex]::Match(($tagData -join ' '), '(?i)0x([0-9a-f]{8})')
                    if ($LASTEXITCODE -eq 0 -and $match.Success) { $cloud = (([Convert]::ToUInt32($match.Groups[1].Value, 16) -band 0xFFFF0FFFL) -eq 0x9000001AL) }
                }
                if (!$cloud) { throw "Redirecting or unsupported reparse point: $cursor" }
            }
        }
        $parent = Split-Path $cursor -Parent; if ($parent -eq $cursor) { break }; $cursor = $parent
    }
    return $full
}
function HelperRoots([string[]]$Roots) {
    if ($Roots) { return @($Roots | ForEach-Object { HelperPath $_ } | Select-Object -Unique) }
    foreach ($channel in @('Chrome', 'Chrome Beta', 'Chrome Dev', 'Chrome SxS')) {
        $root = Join-Path $env:LOCALAPPDATA "Google\$channel\User Data"
        if (Test-Path -LiteralPath $root -PathType Container) { HelperPath $root }
    }
}
function HelperBindings([string]$Id, [string[]]$Roots) {
    if ($Id -cnotmatch '^[a-p]{32}$') { throw 'Invalid TabMarker extension ID.' }
    foreach ($root in $Roots) {
        [void](HelperPath $root)
        if (!(Test-Path -LiteralPath $root -PathType Container)) { continue }
        foreach ($profile in (Get-ChildItem -LiteralPath $root -Directory -Force)) {
            if ($profile.Attributes -band [IO.FileAttributes]::ReparsePoint) { continue }
            foreach ($name in @('Secure Preferences', 'Preferences')) {
                $prefs = Join-Path $profile.FullName $name
                if (!(Test-Path -LiteralPath $prefs -PathType Leaf)) { continue }
                [void](HelperPath $prefs)
                $record = HelperValue (HelperValue (HelperValue (ReadHelperJson $prefs) 'extensions') 'settings') $Id
                if (!$record -or (HelperValue $record 'location') -ne 4) { continue }
                $target = HelperPath ([string](HelperValue $record 'path')) -AllowCloud
                $manifest = ReadHelperJson (Join-Path $target 'manifest.json')
                if ((HelperValue $manifest 'name') -cne 'TabMarker' -or (HelperValue $manifest 'manifest_version') -ne 3 -or (HelperValue (HelperValue $manifest 'background') 'service_worker') -cne 'background.js' -or (HelperValue (HelperValue $manifest 'action') 'default_popup') -cne 'popup.html' -or (HelperValue $manifest 'options_page') -cne 'options.html') { throw 'The registered extension is not a built TabMarker installation.' }
                foreach ($reserved in @('.git', 'src', 'node_modules')) { if (Test-Path -LiteralPath (Join-Path $target $reserved)) { throw 'Select the built installation, not a source checkout.' } }
                foreach ($file in @('background.js', 'content.js', 'popup.html', 'options.html')) { if (!(Test-Path -LiteralPath (Join-Path $target $file) -PathType Leaf)) { throw "Missing TabMarker resource: $file" } }
                [pscustomobject]@{ root = $root; target = $target; version = $manifest.version }
            }
        }
    }
}
function HelperFetch([string]$Url, [int]$MaxBytes = 2097152) {
    [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
    for ($i = 0; $i -le 5; $i++) {
        $uri = [uri]$Url
        if (!$uri.IsAbsoluteUri -or $uri.Scheme -ne 'https' -or $uri.UserInfo -or $uri.Host -notin @('api.github.com', 'github.com', 'release-assets.githubusercontent.com', 'objects.githubusercontent.com')) { throw 'Unapproved GitHub download location.' }
        $request = [Net.HttpWebRequest]::Create($uri); $request.AllowAutoRedirect = $false; $request.Timeout = 30000; $request.ReadWriteTimeout = 30000; $request.UserAgent = 'TabMarker-Helper/1'; $request.Accept = 'application/vnd.github+json'
        $response = $request.GetResponse()
        try {
            if ([int]$response.StatusCode -in @(301, 302, 303, 307, 308)) { $Url = [uri]::new($uri, $response.Headers['Location']).AbsoluteUri; continue }
            if ([int]$response.StatusCode -ne 200 -or $response.ContentLength -gt $MaxBytes) { throw 'GitHub response is unavailable or too large.' }
            $input = $response.GetResponseStream(); $memory = New-Object IO.MemoryStream
            try { $buffer = New-Object byte[] 8192; while (($n = $input.Read($buffer, 0, $buffer.Length)) -gt 0) { if ($memory.Length + $n -gt $MaxBytes) { throw 'GitHub response exceeds its size limit.' }; $memory.Write($buffer, 0, $n) }; return ,$memory.ToArray() } finally { $input.Dispose(); $memory.Dispose() }
        } finally { $response.Dispose() }
    }
    throw 'Too many GitHub redirects.'
}
function HelperRelease {
    $release = [Text.Encoding]::UTF8.GetString((HelperFetch "https://api.github.com/repos/$Repository/releases/latest")) | ConvertFrom-Json
    if ($release.draft -or $release.prerelease -or $release.tag_name -cnotmatch '^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$') { throw 'Latest release is not a stable TabMarker version.' }
    $version = $release.tag_name.Substring(1)
    if (@($version.Split('.') | Where-Object { [long]$_ -gt 65535 }).Count) { throw 'Invalid Chrome release version.' }
    $packageName = "TabMarker-Chrome-$version.zip"
    $packages = @($release.assets | Where-Object { $_.name -ceq $packageName -and $_.state -ceq 'uploaded' })
    $metadatas = @($release.assets | Where-Object { $_.name -ceq 'release.json' -and $_.state -ceq 'uploaded' })
    if ($packages.Count -ne 1 -or $metadatas.Count -ne 1) { throw 'This release is incomplete. Try again later.' }
    $package = $packages[0]; $metadata = $metadatas[0]
    $prefix = "https://github.com/$Repository/releases/download/v$version/"
    if ($package.browser_download_url -cne ($prefix + $packageName) -or $metadata.browser_download_url -cne ($prefix + 'release.json') -or $package.digest -cnotmatch '^sha256:[0-9a-f]{64}$' -or $metadata.digest -cnotmatch '^sha256:[0-9a-f]{64}$' -or $package.size -gt 104857600) { throw 'Release asset provenance is invalid.' }
    $bytes = HelperFetch $metadata.browser_download_url 65536
    $hasher = [Security.Cryptography.SHA256]::Create()
    try { $digest = ([BitConverter]::ToString($hasher.ComputeHash($bytes))).Replace('-', '').ToLowerInvariant() } finally { $hasher.Dispose() }
    if (('sha256:' + $digest) -cne $metadata.digest) { throw 'Release metadata checksum mismatch.' }
    $manifest = [Text.Encoding]::UTF8.GetString($bytes) | ConvertFrom-Json
    if ($manifest.product -cne 'TabMarker' -or $manifest.version -cne $version -or $manifest.file -cne $packageName -or $manifest.downloadUrl -cne $package.browser_download_url -or ('sha256:' + $manifest.sha256) -cne $package.digest -or $manifest.bytes -ne $package.size) { throw 'Release metadata does not match the published GitHub package.' }
    if ((HelperValue $manifest 'minimumHelperProtocol') -and $manifest.minimumHelperProtocol -gt 1) { throw 'This release needs a newer update helper. Install its helper from the latest release first.' }
    return $manifest
}
