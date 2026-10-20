# Install TabMarker in Chrome

## 1. Download the extension

Open [TabMarker releases](https://github.com/AaronCampbellit/Tab-Marker/releases/latest). Under **Assets**, download **TabMarker-Chrome-<version>.zip**.

Choose that built extension ZIP. GitHub's **Source code** ZIP contains development files and must be built first; selecting its root or `src` folder causes the missing-manifest error.

## 2. Unzip into Documents

Right-click the downloaded ZIP and choose **Extract All**. Choose a permanent folder inside **Documents**, then click **Extract**.

## 3. Open Chrome's extensions page

Type `chrome://extensions` into Chrome's address bar and press Enter.

## 4. Turn on Developer mode

Turn on **Developer mode** in the top-right corner. Click **Load unpacked** near the top-left.

## 5. Select the whole extension folder

Go to the folder you extracted. Open the folder that has **manifest.json directly inside it**, then click **Select Folder**.

Select the folder, not the ZIP, `src`, an individual file or a parent folder. Some ZIPs extract into an extra folder; keep opening folders until you see `manifest.json` directly inside the one you will select.

Keep this folder in place. Chrome runs the extension from these files; do not move or delete them after installation.

## 6. Pin it and refresh your website

Click Chrome's puzzle-piece **Extensions** button and pin **TabMarker**. Refresh the website tab you want to customize, then click TabMarker. Continue with the [quick start](QUICK-START.md).

## If Chrome says the manifest is missing

Check that you downloaded the built `TabMarker-Chrome-<version>.zip`. Find `manifest.json` in the extracted files and select its containing folder. A folder containing only `background`, `content`, `core`, `shared` and `ui` source directories is not the built extension.

For developers: run the repository's Windows build and load `dist`. See [build instructions](../README.md#build-and-install).

## Updating an existing installation

Use the [connected helper](HELPER-UPDATES.md) or [manual/RMM updater](RMM-DEPLOYMENT.md). These replace files in the existing folder and preserve Chrome profile data. After deployment, reload TabMarker and refresh website tabs. Loading another copy from a different folder can create another extension ID with separate saved rules.

The helper's initial downloaded setup can be blocked by script-signing policy. See [the known signing issue](SIGNING-AND-DISTRIBUTION.md); the extension itself does not install or launch that setup automatically.
