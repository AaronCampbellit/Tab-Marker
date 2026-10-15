# TabMarker project rules

## Version every extension change

- Every change to extension behavior, interface, bundled assets, dependencies, or build/release logic must increment the extension version before building and publishing. Documentation-only edits may retain the version.
- `package.json` is the version source of truth. Use `npm version patch --no-git-tag-version` for a normal fix; use minor/major when warranted. The npm version hook synchronizes the Chrome manifest, deployment marker, and lockfile. Do not hard-code the displayed version in UI components.
- Run `npm run build` and appropriate checks. Build synchronizes version metadata; packaging verifies it and rejects stale built version metadata. With a matching local release tag, changed or untracked extension/build files cause the version check to fail until the version is bumped. Fetch release tags when starting from an existing checkout.
- Both the popup and Manage rules page must keep a visible footer showing the version Chrome currently has loaded, obtained from `chrome.runtime.getManifest().version`. Pending deployment versions belong in the separate reload banner.
- Package each release with `scripts/New-TabMarkerRelease.ps1`. Publish the compiled ZIP and standalone pinned RMM launcher under the matching `v<version>` GitHub Release. Verify remote branch/tag SHA, release version, asset checksum and the launcher's download before declaring publication complete.
- Keep already-published release assets immutable. New runtime/build changes get a new version, tag, release ZIP, checksum and launcher.

## Workspace hygiene

- Keep disposable files under `work/`; keep release deliverables in the requested output location.
- Stop temporary development/QA servers when finished.
