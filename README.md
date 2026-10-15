# TabMarker

TabMarker is a local-first Chrome Manifest V3 extension for custom tab titles and highly visible colored SVG favicons. Use a temporary customization for one tab, or save a rule that reapplies when a matching page opens. It is designed for repeated web application tabs, including future verified Autotask PSA module detection.

There is no backend, account, external API, telemetry, or remote asset dependency. Rules live in this Chrome profile, with optional automatic backup to a file you choose on your device. Version **0.4.0** adds a compact red and grey editor, actionable diagnostics, backup export/import and recent recovery copies. Exact URL rules distinguish the reviewed Autotask landing-page views for Quote search, Generate invoices and Payment processing. Optional DOM module signatures remain empty until live validation. See [validation](docs/validation.md) for local Chrome evidence and remaining platform limits. Both production and development dependency audits are clean after the Tailwind 4 migration.

## Build and install

Requirements: Node.js **22.12+** or a supported newer LTS release, npm, and desktop Google Chrome **120+**. Local verification uses Node 24. Dependencies are pinned by `package-lock.json`. If a restricted cloud workspace has an unwritable default npm cache, select a writable one before installation, for example `export npm_config_cache=/tmp/tabmarker-npm-cache`.

```sh
npm ci
npm run build
```

1. Open `chrome://extensions` in Chrome and enable **Developer mode**.
2. Select **Load unpacked** and choose this repository's **`dist`** directory.
3. Pin TabMarker using Chrome's Extensions toolbar menu.
4. **Refresh HTTP(S) pages that were already open before installation.** Content scripts are injected when a page loads; the extension does not request programmatic scripting permission to retrofit old pages.
5. Open the toolbar popup on a normal website, choose a title and/or colored icon, select a scope, and save.

The source directory itself is not the unpacked extension. `npm run build` typechecks TypeScript, builds React pages with Vite and the Tailwind 4 Vite plugin, and bundles the worker and isolated content script into `dist`.

For iterative development:

```sh
npm run dev
```

This rebuilds the unpacked extension after source changes. Wait for a successful build, click **Reload** on TabMarker in `chrome://extensions`, refresh the website under test, and reopen the popup/settings page. This is an extension build watcher, not Vite's web-server hot reload. Changes to build configuration require restarting the watcher. An extension reload clears temporary session overrides; saved rules remain.

Disabling, removing, or reloading the extension can leave its current document title/favicon in place until the website is refreshed. Rule removal through TabMarker can restore metadata while its script is connected; Chrome unloading the script does not provide a reliable cleanup callback. Refresh affected pages after disabling/removing and after reinstalling/reloading.

## Default scope in 0.4.3

New toolbar customizations default to **Exact URL**, matching the rule editor. An existing saved rule keeps its scope, and an active temporary customization keeps **This tab only** selected.

## Rule scope help in 0.4.2

Version **0.4.2** adds contextual help for every Rule scope in the popup and settings. Each option explains its lifetime and page coverage, with examples; recognized Autotask Exact URL rules explain the screen-specific match. The help is associated with its scope selector for assistive technology.

## Current URL prefill in 0.4.1

Selecting **URL pattern** in the toolbar editor fills a new pattern with the current website URL, including its query parameters. Credentials and fragments are excluded because they are not supported in patterns. No wildcard is appended automatically. Edit the URL to add `*` where needed, then check the live match preview before saving.

Existing saved patterns and manual edits remain intact when changing scopes. **Use current URL** explicitly replaces the draft with the latest address of the editor's target tab, including after navigation. Opening **Manage rules** from the toolbar retains that tab as the source. In settings opened independently, choose a **Website tab** for a new URL pattern; existing rules are filled only when you explicitly click **Use current URL**.

This is an explicit editor-only request: the full query URL is held in the unsaved field, not added to general state responses, diagnostics, storage, recovery or backups. Saving a URL-pattern rule persists the query filters visible in that field, including values copied from the page. Remove unwanted parameters before saving. Existing query-insensitive exact rules and reviewed Autotask exact-view matching are unchanged.

## Customizing tabs

Set a title, an icon, or both. Icons use a six-digit hex color and one visible letter, number, or symbol. Titles are limited to 120 characters. An unset title or icon leaves that part of the page's metadata under page control.

| Scope | Matches | Lifetime |
| --- | --- | --- |
| This tab | The current numeric Chrome tab ID, including subsequent supported navigation | Until the tab closes, extension reloads, or the browser fully exits |
| Exact URL | Normalized scheme, hostname, port and path; recognized Autotask screens also match `view` | Saved locally across tab reopening and browser restart |
| URL pattern | HTTP(S) hostname/path wildcards and optional query-value filters | Saved locally across tab reopening and browser restart |
| Domain | Hostname and its subdomains, on HTTP or HTTPS and any port | Saved locally across tab reopening and browser restart |

Examples: `https://ww*.autotask.net/AutotaskOnyx/LandingPage?view=inventory-order*` and `https://ww*.autotask.net/*?view=*-search`. `*` matches zero or more characters in a hostname, path, or query value. Use `*://` to allow HTTP and HTTPS. The original `*.example.com` form still includes `example.com` itself and its subdomains. Partial hostname wildcards use ASCII labels; use punycode for international labels. An omitted port matches any port; an explicit port restricts it. Patterns are not regular expressions.

Query filters apply only to the literal parameter names you enter. All listed parameters must be present once and their values must match; extra parameters are ignored. Order is irrelevant, and names/values are case-sensitive. Standard URL decoding is used for query comparison (`+` and `%20` both mean a space); `*` is the wildcard in decoded values. Repeated filtered keys are treated as ambiguous and do not match. A pattern with no query filters keeps its original query-insensitive behavior. Fragments are ignored in the page URL and must be omitted from patterns.

The popup previews whether the pattern matches the current tab and reports an existing Exact URL rule taking priority. Such a rule must be changed or removed in Manage rules before a lower-priority pattern can control that tab.

Open the rule-management settings page to search rules, change their match/title/icon, enable or disable them, or delete them. Disabling/deleting a winning rule exposes the next matching rule. If no rule or temporary override applies, TabMarker restores page metadata. Removing the applied customization may therefore reveal another applicable rule; it does not erase every matching rule.

### Matching and privacy

The winner is deterministic:

1. A temporary tab override takes precedence over saved rules.
2. Among enabled saved rules: **exact URL → URL pattern → domain**.
3. For competing patterns, the pattern with more non-wildcard characters wins.
4. Remaining ties use the latest `updatedAt`, then the lexicographically smallest rule ID.

Rules apply as a whole; a title from one rule and an icon from another are not merged. More recent domain rules do not override an exact URL rule.

Exact URLs are normalized to lowercase hostnames, without credentials or fragments. URL parsing removes default ports; path case and trailing slashes remain significant. General query parameters are ignored. The reviewed Autotask `view` exception below keeps only a recognized screen identifier. URL patterns can select query values explicitly, including unlisted Autotask views such as `inventory-order*`. Other exact URL rules remain query-insensitive; hash matching is not supported.

Saved addresses can still contain a hostname and path, and custom titles contain what the user enters. Avoid creating rules from paths or entering labels that contain confidential information. TabMarker does not copy page contents or actual query values into rule storage. A pattern stores the query filters you type, so avoid entering private values or pasting a full token-bearing URL as a pattern. Omitted parameters such as `view-data` are examined only if explicitly filtered and are not automatically copied.

### Autotask screens

On `autotask.net` or its subdomains at `/AutotaskOnyx/LandingPage`, **Exact URL** distinguishes `view=quote-search`, `view=generate-invoices` and `view=payment-processing-search`. The popup names the recognized screen and defaults to Exact URL when no customization applies. Choose your title/icon and save. In settings, paste the full Autotask link into an Exact URL rule; only the hostname, path and reviewed `view` value are retained.

Exact rules do not decode the `view-data` payload or store it; other query values and fragments are removed. Query-filtered patterns are a separate, explicit opt-in and do not require an allowlisted view. A screen-specific exact rule wins over an older exact rule for the shared landing page; the older rule remains a fallback for other screens. Query-only SPA navigation re-evaluates the screen. These three signatures come from user-supplied links and synthetic browser verification; automatic exact recognition of additional views and DOM/iframe identification require separate review; users can already create query-filtered patterns for additional views.

To update an unpacked installation while retaining its rules, replace the files in the **existing extension folder**, click **Reload** at `chrome://extensions`, and refresh Autotask tabs. Keep the same folder and extension ID. Version **0.4.0** retains rule schema 4 and existing matching behavior. A new folder can create a separate extension with separate storage; import a backup if moving installations.

## Rule storage, backups and recovery

Persistent rules are saved in `chrome.storage.local` under `tabmarker.state`, inside the installed extension's Chrome profile. They survive worker suspension and Chrome restarts. Removing the extension or deleting the profile removes that local storage. Temporary tab overrides are session-only and are intentionally excluded from backups.

In **Manage rules → Backups**, select **Choose backup file** and pick a JSON file outside the unpacked extension folder, for example in Documents. TabMarker writes the current rules there and updates that file after persistent rule changes. You can choose a folder already protected by your computer's backup or file-sync software. TabMarker itself does not synchronize between devices or read edits back from the file automatically.

Chrome requires you to choose the file and grant access. A file handle is remembered in extension-owned IndexedDB, but write access may need renewal after a browser restart. The popup links to backup status, and settings show the destination filename, last successful write and actionable errors. Use **Allow file access** or **Sync now** when needed. Disk failures do not discard the rule saved in Chrome. Changed files are detected by size/modification time; automatic updates pause if a previously synced file was edited externally. Keep a copy of that external file before using **Sync now**, which explicitly replaces it. Disconnecting keeps the file on disk. No new extension permissions are required for the [user-selected File System Access API](https://developer.chrome.com/docs/capabilities/web-apis/file-system-access); [Chrome controls permission persistence](https://developer.chrome.com/blog/persistent-permissions-for-the-file-system-access-api).

**Download backup** saves a portable JSON snapshot without connecting an automatic destination. **Import backup** validates the entire file (up to 32 MB), previews its rule count and waits for confirmation. Merge keeps existing rules and imports conflicting copies disabled for review; identical IDs/contents are skipped. Replace explicitly replaces all persistent rules, including with an empty backup. Import never changes temporary overrides, so a temporary override can still take priority afterward. Open tabs re-evaluate restored rules.

Before each rule change, up to **10 recent states within a 1 MB history budget** are stored under `tabmarker.recovery`. **Recent recovery copies** can undo an accidental edit/deletion or restore. They are inside the same profile and do not protect against uninstalling. An explicitly confirmed Replace import or recovery restore can also repair unreadable current state; the original unreadable data is preserved under `tabmarker.preservedState`. Ordinary saves and automatic startup never reset damaged or newer state.

Backups contain your custom labels, icons and matching addresses, including any query filters you entered. Store them privately. An external backup survives extension removal, but you still need your normal computer backup to protect against disk loss. No storage scheme guarantees that rules can never be lost.

## Module diagnostics

Open **Module diagnostics** from the editor, choose the target tab and select **Inspect tab**. The report shows the reviewed Autotask screen when recognized, whether the content script responded, whether the requested title and favicon links are applied, and every matching enabled saved rule in priority order. A temporary override is called out separately. It gives a next step for missing rules, priority conflicts and metadata mismatches.

Unknown Autotask views are labeled unrecognized rather than assigned a guessed module. They can still match explicit query-filtered patterns. Diagnostics inspect only the top document; iframe-only identity needs a separately verified integration. The favicon status checks DOM link attributes, not whether Chrome's icon cache or the website's CSP allows the icon to display.

The on-demand report is not saved or uploaded. Copied JSON excludes raw URLs, unreviewed query values and page contents. It includes static reviewed view labels, rule IDs, application booleans, matching scopes, extension version and coarse URL categories. The on-screen rule list uses labels/addresses you already saved.

## Native tab menu and toolbar fallback

TabMarker attempts to register native tab-strip commands with `chrome.contextMenus` and `contexts: ["tab"]`. Chrome versions and feature configurations differ; the toolbar popup is always available. A browser accepting the registration does not prove that its native menu renders the command. The context-clicked tab is the command target, including when it is a background tab.

The installed extension uses Chrome 120 as its baseline. A native tab-menu command opens a dedicated extension editor window with the clicked tab's ID, preserving its target even for an inactive tab. This avoids depending on programmatic `chrome.action.openPopup()`, which is generally available only starting in Chrome 127. Normal user-clicked toolbar popups work independently of that API. See [the API review](docs/chrome-api-review.md) for sources and version caveats.

## Architecture

| Location | Responsibility |
| --- | --- |
| `src/background/` | MV3 worker, validated messages, serialized storage updates, tab overrides, menu registration and reapplication |
| `src/content/` | Top-frame isolated script; page metadata replacement/restoration, debounced observers and navigation checks |
| `src/core/` | Pure URL normalization, wildcard matching, rule ordering, input validation, migration and SVG generation |
| `src/integrations/autotask.ts` | Explicitly approved module-adapter interface and privacy-filtered on-demand diagnostics |
| `src/ui/` | React toolbar/editor and searchable rule settings with Tailwind styles |
| `src/shared/` | TypeScript contracts and extension message client |
| `tests/unit/`, `tests/browser/` | Vitest logic checks and Playwright tests loading the built extension |
| `public/manifest.json` | Minimal extension permissions, HTTP(S) content-script registration and packaged assets |

Persistent rules use versioned schema **4** in `chrome.storage.local`. Schemas 1–3 are validated and migrated: schemas 1 and 2 retain query-insensitive exact matches, schema 1 migrates the earlier icon `letter` field, and schema 3 retains recognized Autotask exact views. Query-free patterns keep their existing behavior. Older extension releases reject schema 4 rather than misinterpreting the expanded pattern grammar. Unknown future versions, corrupt records, and duplicate IDs are rejected while preserving the stored data. Temporary overrides use `chrome.storage.session`; worker memory is disposable. A worker wake loads the state it needs, so idle suspension does not erase saved rules or session overrides.

The content script changes `document.title` and favicon `<link>` elements. It remembers original/page-authored metadata for the current document, recognizes its own writes, and debounces page mutations. If the page rewrites a customized title/icon, TabMarker reapplies the winner without repeatedly writing identical values. When customization ends, the latest observed page-authored title and original favicon elements/attributes are restored. Page code that continuously fights metadata can still cause bounded corrective work and visible churn; this extension cannot control the application.

SPA navigation uses page lifecycle events, mutation-triggered URL checks, and a modest URL heartbeat in the isolated script. This avoids main-world history hooks and the `webNavigation` permission. A history change without a DOM mutation can take until the next heartbeat to match, and background/frozen tabs can delay execution. A changed rule is propagated to open supported tabs.

## Permissions and limitations

- **`storage`** persists rules and browser-session overrides. **`contextMenus`** supplies native commands. **HTTP(S) host/site access** allows automatic customization after navigation and reopening. The extension requests no `tabs`, `scripting`, `webNavigation`, `history`, `cookies`, `debugger`, `unlimitedStorage`, or cached-favicon permission.
- Chrome internal pages such as `chrome://extensions`, the Chrome Web Store, other extensions' pages, `file:`, `data:`, `about:`, and browser PDF viewers are unsupported. The popup explains when a page cannot be customized. A normal HTTP(S) URL can also be inaccessible because site access is withheld or enterprise policy blocks injection.
- Only the top document is customized. An application whose module identity exists solely inside an iframe needs separate verified integration work. Incognito access is not enabled by default; private browsing is outside the validated MVP workflow.
- Some website Content Security Policies reject data-URL SVG favicons. Browser caching and SVG/font/emoji rendering can also affect appearance. Title changes can work even when Chrome cannot display a generated icon. TabMarker does not bypass page security policy.
- Reopening an address re-evaluates saved rules; a temporary override does not follow a reopened tab. Persisted rules apply when restored pages actually load. Chrome may initially show cached titles/icons before content scripts run, particularly for discarded/restored tabs.
- The extension changes page metadata, so title-dependent page features may see the custom title. It does not rename Chrome windows, tab groups, bookmarks, history records, or every Chrome UI label. Another extension or browser-managed surface can override the visible result.
- Removing the extension deletes its profile-local rules and recovery copies. Choose a separate backup file or export a snapshot first. File access is browser-controlled and macOS native picker behavior has not been exercised by the Linux automated tests. Local-first storage is not encrypted secret storage.

## Validation

```sh
npm run typecheck
npm run test:unit
npm run test:content
npm run test:browser
# Or run all three suites:
npm run test:all
```

| Command | What it exercises |
| --- | --- |
| `test:unit` | Pure rule matching, normalization, priority, validation/migration, SVG generation and diagnostic privacy with Vitest |
| `test:content` | Built content-script behavior in a real Chromium document, using a **mocked extension runtime** and local HTTP fixture |
| `test:browser` | The full built extension in a persistent Chromium profile, including real worker/storage/UI workflows |

The content-only suite builds `dist` and uses `playwright.content.config.ts`. It provides browser DOM evidence for title/favicon behavior, observers and navigation; its mocked runtime does **not** prove extension loading, Chrome API permissions, service-worker suspension, browser-session storage or full-extension restart behavior.

Full-extension browser tests build `dist` and load it into a real persistent Chromium profile against a local HTTP fixture. Tests use `/usr/bin/chromium` by default; select a suitable Chromium executable when needed:

```sh
CHROMIUM_PATH=/path/to/chromium npm run test:browser
```

Use Chromium that supports unpacked-extension loading and whose policy permits it. Some branded Chrome builds disallow extension-loading automation flags. The fixture runs headlessly, creates a temporary profile, and removes it after the test; no live customer application is used. On systems without Chromium, install an appropriate system package or supply a compatible installed executable through `CHROMIUM_PATH`.

The original cloud image blocked all extension installation and test-browser downloads. Local verification on ubt-lab used an already installed Chrome for Testing browser that permits unpacked extensions; all suites now pass. Set `CHROMIUM_PATH` when `/usr/bin/chromium` is unavailable. No managed policy was changed. The historical cloud blockers and current local results are recorded in [docs/validation.md](docs/validation.md).

Test execution results and the precise scope of the worker-suspension/browser-restart evidence are recorded in [docs/validation.md](docs/validation.md). The native context menu and inactive-tab targeting were visually exercised on Chrome for Testing 151; check availability in other target Chrome versions. Live Autotask testing remains separate; follow [docs/autotask-testing.md](docs/autotask-testing.md). Do not infer live Autotask support from synthetic browser fixtures.
