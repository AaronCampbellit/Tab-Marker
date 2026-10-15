# Updates from TabMarker Settings

TabMarker checks its public GitHub repository for completed stable releases. On Windows, a separately installed native helper can update the existing unpacked folder. The first setup is a download-and-run step: Chrome cannot launch the bundled installer itself.

## Set up once

1. Install/update to **0.4.8 or later**, then reload TabMarker. Existing users can use the pinned RMM launcher for this first update.
2. Open **Manage rules → Updates**. Click **Install helper** and save `Install-TabMarkerHelper.ps1` in Downloads. The extension personalizes the bundled installer with its current extension ID.
3. Open PowerShell as the **same Windows user who runs Chrome** and run:

   ```powershell
   powershell.exe -NoProfile -File "$env:USERPROFILE\Downloads\Install-TabMarkerHelper.ps1"
   ```

   Use the actual path if the file was renamed or saved elsewhere. No administrator access or execution-policy change is requested. If endpoint controls or PowerShell policy block setup, use your organization's normal approval process.
4. Return to Settings and click **Check connection**. It should say **Helper connected**.

Setup validates its embedded payload and finds that extension ID in the current user's Chrome profile records. Chrome Stable, Beta, Dev and Canary are supported. For a custom `--user-data-dir`, add `-ChromeUserDataRoot 'C:\actual\User Data'` to the setup command. Only matching built, unpacked TabMarker installations are registered; source checkouts and packed extensions are excluded. No full-disk scan is performed.

The helper lives at `%LOCALAPPDATA%\TabMarker\Helper`. It registers its native-host manifest under the current user's `Software\Google\Chrome\NativeMessagingHosts\com.rarity.tabmarker` key in applicable registry views. It creates no service, scheduled task, elevation mechanism or system-wide registration. Another unpacked installation can run its own Settings-generated setup to add its validated ID without removing earlier registrations. Rerun setup to repair or upgrade the helper; an older installer refuses to downgrade a newer helper.

An RMM setup must run in the intended user's context. The generic release installer requires `-ExtensionId '<32 lowercase a-p characters>'`; Settings fills this automatically. LocalSystem should use the existing RMM extension deployment script instead of installing a per-user helper as a service account.

## Install future updates

Settings checks GitHub on opening and caches validated metadata for one hour. **Check for updates** explicitly refreshes it. A completed stable release must have the versioned compiled ZIP, uploaded asset SHA-256 digests and `release.json`. A source commit/ZIP, draft, prerelease or incomplete release is not offered. Offline and rate-limit failures are reported.

When a higher version is available and the helper is connected, save/cancel rule edits, click **Install v…**, and keep Settings open. The helper rechecks the expected version, fixed repository/download path, metadata digest and compiled-package digest against GitHub's API. It verifies its installed updater hash and runs the **locally bundled updater**; it does not download and execute a new remote PowerShell script. The updater independently verifies the ZIP, version and resources.

The helper accepts only `status`, `check` and `update`. Update requests contain only the expected version. Callers cannot supply commands, package URLs, target paths or a repository. Chrome's native-host allowlist and the helper configuration require the actual calling extension ID. Updates target only that ID's unpacked records in its registered Chrome roots. The helper has the Chrome user's existing file permissions; administrator-owned installations need the RMM route.

Afterward, click **Update installed — Reload TabMarker** and refresh website tabs. Saved rules, Chrome preferences, IndexedDB and backup-file connections remain. Temporary tab-only labels reset. The helper does not close Chrome or claim to verify the browser's currently active code version.

The fixed repository/account and HTTPS GitHub API are the release trust source. Checksums detect altered/mismatched bytes; they are not independent publisher signatures and do not protect against compromise of the trusted repository account. No GitHub token is bundled. Release checks send no saved rules, website URLs or page contents to GitHub.

## Logs and removal

Setup prints its retained log path under `%LOCALAPPDATA%\TabMarker\Helper\logs`, before profile discovery/payload validation. If PowerShell never executes the script, inspect the invoking console error.

Update logs are under `%LOCALAPPDATA%\TabMarker\Helper\runs\runs\<run-id>\install.log` (the outer `runs` is this helper's WorkRoot). Completed runs remove their download, staging and completed rollback backup; full JSON results remain in the log. Only failed automatic rollback retains its needed recovery backup. Setup staging is removed too. Caller-downloaded setup files, earlier run folders, installed browser assets and the coordination lock are outside run cleanup. See [RMM details](RMM-DEPLOYMENT.md).

To remove the helper, close its Settings page and run:

```powershell
powershell.exe -NoProfile -File "$env:LOCALAPPDATA\TabMarker\Helper\Uninstall-TabMarkerHelper.ps1"
```

This removes only its matching current-user native-host registration and known program/config files. Logs, needed recovery backups, the Chrome extension and saved rules remain.

## Build and validate

`npm run build` compiles the small native host and embeds it with the fixed updater/bridge scripts in `dist/helper/Install-TabMarkerHelper.ps1`. Build on Windows with the default .NET Framework compiler, or explicitly provision a compatible compiler through `TABMARKER_CSC`. Node/compiler are build-machine requirements. User devices need Windows PowerShell 5.1 and .NET Framework, with normal policy permission to run the helper/scripts.

The new `downloads` permission prepares setup downloads; `nativeMessaging` connects to the host. GitHub uses existing HTTPS host access. Loading the extension alone installs no native software. Setup is not a web-accessible resource.

```powershell
npm run test:unit
npm run build
node tests/helper/native.tests.mjs --network
powershell.exe -NoProfile -File tests/rmm/update.tests.ps1 -TestRoot 'C:\project\work\rmm-tests'
```

The native harness exchanges real framed messages with the executable, tests input/authorization refusals, and exercises setup/repair/uninstall using an isolated test registry key. `--deploy` additionally installs the built version from its published GitHub release into an isolated Chrome-record fixture. Chrome UI checks use the built React pages with mocked Chrome/native/download APIs. Real Chrome-to-registered-host communication, live Cloud Files writes and RMM LocalSystem execution remain endpoint pilot checks; process/UI fixtures do not prove those cases.

References: [Chrome Native Messaging](https://developer.chrome.com/docs/extensions/develop/concepts/native-messaging), [downloads](https://developer.chrome.com/docs/extensions/reference/api/downloads), [network requests](https://developer.chrome.com/docs/extensions/develop/concepts/network-requests).
