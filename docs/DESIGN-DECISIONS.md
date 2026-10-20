# Product decisions and brainstorming

Consolidated October 20, 2026. This records the discussion behind the shipped implementation and preserves alternatives for future work. **Shipped** means present in the source/released package, not proven working on every endpoint. **Proposed** means discussed but not implemented or selected for rollout.

## Goals established in the discussion

- Make unpacked Chrome installation and day-to-day use simple for nontechnical users.
- Keep instructions short: extract into Documents, enable Developer mode and select the whole built folder containing `manifest.json`.
- Keep user-facing PDF guides polished and Rarity-branded using the requested `raritize-it` workflow; retain editable HTML alongside future PDF revisions. The new Markdown guides describe current behavior; older 0.4.x PDF copies should not be represented as current helper instructions without revision.
- Show the running version at the bottom of the popup and settings; synchronize release versions automatically.
- Preserve saved rules during updates. Avoid reinstalling the extension into another folder/ID.
- Support mixed or unmanaged computers, with an RMM path for managed deployment.
- Leave useful logs and remove unnecessary temporary update files.

## Current URL and matching options — shipped

The reported problem was that choosing **URL pattern** did not reliably supply the current page address. The editor now starts a new pattern from the selected website tab's current URL, retains query parameters and excludes credentials/fragments. It does not invent a wildcard. **Use current URL** is an explicit replacement action; existing rules/manual drafts remain intact on scope changes.

Manage rules opened from the popup retains its target tab. Independently opened settings provides a website-tab selector. Contextual helper text explains each matching option and examples. **Exact URL** is the default for new customizations; saved rules keep their existing scope.

Choosing Exact URL as the default did not change the matcher to include every query parameter. General exact rules remain query-insensitive; reviewed Autotask screen identifiers are a deliberate exception. Explicit URL patterns can filter additional query values. See [quick start](QUICK-START.md).

## Can backups access a device folder? — clarified and shipped

The question was whether an extension could keep a backup updated despite browser restrictions on device files, and whether the limitation was Firefox-specific.

TabMarker uses a user-selected **file** through the File System Access API, with its handle stored in extension-owned IndexedDB. Successful saved-rule changes trigger a one-way write while permission remains granted; startup retries pending work. Permission can require renewal. External file modification pauses unattended overwrite. Import/restore is explicit.

This does not grant arbitrary folder access, background access to every device file or cross-device synchronization. Browser API support differs; the current product is a Chrome extension, and no Firefox backup implementation has been validated. Firefox support must be checked separately rather than inferred from Chrome behavior. [File picker compatibility](https://developer.mozilla.org/en-US/docs/Web/API/Window/showSaveFilePicker).

The Windows update helper and the browser backup feature are separate mechanisms. The helper updates the registered extension folder; it does not implement backup synchronization. See [backup implementation](../src/background/backups.ts).

## Could the extension update itself? — chosen split architecture

The desired flow was an update button that notices a GitHub release, installs it and reloads TabMarker. A browser extension cannot simply launch a downloaded PowerShell script or overwrite arbitrary installed files by itself. Chrome Native Messaging uses a separately installed host. [Chrome native messaging](https://developer.chrome.com/docs/extensions/develop/concepts/native-messaging).

The chosen implementation divides responsibilities:

| Component | Responsibility | Status |
| --- | --- | --- |
| GitHub release check | Discover a completed stable release in the fixed repository. | Shipped in 0.4.8. |
| Windows native helper | Validate the calling extension, verify the release and invoke its bundled updater for the bound installation. | Shipped in 0.4.8; endpoint integration remains a pilot check. |
| File updater | Discover/validate the loaded folder, stage and verify the ZIP, back up, replace files and recover on failure. | RMM route shipped in 0.4.4; subsequently hardened. |
| Reload button | Detect completed deployment, protect unfinished edits and call `chrome.runtime.reload()`. | Shipped in 0.4.4. |
| Initial helper setup | User downloads, extracts and runs setup once. | ZIP/batch flow shipped in 0.4.9; unsigned-download failure remains unresolved. |

GitHub checks use a one-hour cache; **Check for updates** forces a refresh. A version change in `main` alone is not an update. The helper uses the fixed repository's stable release, checks uploaded digests and metadata, and rejects a stale requested version if the release changed. It does not accept caller-selected commands, repositories, download URLs or installation paths.

The existing helper updates extension files; it does not silently replace its own installed runtime. Setup must be rerun when a helper upgrade is needed. Release metadata can require a minimum helper protocol. No service, elevation mechanism or system-wide helper registration was added.

## Could RMM find and replace the extension files? — shipped

Yes, for existing unpacked installations. The updater reads Chrome profile records where possible, checks `location: 4`, resolves the path and validates built TabMarker resources before accepting a target. Multiple profiles and shared installation folders are handled; custom user-data roots can be supplied explicitly. It does not perform an unrestricted device-wide search or modify Chrome's profile records.

The release launcher downloads one exact **built** ZIP and verifies its pinned SHA-256/version. A source ZIP is rejected. Staging/backup precede mutation; entry points follow assets, manifest follows other package files and the ready marker is last. Running pages may still overlap per-file replacement, so deployment is not directory-wide atomicity.

Chrome preferences, storage and rules are left alone. The folder and extension identity are preserved. Administrator-owned folders use the approved RMM execution context; the per-user helper does not elevate. See [RMM deployment](RMM-DEPLOYMENT.md) for parameters and safeguards.

### Logging and cleanup decisions

The user reported no log from the 0.4.4 script. Discovery could fail before logging began. Version 0.4.6 moved logging before discovery, skipped service profiles, reported inaccessible profiles and recognized normal Cloud Files folders while retaining redirect protection.

The user requested removal of everything unnecessary except the log. Version 0.4.7 removes the current run's download, staging, successful backups and receipts, retaining `install.log` with final JSON results. **Failed rollback retains its needed recovery backup/receipt.** A successful run consequently has no retained manual rollback receipt. Caller-supplied installers/packages, previous run folders, old hashed browser assets and the deployment lock are outside temporary-run cleanup. No automatic log-age pruning was requested or implemented.

## Could the helper be bundled and installed from Settings? — partially achieved

The release bundles setup and Settings prepares the download. Initial installation still needs the user to run it; the extension does not launch it. The first setup flow used a copied PowerShell command. The user then requested a batch launcher and reported `.ps1` downloading as `.txt`.

Version 0.4.9 downloads a binary ZIP with exact `.cmd` and `.ps1` entry names. The batch file runs the adjacent script, supports spaces in paths, keeps feedback visible and preserves the exit code. This solves filename/launch convenience, **not signing or security approval**. The subsequent signature failure is recorded in [signing and distribution](SIGNING-AND-DISTRIBUTION.md).

## Alternatives retained from the update discussion

| Alternative | Why consider it | Current decision / limitation |
| --- | --- | --- |
| Manual replacement and reload | Minimal infrastructure; useful for bootstrap or recovery. | Available through the pinned manual updater; approved execution is still required. |
| RMM rollout | IT can select a tested release and collect structured results across devices. | Implemented. It is not an initial extension-install mechanism or automatic helper registration as LocalSystem. |
| GitHub + per-user native helper | Gives mixed/unmanaged users an update button while retaining the existing unpacked folder. | Selected and shipped; signing and endpoint acceptance remain open. |
| Chrome Web Store distribution | Browser-managed installation/update path for a broader audience. | Discussed alternative; no store listing, migration or storage-transfer implementation exists. Store installation can use a different extension ID. |
| Enterprise-managed hosting/policies | Suitable where Chrome and devices are centrally managed. | Considered; not selected for mixed/unmanaged devices. Windows/macOS self-hosting is restricted to supported enterprise mechanisms. [Chrome distribution limits](https://developer.chrome.com/docs/extensions/how-to/distribute/host-on-linux). |
| Native installer/updater with no PowerShell | Could provide one setup executable and remove the PowerShell runtime dependency. | Proposed; current `.exe` host still launches PowerShell. It would remain subject to endpoint trust and approval. |

## Open work and acceptance criteria

1. Choose a signing/trust model. No certificate purchase, cloud signing account or trust-store deployment has been performed.
2. If signing is chosen, keep signed script bytes identical and pass the extension ID separately as validated setup data. Update the ZIP contract, implementation rules, build order and tests together; the current two-file/personalized-script contract is still in force.
3. Sign/verify the final helper executable and every executed PowerShell companion as needed for the selected policy. Compute embedded hashes and release checksums only after signing the relevant bytes.
4. Test the actual browser download, Windows extraction, launcher and policy behavior. Isolated installer success is insufficient evidence for downloaded-file execution.
5. Complete browser-to-native integration and real RMM/Cloud Files pilots. Confirm the loaded footer version and saved rules after reload.
6. Revisit Web Store distribution or a fully native updater only as a separately scoped implementation. Neither is part of the current documentation change.

The 0.5.0 release supplies a real update target for a 0.4.9 installation. It introduces no new features or permissions and does not fix signing. See [release history](RELEASE-HISTORY.md).
