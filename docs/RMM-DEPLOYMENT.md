# TabMarker updates through RMM

This package updates **existing unpacked installations** on Windows using Windows PowerShell 5.1 or later. It does not install the extension into new Chrome profiles, enable Developer mode, or change browser policy. Run through your RMM's normal approved PowerShell execution process. Start with one pilot device.

## Quick deployment

Upload these three files together to the RMM job's attachment directory:

- `Deploy-TabMarker-0.4.4.ps1` (version and checksum already filled in)
- `Update-TabMarker.ps1`
- `TabMarker-Chrome-0.4.4.zip`

Run as **LocalSystem** to reach all local Windows user profiles. First run the wrapper with `-DryRun`; review the target paths and warnings. Then run it without `-DryRun` to deploy. In an RMM that launches the script directly, put the wrapper's contents in the component and place the other two files beside that script. Otherwise launch the wrapper from the downloaded attachment directory:

```powershell
powershell.exe -NoLogo -NoProfile -File .\Deploy-TabMarker-0.4.4.ps1 -DryRun
powershell.exe -NoLogo -NoProfile -File .\Deploy-TabMarker-0.4.4.ps1
```

The wrapper also accepts `-PackageUrl 'https://your-host/TabMarker-Chrome-0.4.4.zip'` instead of the adjacent ZIP. That URL is an example: publish the exact built ZIP to a reachable HTTPS location first. The expected checksum remains pinned in the wrapper. Private GitHub credentials are not bundled; use an RMM attachment or an authorized HTTPS download endpoint.

## What users see

Once the files are fully verified, TabMarker's popup and Manage rules page show **Update installed — Reload TabMarker** when their loaded version differs from the deployed version. Clicking it uses `chrome.runtime.reload()`. Unsaved editor changes require confirmation. Saved rules and backup-file connection data remain in Chrome's profile. Temporary tab-only labels reset. Users should refresh open websites afterward.

The prompt checks on opening, on focus, and every 15 seconds while its page is visible. A deployment-in-progress marker suppresses reload until installation finishes. It only checks local deployment files; it does not check GitHub or download updates.

The first rollout to a pre-0.4.4 version adds this feature. Reopen the popup to load the new interface; an already-open older settings page will not acquire the feature automatically. If the new interface cannot load, reload TabMarker at `chrome://extensions` or fully exit and reopen Chrome. The script never closes Chrome.

## Discovery and protection of user data

- Reads Windows ProfileList to locate standard Chrome Stable, Beta, Dev, and Canary user-data roots for local users. Reads `Secure Preferences` and `Preferences` in immediate profile directories, including custom-named profiles.
- Uses unpacked records (`location: 4`) and their absolute folder paths. Unpacked records commonly have no cached manifest, so it reads the manifest from disk and verifies TabMarker's name, MV3 format, entry points, resources, and HTML asset links. Packed/store installations are excluded.
- Deduplicates a folder shared by several Chrome profiles. Updates that folder once and reports all discovered profiles/extension IDs.
- Custom `--user-data-dir` locations require `-ChromeUserDataRoot`. A known built folder can be supplied with `-ExtensionPath`; this explicit option does not prove it is loaded in a browser. These array parameters work naturally through the PowerShell call operator; for command-line launch, use one root per job or a small PowerShell wrapper for arrays.
- Leaves Chrome preferences, extension storage, IndexedDB and saved rules untouched. Keeps the existing extension folder path and rejects changes to a manifest signing key. Does not uninstall/reinstall or move the extension.
- Rejects source checkouts, broad folders, folders inside known Chrome data roots, reparse points/junctions/cloud placeholder files, and packages or extension trees exceeding 100 MiB / 2,500 files. Missing or inaccessible records are reported; discovery does not scan the entire disk. Relocated Windows LocalAppData/custom data locations need an explicit root.

## Validation, backup, and rollback

Downloads a specific HTTPS ZIP (HTTPS-only redirects, bounded size), verifies the caller-supplied SHA-256 before extraction, rejects unsafe/duplicate ZIP paths, and validates the expected version and build resources. A GitHub **source-code ZIP is not a built extension**.

Before each update, captures a complete file backup and SHA-256 inventory. Uses a per-extension exclusive deployment lock and atomic file replacements, retrying the same write up to three additional times for transient locks. Identical files are skipped. Writes the manifest after other package files and marks the deployment ready only after verification. Old hashed assets and unrelated files are retained so already-open extension pages can still load their old resources. The lock file remains as a harmless coordination file.

An update failure triggers automatic rollback. If a persistent file lock or endpoint control prevents rollback, the report states `RollbackFailed`, the deployment stays unready, and the verified backup/receipt remain available. Resolve the reported block through your normal security process before retrying. No controls are disabled or bypassed.

Replacement is atomic per file, not across the entire directory. Retaining old hashed assets and installing new assets before entry points reduces disruption, but opening Chrome or starting an extension context during deployment can still overlap file changes. Keep deployments brief, pilot the running-browser case, and use a maintenance window when necessary.

Each successful backup has a `receipt.json`. To inspect rollback without changing extension files:

```powershell
.\Update-TabMarker.ps1 -RollbackReceipt 'C:\ProgramData\TabMarkerRMM\runs\<run>\backups\<target>\receipt.json' -DryRun
```

Remove `-DryRun` to restore. Backup hashes are checked before writing. The receipt must match the installed old/new version; it cannot overwrite a later unrelated version. Rollback removes newly added package files, restores the original files, and publishes a fresh local marker for the restored version. It leaves harmless empty directories and the coordination lock. Existing original deployment metadata is replaced by that fresh marker. A reload is required afterward. Ordinary update mode refuses downgrades or different files with the same version number.

## RMM results

Default run directory: `C:\ProgramData\TabMarkerRMM\runs\<timestamp-id>`. Each run folder is restricted to SYSTEM, administrators, and the invoking identity. It contains staging, the downloaded ZIP, backup receipts/files, and `report.json`. `-WorkRoot` selects another location outside Chrome profiles; `-DryRun` still writes its staging/report there but never changes extension files. Retain backups for your rollback window, then remove selected completed run folders through your normal RMM retention process. There is no automatic pruning.

Console lines are easy to parse:

- `TABMARKER_TARGET {json}`: target path, old/new **file** versions, profiles/IDs, status, receipt and error.
- `TABMARKER_WARNING ...`: discovery, validation or transport issues; review even when the exit code is 0.
- `TABMARKER_REPORT=...`: full JSON report path.
- `TABMARKER_EXIT_CODE=...`: 0 = all validated targets succeeded/already current/planned; 1 = failure, including an update that rolled back; 2 = no validated installation found.

`reloadRequired` describes pending activation conservatively. `activeVersionVerified` is always false: a file updater cannot claim what code a running Chrome instance has loaded. An already-current result may still require reload if a prior deployment has not been activated. Files are processed per target; if one target fails, other validated targets continue and the overall exit is nonzero.

## Future releases

Increment `package.json`, the root package entry in `package-lock.json`, `public/manifest.json`, and `public/update-status.json` to the same new version. Then:

```powershell
npm run build
.\scripts\New-TabMarkerRelease.ps1 -OutputDirectory 'C:\your-project\work\release-staging'
```

The packager creates the built ZIP, pinned deployment wrapper, updater, README, `release.json`, and `SHA256SUMS.txt`. It refuses to replace an existing release ZIP. Publish that ZIP as a GitHub Release asset or approved HTTPS download; a git push alone does not deploy it. Keep the pinned version/checksum together in the RMM component.

## Validation of this implementation

The extension unit suite and build/typecheck pass. The RMM integration harness runs the real updater in Windows PowerShell 5.1 against isolated profile/extension fixtures, covering shared paths, multiple profiles, checksum/version failures, ZIP traversal/duplicates, locked-file rollback, modified installations, identity protection, and unchanged profile bytes. UI checks use the actual built React interface in installed Chrome with mocked extension APIs. The separate test Chromium executable failed to start (`spawn UNKNOWN` after four attempts), so activation in a real loaded extension and an actual RMM LocalSystem pilot remain to be verified. HTTPS package delivery must also be piloted against the chosen hosting endpoint.

Chrome references: [reload requirements](https://developer.chrome.com/docs/extensions/get-started/tutorial/hello-world#reload), [runtime.reload](https://developer.chrome.com/docs/extensions/reference/api/runtime#method-reload). Discovery follows Chromium's [extension preference records](https://github.com/chromium/chromium/blob/main/extensions/browser/extension_prefs.cc) and [manifest locations](https://github.com/chromium/chromium/blob/main/extensions/common/mojom/manifest.mojom).
