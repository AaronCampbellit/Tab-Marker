# Release history and verification

Consolidated October 20, 2026 from Git history, released artifacts and the development discussion. This is a historical record, not a claim that every listed test was rerun for this documentation change.

## Releases from the discussion

| Version | Main change | Source commit |
| --- | --- | --- |
| 0.4.0 | Compact red/grey interface, actionable diagnostics, file backups and recovery. The correct 0.4 build replaced an initially mistaken older build supplied during guide preparation. | `88b6afe` |
| 0.4.1 | Current-URL pattern prefill, explicit refresh from the target tab and preservation of existing edits. | `16a79f2` |
| 0.4.2 | Contextual explanations/examples for rule matching options. | `105f745` |
| 0.4.3 | Exact URL default for new customizations. | `666dd92` |
| 0.4.4 | File updater and completed-deployment reload prompt; standalone launcher pinned to a built GitHub release. | `ef4d25e`, `fa11818` |
| 0.4.5 | Visible running-version footer and synchronized build/release version checks. | `5ae3316` |
| 0.4.6 | Logging before discovery, service-profile handling and ordinary Cloud Files folder recognition. | `bcff80a` |
| 0.4.7 | Cleanup of temporary deployment files, retaining the log and only necessary failed-rollback recovery data. | `ff02f46` |
| 0.4.8 | GitHub update settings and bundled per-user native helper setup. | `5c0054d` |
| 0.4.9 | Binary setup ZIP with `.cmd` launcher and personalized `.ps1`; simpler setup instructions and connection recheck on return. | `e8cf3fc` |
| 0.5.0 | Version-only release to test updating from 0.4.9; no new behavior or permissions. | `078fd6b` |

Published [0.5.0 release](https://github.com/AaronCampbellit/Tab-Marker/releases/tag/v0.5.0):

- Source SHA: `078fd6b6a149ef83504f6ebe1dc860047ba5d56d`.
- Built ZIP: `TabMarker-Chrome-0.5.0.zip`.
- SHA-256: `b02eded34e82ede90d4968919fca33d17fe795aab998e74162da7ffe580becd8`.
- Pinned standalone launcher: `Deploy-TabMarker-0.5.0.ps1`.
- [Published validation record](https://github.com/AaronCampbellit/Tab-Marker/releases/download/v0.5.0/VALIDATION.json).

Documentation commits after that source SHA do not alter the immutable release package. Older `Deploy-TabMarker-<version>.ps1` downloads remain pinned to their own version; they do not automatically follow `main` or the latest release.

## Reported problems and resulting decisions

| Report or question | Finding and outcome |
| --- | --- |
| Chrome: manifest missing/unreadable | A GitHub source tree/parent folder is not the compiled extension. Select the built folder containing `manifest.json`. Added [simple installation instructions](INSTALL-CHROME.md). |
| Supplied package was not 0.4 | Correct source branch/build was required. Verify built manifest/version rather than relying on folder names. |
| Can a browser write automatic backups? | Yes to the chosen file while permission is granted; no arbitrary device-folder access or two-way sync. |
| Current URL absent in pattern editor | Added explicit target-tab handling, prefill and **Use current URL**, preserving saved patterns and drafts. |
| Differences between URL options unclear | Added helper text/examples; selected Exact URL as the default. |
| How can unpacked users update? | Added RMM updater, reload notice, then fixed-repository GitHub/native-helper flow for mixed/unmanaged computers. |
| Manual script produced no log | Old discovery could fail before logger initialization. Version 0.4.6 initializes logs first and handles protected/service profiles. |
| Update leftovers should be removed | Version 0.4.7 keeps `install.log`; failed rollback retains only needed recovery data. No retained manual rollback after a normal successful run. |
| Setup too long; `.ps1` saved as `.txt` | Version 0.4.9 packages the exact `.cmd`/`.ps1` names in a binary ZIP. |
| Need a newer release for an actual test | Published 0.5.0 as a version-only target for 0.4.9. |
| Downloaded helper is not digitally signed | Unresolved. Policy prevented PowerShell from starting. The batch file does not resolve signing. See [signing plan](SIGNING-AND-DISTRIBUTION.md). |

## Validation and known gaps

### 0.4.9

- Build/typecheck and 248 unit tests passed.
- 15 built-UI/browser-download checks, with extension/native APIs mocked; the browser actually downloaded the ZIP.
- 10 checks on the browser-downloaded setup archive, extraction and batch-launcher behavior in isolated fixtures.
- 17 offline standalone-launcher and 17 published-download launcher checks.
- 27 previous-helper/native/setup checks using the released 0.4.8 helper against the published 0.4.9 package.
- Exact package/build bytes, payload hashes, ZIP CRCs and 12 published asset digests verified.

The unchanged updater's 65-check 0.4.8 suite was a baseline, not a fresh 0.4.9 rerun. UI mocks do not establish real `chrome.downloads` or native-message transport in a loaded extension.

### 0.5.0

- Build/typecheck and 248 unit tests passed.
- 17 offline and 17 published-download launcher checks, including a real extracted 0.4.9-to-0.5.0 fixture update, idempotence, unchanged Chrome preference bytes and log-only cleanup.
- 27 native/helper checks using the released 0.4.9 helper to install the exact public 0.5.0 package in an isolated bound installation.
- All 12 release asset digests, packaged build bytes and embedded payload hashes verified. Remote branches and annotated tag were checked against the source SHA.

These are release-time observations. They did not update the user's live extension or establish successful helper setup on that user's computer.

### Endpoint acceptance still required

1. **Downloaded setup and signing:** actual Chrome download, Windows extraction, policy/publisher trust and initial execution. A real user subsequently reported a signature block, so this path is not accepted as working under that policy.
2. **Browser/native integration:** connect from a real loaded extension, authorize the actual extension ID and complete the requested update/reload. The compiled native-host protocol was tested directly, not through the complete end-user Chrome connection.
3. **Cloud Files:** perform actual updates in a live OneDrive/Cloud Files installation with the intended identity/provider. Read-only tag detection and fixtures do not prove live write behavior.
4. **RMM LocalSystem:** pilot discovery, network access, profile permissions, download, reporting and cleanup from the actual RMM runner. Isolated Windows PowerShell tests do not prove LocalSystem rollout.
5. **Loaded version and rules:** distinguish disk version from Chrome's loaded manifest. Confirm the footer only after reload; confirm saved rules remain and temporary labels reset as documented.

## Manual bootstrap and test sequence

To obtain the 0.4.9 UI before testing the 0.5.0 update, download [Deploy-TabMarker-0.4.9.ps1](https://github.com/AaronCampbellit/Tab-Marker/releases/download/v0.4.9/Deploy-TabMarker-0.4.9.ps1). From a normal PowerShell window, run through the approved execution process:

```powershell
powershell.exe -NoProfile -File "$env:USERPROFILE\Downloads\Deploy-TabMarker-0.4.9.ps1" -DryRun
powershell.exe -NoProfile -File "$env:USERPROFILE\Downloads\Deploy-TabMarker-0.4.9.ps1"
```

Check the console/log, reload TabMarker, and confirm the footer reads 0.4.9. Set up/connect the helper through its approved installation process; if a signature or endpoint block appears, resolve it through [the signing/approval plan](SIGNING-AND-DISTRIBUTION.md). With the helper connected, choose **Manage rules → Updates → Check for updates → Install 0.5.0**, then **Update installed — Reload TabMarker**. Confirm 0.5.0 and the saved rules afterward.

For a direct manual 0.5.0 deployment, use [Deploy-TabMarker-0.5.0.ps1](https://github.com/AaronCampbellit/Tab-Marker/releases/download/v0.5.0/Deploy-TabMarker-0.5.0.ps1) instead. That skips the 0.4.9-to-0.5.0 UI test. Do not run the older launcher to downgrade an installation already on a newer version; the updater refuses downgrades.

No command here changes execution policy or grants an endpoint exception. A normal user may receive warnings for inaccessible profiles or administrator-owned folders. See [RMM deployment](RMM-DEPLOYMENT.md) for scoped parameters, result fields and log locations.
