# TabMarker

TabMarker is a local-first Chrome Manifest V3 extension for custom tab titles and highly visible colored SVG favicons. Use a temporary customization for one tab, or save a rule that reapplies when a matching page opens. It is designed for repeated web application tabs, including future verified Autotask PSA module detection.

There is no backend, account, external API, telemetry, or remote asset dependency. Rules remain in this Chrome profile. Autotask module signatures are deliberately empty until tested against the live application. Local verification passed all **133 tests**, including real extension loading, browser/worker restart behavior, the toolbar popup and native inactive-tab menu editing on Chrome for Testing 151. See [validation](docs/validation.md) for evidence and the unverified live Autotask scope. Both production and development dependency audits are clean after the Tailwind 4 migration.

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

## Customizing tabs

Set a title, an icon, or both. Icons use a six-digit hex color and one visible letter, number, or symbol. Titles are limited to 120 characters. An unset title or icon leaves that part of the page's metadata under page control.

| Scope | Matches | Lifetime |
| --- | --- | --- |
| This tab | The current numeric Chrome tab ID, including subsequent supported navigation | Until the tab closes, extension reloads, or the browser fully exits |
| Exact URL | Normalized scheme, hostname, port and path | Saved locally across tab reopening and browser restart |
| URL pattern | An explicit HTTP(S) wildcard pattern | Saved locally across tab reopening and browser restart |
| Domain | Hostname and its subdomains, on HTTP or HTTPS and any port | Saved locally across tab reopening and browser restart |

Example pattern: `https://*.example.com/workspace/*`. `*` is allowed for the scheme (HTTP and HTTPS), for the entire hostname or a leading `*.`, and within the path. `*.example.com` includes `example.com` itself and its subdomains. An omitted pattern port matches any port; an explicit port restricts it. Patterns are not regular expressions.

Open the rule-management settings page to search rules, change their match/title/icon, enable or disable them, or delete them. Disabling/deleting a winning rule exposes the next matching rule. If no rule or temporary override applies, TabMarker restores page metadata. Removing the applied customization may therefore reveal another applicable rule; it does not erase every matching rule.

### Matching and privacy

The winner is deterministic:

1. A temporary tab override takes precedence over saved rules.
2. Among enabled saved rules: **exact URL → URL pattern → domain**.
3. For competing patterns, the pattern with more non-wildcard characters wins.
4. Remaining ties use the latest `updatedAt`, then the lexicographically smallest rule ID.

Rules apply as a whole; a title from one rule and an icon from another are not merged. More recent domain rules do not override an exact URL rule.

Exact URLs are normalized to lowercase hostnames, without credentials, query strings, or fragments. URL parsing removes default ports; path case and trailing slashes remain significant. Patterns reject queries and fragments. **Two pages distinguished only by query or hash share the same matching address.** This is an intentional privacy tradeoff and a known limitation for some application modules. No unverified Autotask route or query value is hardcoded.

Saved addresses can still contain a hostname and path, and custom titles contain what the user enters. Avoid creating rules from paths or entering labels that contain confidential information. TabMarker does not collect page contents, page-authored titles, authentication tokens, or sensitive query values into rule storage.

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

Persistent rules use versioned schema **2** in `chrome.storage.local`. Schema 1 is validated and migrated, including the earlier icon `letter` field. Unknown future versions, corrupt records, and duplicate IDs are rejected while preserving the stored data. Temporary overrides use `chrome.storage.session`; worker memory is disposable. A worker wake loads the state it needs, so idle suspension does not erase saved rules or session overrides.

The content script changes `document.title` and favicon `<link>` elements. It remembers original/page-authored metadata for the current document, recognizes its own writes, and debounces page mutations. If the page rewrites a customized title/icon, TabMarker reapplies the winner without repeatedly writing identical values. When customization ends, the latest observed page-authored title and original favicon elements/attributes are restored. Page code that continuously fights metadata can still cause bounded corrective work and visible churn; this extension cannot control the application.

SPA navigation uses page lifecycle events, mutation-triggered URL checks, and a modest URL heartbeat in the isolated script. This avoids main-world history hooks and the `webNavigation` permission. A history change without a DOM mutation can take until the next heartbeat to match, and background/frozen tabs can delay execution. A changed rule is propagated to open supported tabs.

## Permissions and limitations

- **`storage`** persists rules and browser-session overrides. **`contextMenus`** supplies native commands. **HTTP(S) host/site access** allows automatic customization after navigation and reopening. The extension requests no `tabs`, `scripting`, `webNavigation`, `history`, `cookies`, `debugger`, `unlimitedStorage`, or cached-favicon permission.
- Chrome internal pages such as `chrome://extensions`, the Chrome Web Store, other extensions' pages, `file:`, `data:`, `about:`, and browser PDF viewers are unsupported. The popup explains when a page cannot be customized. A normal HTTP(S) URL can also be inaccessible because site access is withheld or enterprise policy blocks injection.
- Only the top document is customized. An application whose module identity exists solely inside an iframe needs separate verified integration work. Incognito access is not enabled by default; private browsing is outside the validated MVP workflow.
- Some website Content Security Policies reject data-URL SVG favicons. Browser caching and SVG/font/emoji rendering can also affect appearance. Title changes can work even when Chrome cannot display a generated icon. TabMarker does not bypass page security policy.
- Reopening an address re-evaluates saved rules; a temporary override does not follow a reopened tab. Persisted rules apply when restored pages actually load. Chrome may initially show cached titles/icons before content scripts run, particularly for discarded/restored tabs.
- The extension changes page metadata, so title-dependent page features may see the custom title. It does not rename Chrome windows, tab groups, bookmarks, history records, or every Chrome UI label. Another extension or browser-managed surface can override the visible result.
- No synchronization or export/import service is included. Removing the extension deletes its local rules. Local-first storage is not encrypted secret storage.

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
