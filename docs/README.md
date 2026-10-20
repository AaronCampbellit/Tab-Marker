# TabMarker documentation

Consolidated October 20, 2026 from the project discussion, source and published release evidence. This is a maintained summary of requirements, decisions and findings; proposed ideas are identified separately from shipped behavior.

## For users

- [Install in Chrome](INSTALL-CHROME.md): download the built ZIP, extract into Documents, enable Developer mode and select the correct folder.
- [Quick start](QUICK-START.md): titles, icons, matching options, backups and updates.
- [Plain-text installation checklist](chrome-install.txt).

## For IT and developers

- [Windows helper setup and updates](HELPER-UPDATES.md): initial setup, current-user registration, permissions, logs and removal.
- [RMM deployment](RMM-DEPLOYMENT.md): pinned releases, discovery, checksum validation, rollback, cleanup and structured results.
- [Signing and distribution](SIGNING-AND-DISTRIBUTION.md): the reported download-policy failure, certificate options and the required packaging redesign.
- [Design decisions and brainstorming](DESIGN-DECISIONS.md): product requirements, chosen architecture, alternatives and open work.
- [Release history and verification](RELEASE-HISTORY.md): changes through 0.5.0, known failures and the endpoint acceptance checklist.
- [Earlier validation](validation.md), [Chrome API review](chrome-api-review.md) and [Autotask testing](autotask-testing.md).
- [Project implementation rules](../AGENTS.md).

## Current state

Release [0.5.0](https://github.com/AaronCampbellit/Tab-Marker/releases/tag/v0.5.0) was published to give 0.4.9 users a real newer version to test. It changes the version only. The release contains the compiled extension ZIP, pinned manual/RMM launcher, helper installer and validation record. Source pushes do not install updates on devices.

The helper setup download contains a `.cmd` launcher and a personalized `.ps1` script. It is **not signed**. A reported Windows download/extraction run failed before the PowerShell script could start because the script lacked a signature. Signing or an organization-approved handling process remains necessary on affected devices. No signing certificate/service has been provisioned, and the proposed signing redesign has not been implemented.

Isolated tests verify package deployment and previous-helper compatibility; they do not establish successful downloaded setup or browser-native integration on every endpoint. See [release evidence and remaining checks](RELEASE-HISTORY.md#validation-and-known-gaps).
