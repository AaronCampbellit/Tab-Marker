# TabMarker project rules

## Version every extension change

- Every change to extension behavior, interface, bundled assets, dependencies, or build/release logic must increment the extension version before building and publishing. Documentation-only edits may retain the version.
- `package.json` is the version source of truth. Use `npm version patch --no-git-tag-version` for a normal fix; use minor/major when warranted. The npm version hook synchronizes the Chrome manifest, deployment marker, and lockfile. Do not hard-code the displayed version in UI components.
- Run `npm run build` and appropriate checks. Build synchronizes version metadata; packaging verifies it and rejects stale built version metadata. With a matching local release tag, changed or untracked extension/build files cause the version check to fail until the version is bumped. Fetch release tags when starting from an existing checkout.
- Both the popup and Manage rules page must keep a visible footer showing the version Chrome currently has loaded, obtained from `chrome.runtime.getManifest().version`. Pending deployment versions belong in the separate reload banner.
- Package each release with `scripts/New-TabMarkerRelease.ps1`. Publish the compiled ZIP and standalone pinned RMM launcher under the matching `v<version>` GitHub Release. Verify remote branch/tag SHA, release version, asset checksum and the launcher's download before declaring publication complete.
- Keep already-published release assets immutable. New runtime/build changes get a new version, tag, release ZIP, checksum and launcher.

## Windows helper boundaries

- Bundle setup through `scripts/build-helper.mjs`. Initial setup is an explicit user-run installer; never auto-execute a download or weaken execution policy/endpoint controls.
- Settings must download a binary ZIP containing the exact `.cmd` launcher and personalized `.ps1` companion filenames. Verify real extraction/launcher behavior and avoid text MIME handling that can rename scripts to `.txt`.
- Keep native actions limited to status, check and update. Accept no caller-selected commands, URLs, repositories or target paths. Verify caller ID against registration and keep helper updates scoped with `OnlyExtensionId`.
- Keep helper registration per-user and preserve Chrome profile files/settings. Do not add an elevation mechanism or background service without explicit scope approval.
- Verify GitHub release metadata/asset digests and package hash/version before applying files. Keep automatic rollback and log-only run cleanup, retaining recovery backups when rollback fails.

## Workspace hygiene

- Keep disposable files under `work/`; keep release deliverables in the requested output location.
- Stop temporary development/QA servers when finished.
