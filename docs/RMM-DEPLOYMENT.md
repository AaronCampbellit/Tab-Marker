# TabMarker updates through RMM

This package updates **existing unpacked installations** on Windows using Windows PowerShell 5.1 or later. It does not install the extension into new Chrome profiles, enable Developer mode, or change browser policy. Run through your RMM's normal approved PowerShell execution process. Start with one pilot device.

## Quick deployment

Version 0.4.8 also bundles a per-user Windows native-helper installer and adds **Manage rules → Updates** for GitHub checks and user-requested updates. The initial helper setup must be downloaded and run by the Chrome user; it cannot be launched by the extension. See [helper setup](HELPER-UPDATES.md). Existing RMM deployment remains available for the initial upgrade and administrator-owned/all-user installations. The helper uses `-OnlyExtensionId` to restrict this updater to the calling installation; that parameter cannot be combined with explicit `-ExtensionPath` overrides.

Use **`Deploy-TabMarker-<version>.ps1`** as your RMM PowerShell component. It is standalone: paste its contents into the component or launch the downloaded file. No helper script or ZIP attachment is needed for online deployment.

It downloads the built extension from `https://github.com/AaronCampbellit/Tab-Marker/releases/download/v<version>/TabMarker-Chrome-<version>.zip`. The expected release version and SHA-256 are pinned in the launcher. It does not follow `main`, the latest release, or GitHub's source-code ZIPs. Use a newly generated launcher for each future release.

Run as **LocalSystem** to reach all local Windows user profiles. First run the script with `-DryRun`; review the target paths and warnings. Then run it without `-DryRun` to deploy:

```powershell
powershell.exe -NoLogo -NoProfile -File .\Deploy-TabMarker-<version>.ps1 -DryRun
powershell.exe -NoLogo -NoProfile -File .\Deploy-TabMarker-<version>.ps1
```

For offline/RMM-attachment deployment, pass `-PackagePath 'C:\your-attachment-folder\TabMarker-Chrome-<version>.zip'`. This explicitly replaces the default download with that local ZIP. A `-PackageUrl` override can use a mirror serving the exact same bytes; the version and checksum remain pinned. The generic `Update-TabMarker.ps1` is also supplied for custom integrations and requires explicit version, checksum, and package source. Private GitHub credentials are not bundled.

## What users see

Once the files are fully verified, TabMarker's popup and Manage rules page show **Update installed — Reload TabMarker** when their loaded version differs from the deployed version. Clicking it uses `chrome.runtime.reload()`. Unsaved editor changes require confirmation. Saved rules and backup-file connection data remain in Chrome's profile. Temporary tab-only labels reset. Users should refresh open websites afterward.

The prompt checks on opening, on focus, and every 15 seconds while its page is visible. A deployment-in-progress marker suppresses reload until installation finishes. It only checks local deployment files; it does not check GitHub or download updates.

The first rollout to a pre-0.4.4 version adds this feature. Reopen the popup to load the new interface; an already-open older settings page will not acquire the feature automatically. If the new interface cannot load, reload TabMarker at `chrome://extensions` or fully exit and reopen Chrome. The script never closes Chrome.

## Discovery and protection of user data

- Creates logging before profile discovery. Reads Windows ProfileList to locate standard Chrome Stable, Beta, Dev, and Canary user-data roots for local users. Skips Windows service accounts; logs inaccessible user profiles individually and continues with accessible ones. Reads `Secure Preferences` and `Preferences` in immediate profile directories, including custom-named profiles.
- Uses unpacked records (`location: 4`) and their absolute folder paths. Unpacked records commonly have no cached manifest, so it reads the manifest from disk and verifies TabMarker's name, MV3 format, entry points, resources, and HTML asset links. Packed/store installations are excluded.
- Deduplicates a folder shared by several Chrome profiles. Updates that folder once and reports all discovered profiles/extension IDs.
- Custom `--user-data-dir` locations require `-ChromeUserDataRoot`. A known built folder can be supplied with `-ExtensionPath`; this explicit option does not prove it is loaded in a browser. These array parameters work naturally through the PowerShell call operator; for command-line launch, use one root per job or a small PowerShell wrapper for arrays.
- Leaves Chrome preferences, extension storage, IndexedDB and saved rules untouched. Keeps the existing extension folder path and rejects changes to a manifest signing key. Does not uninstall/reinstall or move the extension.
- Rejects source checkouts, broad folders, folders inside known Chrome data roots, redirecting junctions/symbolic links, unknown reparse tags, and packages or extension trees exceeding 100 MiB / 2,500 files. Microsoft's Cloud Files reparse-tag family is permitted after a read-only `fsutil reparsepoint query`; this supports normal OneDrive folders while retaining redirect protection. Files must be accessible to the executing account and sync provider. Cloud writes still need an endpoint pilot; no hydration, account impersonation, or reparse modification is forced. Missing/inaccessible records are reported; discovery does not scan the entire disk. Relocated Windows LocalAppData/custom data locations need an explicit root. See [Microsoft's tag definitions](https://learn.microsoft.com/en-us/openspecs/windows_protocols/ms-fscc/c8e77b37-3909-4fe6-a4ea-2b9d423b1ee4).

## Validation, backup, and rollback

Downloads a specific HTTPS ZIP (HTTPS-only redirects, bounded size), verifies the caller-supplied SHA-256 before extraction, rejects unsafe/duplicate ZIP paths, and validates the expected version and build resources. A GitHub **source-code ZIP is not a built extension**.

Before each update, captures a complete file backup and SHA-256 inventory. Uses a per-extension exclusive deployment lock and atomic file replacements, retrying the same write up to three additional times for transient locks. Identical files are skipped. Writes the manifest after other package files and marks the deployment ready only after verification. Old hashed assets and unrelated files are retained so already-open extension pages can still load their old resources. The lock file remains as a harmless coordination file.

An update failure triggers automatic rollback. If a persistent file lock or endpoint control prevents rollback, the report states `RollbackFailed`, the deployment stays unready, and the verified backup/receipt remain available. Resolve the reported block through your normal security process before retrying. No controls are disabled or bypassed.

Replacement is atomic per file, not across the entire directory. Retaining old hashed assets and installing new assets before entry points reduces disruption, but opening Chrome or starting an extension context during deployment can still overlap file changes. Keep deployments brief, pilot the running-browser case, and use a maintenance window when necessary.

Backups exist only while deployment and any automatic rollback are running. After success, a dry run, validation failure, or successful automatic rollback, cleanup removes the downloaded ZIP, staging files, backups and receipts. **Only `install.log` remains in the new run folder.** There is no later manual rollback receipt after a normal completed run. The downloaded launcher and any caller-supplied offline ZIP are inputs and are not deleted. Earlier run folders are not pruned; other or still-running jobs are not touched.

If automatic rollback fails, its affected backup and `receipt.json` remain because they are still needed for recovery; other disposable content is removed. The log identifies the retained path. For one of these retained receipts (or a receipt from an older release), inspect rollback without changing extension files:

```powershell
.\Update-TabMarker.ps1 -RollbackReceipt 'C:\ProgramData\TabMarkerRMM\runs\<run>\backups\<target>\receipt.json' -DryRun
```

Remove `-DryRun` to restore. Backup hashes are checked before writing. The receipt must match the installed old/new version; it cannot overwrite a later unrelated version. Rollback removes newly added package files, restores the original files, and publishes a fresh local marker for the restored version. It leaves harmless empty directories and the coordination lock. Existing original deployment metadata is replaced by that fresh marker. A reload is required afterward. An externally supplied recovery backup is not deleted by a later invocation; remove it after verifying recovery. Ordinary update mode refuses downgrades or different files with the same version number.

## RMM results

Default run directory: `C:\ProgramData\TabMarkerRMM\runs\<timestamp-id>`. Each run folder is restricted to SYSTEM, administrators, and the invoking identity. **`install.log` is created at startup, before profile discovery or downloading.** It records timestamps, account/process context, phases, warnings, target results, errors, cleanup outcome and a final JSON report. `-WorkRoot` selects another location outside Chrome profiles; `-DryRun` never changes extension files and cleans its own temporary content too. No separate `report.json` is written. Final structured results use schema version 2 and are embedded in the log and emitted directly to the RMM console.

If the requested work directory cannot be initialized, the script attempts a protected **diagnostic-only** log under `%LOCALAPPDATA%\TabMarkerRMM\diagnostics\runs\<timestamp-id>`. It then exits with failure; no download or deployment follows that fallback. Both locations must still be writable. Logs cannot be created if PowerShell never executes the script (for example a syntax, parameter binding, execution-policy or endpoint-control block before startup); inspect the invoking console/RMM job error in that case. No security settings are changed.

Cleanup runs after deployment and automatic recovery, including on ordinary failures. It only removes content from the current invocation's uniquely created run directory, checks path boundaries and refuses redirecting junctions/symbolic links. It retries a blocked deletion up to three additional times; unresolved cleanup errors are logged and return exit code 1. A forced process termination or power loss can interrupt cleanup, leaving that run's contents. Logs are retained without an age limit. For a manual run, open PowerShell and launch the downloaded script with `-DryRun` so its startup log path and any error remain visible. For all users, use your approved elevated/LocalSystem context; a normal user may see warnings for other users' profiles.

Console lines are easy to parse:

- `TABMARKER_START ...`: emitted as execution begins.
- `TABMARKER_LOG=...`: the persistent text log path, emitted as soon as it exists.
- `TABMARKER_PROGRESS ...`: live timestamped phase/progress messages, including warnings/errors; these are also appended to `install.log`.
- `TABMARKER_TARGET {json}`: target path, old/new **file** versions, profiles/IDs, status, receipt and error.
- `TABMARKER_WARNING ...`: discovery, validation or transport issues; review even when the exit code is 0.
- `TABMARKER_REPORT_JSON={json}`: full final report in the console and `install.log`, including `cleanup: Completed`, `RecoveryRetained`, `Failed` or `Unavailable`. `receipt` is null once its temporary backup is deleted.
- `TABMARKER_LOG_UNAVAILABLE=...`: no reliable writable log location; the console still supplies final JSON results.
- `TABMARKER_EXIT_CODE=...`: 0 = all validated targets succeeded/already current/planned; 1 = failure, including an update that rolled back; 2 = no validated installation found.

`reloadRequired` describes pending activation conservatively. `activeVersionVerified` is always false: a file updater cannot claim what code a running Chrome instance has loaded. An already-current result may still require reload if a prior deployment has not been activated. Files are processed per target; if one target fails, other validated targets continue and the overall exit is nonzero.

## Future releases

Run `npm version patch --no-git-tag-version` (or minor/major when appropriate). Its hook synchronizes all version metadata from `package.json`. Then:

```powershell
npm run build
.\scripts\New-TabMarkerRelease.ps1 -OutputDirectory 'C:\your-project\work\release-staging'
```

The packager creates the built ZIP, standalone pinned deployment launcher, generic updater, README, `release.json`, and `SHA256SUMS.txt`. It refuses to replace an existing release ZIP. Its default repository is `AaronCampbellit/Tab-Marker`; `-Repository owner/repo` supports an authorized fork. Publish the ZIP and launcher as assets of the matching `v<version>` GitHub Release. A git push alone does not deploy it. Replace the RMM component with the new version's pinned launcher when you approve that release for deployment.

## Validation of this implementation

The extension unit suite and build/typecheck pass. The RMM integration harness runs the real updater in Windows PowerShell 5.1 against isolated profile/extension fixtures, covering shared paths, multiple profiles, checksum/version failures, ZIP traversal/duplicates, locked-file rollback, modified installations, identity protection, and unchanged profile bytes. UI checks use the actual built React interface in installed Chrome with mocked extension APIs. The separate test Chromium executable failed to start (`spawn UNKNOWN` after four attempts), so activation in a real loaded extension and an actual RMM LocalSystem pilot remain to be verified. See the release's VALIDATION.json for the published GitHub download/deployment checks; verify GitHub reachability from your own RMM network as part of the pilot.

Chrome references: [reload requirements](https://developer.chrome.com/docs/extensions/get-started/tutorial/hello-world#reload), [runtime.reload](https://developer.chrome.com/docs/extensions/reference/api/runtime#method-reload). Discovery follows Chromium's [extension preference records](https://github.com/chromium/chromium/blob/main/extensions/browser/extension_prefs.cc) and [manifest locations](https://github.com/chromium/chromium/blob/main/extensions/common/mojom/manifest.mojom).
