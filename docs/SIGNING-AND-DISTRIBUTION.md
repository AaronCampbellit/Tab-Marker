# Helper signing and distribution options

Status recorded October 20, 2026. This is an investigation and design plan; no signing/trust changes have been implemented.

## Reported failure

After downloading and extracting `TabMarker-Helper-Setup.zip`, the user ran `Install TabMarker Helper.cmd`. Windows PowerShell refused to load `Install-TabMarkerHelper.ps1` because it was **not digitally signed**, reporting `PSSecurityException` / `UnauthorizedAccess`.

The batch file started and displayed the error, but the PowerShell installer did not execute. It therefore could not create its setup log. This is a distinct failure from the earlier updater discovery/logging problem fixed in 0.4.6.

During the October 16 investigation, Windows PowerShell 5.1 reported `RemoteSigned` for CurrentUser and LocalMachine, with MachinePolicy/UserPolicy undefined. That is a historical observation, not a guarantee about the device's present policy or another computer. The download-origin marker is a likely explanation consistent with the error and policy; the screenshot alone does not prove how the marker was attached or propagated.

The `.cmd`/ZIP change in 0.4.9 fixes extension filenames and removes the need to paste a command. It does not sign the script. The version-only 0.5.0 release retains this limitation.

## Policies and separate approval layers

Under **RemoteSigned**, internet-downloaded scripts need a trusted signature unless handled through an approved file-specific process. **AllSigned** also requires signatures for local scripts. Group Policy takes precedence over local/session settings. Signing, trusted-publisher classification and endpoint allowlisting are separate concerns. [Microsoft execution policies](https://learn.microsoft.com/en-us/powershell/module/microsoft.powershell.core/about/about_execution_policies?view=powershell-5.1).

Public signing is therefore not the only possible route, and an IT-approved file-specific process can be appropriate for a pilot. Approval must address the actual failing layer: an EDR exception alone does not supply a PowerShell signature or change its policy. RMM deployment must also use the organization's approved execution process; it does not inherently resolve every policy restriction.

This project does not add policy-bypass switches, remove download-origin markers automatically, auto-elevate, disable endpoint controls or choose another interpreter/download mechanism to avoid a block. For a blocked installation, preserve the console error and have IT approve the exact reviewed artifact through its normal process. Existing endpoint retry rules do not require repeatedly launching a known unsigned download merely to reproduce the same policy failure.

## Options discussed

| Option | Appropriate audience | Requirements and limitations |
| --- | --- | --- |
| Public Authenticode code signing | Mixed/unmanaged Windows computers. | A public signing service or commercial code-signing certificate, verified publisher identity, protected signing credentials and automated release integration. Publisher prompts/endpoint approval can still apply. |
| Company/internal certificate | Managed customer or company devices. | Deploy the necessary chain and publisher trust through approved management. Keep the private signing key in the controlled signing environment. Unmanaged devices do not automatically trust it. |
| Self-signed certificate | Small controlled test pilot. | Explicit IT-managed trust on each test device. Not a frictionless public-distribution solution. |
| Approved individual artifact / RMM deployment | Immediate managed testing. | Review the exact script/package and obtain approval for the relevant policy and endpoint-control layers. This does not sign future releases or guarantee unattended setup elsewhere. |
| Signed native installer and updater | Longer-term single-download experience. | New packaging/runtime work. Merely wrapping the current unsigned `.ps1` in an `.exe` does not resolve the child PowerShell script's policy requirement. |

For mixed/unmanaged users, public signing was the recommendation. [Microsoft Artifact Signing](https://learn.microsoft.com/en-us/azure/artifact-signing/overview) is one candidate service to evaluate; a conventional code-signing provider is another. No provider, price or account has been selected. Internal trust is the practical alternative for a fully managed audience. See [PowerShell signing guidance](https://learn.microsoft.com/en-us/powershell/module/microsoft.powershell.core/about/about_signing) for certificate and timestamping considerations.

## Why the current personalization must change

[`personalizeInstaller`](../src/shared/github-updates.ts) replaces `__TABMARKER_EXTENSION_ID__` inside the downloaded script. [`helperSetupArchive`](../src/shared/helper-setup.ts) then encodes that modified text into the ZIP. Editing signed script content invalidates its signature; re-encoding signed text can also change the bytes being verified.

The proposed design is:

1. Build one generic installer whose bytes remain identical for every user.
2. Supply the extension ID separately, as a validated argument or small configuration file. Configuration must remain data, not executable commands. Validate the ID, actual Chrome profile binding and native-host allowlist exactly as today.
3. Copy signed installer bytes into the download unchanged; do not use string replacement or newline normalization on the signed payload.
4. Retain explicit initial user execution. The extension must never receive a signing key or sign artifacts itself.

This may change the ZIP's file count/launcher contract. Update `AGENTS.md`, setup UI, documentation and tests alongside that implementation. The current release still contains exactly two files and personalizes the PowerShell script.

## Signing order for a future release pipeline

The order matters because signatures change file bytes and therefore hashes:

1. Compile the native host; sign and verify its final executable.
2. Finalize, sign and verify the updater, bridge, common support script and uninstaller according to the target policy. Protect unattended runtime against publisher prompts by deploying the required publisher trust through the approved process where necessary.
3. Embed these final signed bytes and their hashes into the generic setup script; sign and verify setup last.
4. Preserve setup bytes in the extension bundle. Build/package the final extension, then calculate the extension ZIP hash, pinned launcher's package defaults and release metadata.
5. Sign/verify the standalone pinned deployment launcher if it is part of the signed distribution; calculate published asset digests from the final uploaded bytes.
6. Timestamp as supported, keep signing credentials outside Git/extension downloads and fail the signing-required release job when signature verification fails.

The current build generates hashes from unsigned payloads and emits unsigned scripts. A future signing job must integrate this order, not append signatures after release hashes have already been published. Already-published 0.4.9/0.5.0 assets must remain immutable; signing-related runtime/build changes require a new version and release.

## Required validation

- Download setup through the actual extension UI in Windows Chrome, then extract with the normal Windows workflow.
- Verify signatures and file bytes after download/extraction. Confirm no personalization or text transport altered them.
- Test RemoteSigned and, where targeted, AllSigned plus the actual publisher trust configuration. Include offline/revocation/timestamp behavior relevant to the selected signing service.
- Test first install, repair, helper upgrade, unattended bridge/updater execution and uninstall through the normal approved endpoint controls.
- Test browser-to-native messaging, extension update and reload with a preserved rule set.
- Make clear whether setup reached its logging code. A pre-execution block has no setup-generated log.

The user-reported downloaded setup failure supersedes any impression that isolated setup tests proved the entire end-user path. The remaining pilots are listed in [release history](RELEASE-HISTORY.md#validation-and-known-gaps).
