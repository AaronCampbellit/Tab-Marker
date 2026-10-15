# Validation record

Date: **2026-10-14**. The local extension acceptance checks pass after correcting three test assumptions and a toolbar popup sizing bug, then migrating to Tailwind **4.3.3** to remove the affected build dependency chains. Version **0.3.0** adds partial-hostname wildcards, explicit query-value filters and current-tab pattern previews, including the reported `view=inventory-order*` case. Live Autotask application and DOM module validation remain outstanding.

Environment: **ubt-lab**, Linux, Node **24.19.0**, npm **11.17.0**, Playwright **1.64.1**, installed **Google Chrome for Testing 151.0.7922.34**. Browser suites use synthetic local HTTP pages and disposable profiles. Headed Chrome checks ran on a task-specific Xvfb display. No customer application or browser profile was used.

## Local results

| Check | Result | Evidence and boundary |
| --- | --- | --- |
| Clean dependency installation | Passed | `npm ci --no-audit --no-fund`; regenerated lockfile verified by a fresh clean install; Tailwind and its official Vite plugin both pinned to **4.3.3** |
| Production build and TypeScript | Passed | `npm run build` includes `tsc --noEmit`; packaged MV3 manifest, React pages, worker and content script |
| Vitest | **178 passed, 7 files** | Rule matching, normalization, validation/migration, diagnostic privacy and mocked worker behavior |
| Chromium content DOM tests | **6 passed** | Built content script in real Chrome documents with only the runtime messaging API mocked |
| Full-extension browser tests | **16 passed, none skipped** | Real extension installation, worker, Chrome messaging/storage, title/favicon rendering, navigation, persistence, settings and restricted-page behavior |
| Real toolbar popup | Passed | Opened through Chrome's Extensions toolbar menu; measured viewport and document width **390px**, height **600px**; typed `toolbar qa` and clicked Save; active website title and session override updated |
| Native tab context menu | Passed on tested browser | Visually observed the actual tab-strip command; clicked it on an inactive tab, saved a temporary customization, and confirmed the inactive tab changed while the active tab retained its original title |
| Settings visual checks | Passed | Actual extension settings at **1440×900** and **390×844**; document widths do not exceed viewport widths (headed Chrome may reserve 15px for its vertical scrollbar), with no horizontal overflow; create/save/toggle/search and narrow editor checks pass |
| Console health | No application errors | Vite's generated shared-module preload produces Chrome warnings about an unused/cross-world preload; both pages load and execute normally |
| Production dependency audit | Passed | `npm audit --omit=dev` reports zero known vulnerabilities; not a comprehensive security audit |
| Full dependency audit | **Passed: zero findings** | `npm audit` and `npm audit --json`; all six previously affected transitive packages removed, Tailwind 3 replaced |
| Manifest/package verification | Passed | MV3 and every manifest-referenced worker, content script, page and icon exist in `dist/` |

Final suite command:

```sh
CHROMIUM_PATH=/home/acampbell/.cache/ms-playwright/chromium-1234/chrome-linux64/chrome npm run test:all
```

This ran **200 tests**, all passing, with production builds/typechecks before both browser suites. Set `CHROMIUM_PATH` to a compatible installed browser on other machines. No new browser installation or managed-policy modification was needed here.

## Corrections discovered by local verification

- The content fixture tried to redefine the browser's non-configurable `window.chrome`. It now keeps that object and mocks only `chrome.runtime`. The six DOM assertions then execute successfully.
- The settings checkbox test assumed synchronous persistence. It now clicks once and waits for the checked state, enabled state and website title to converge after asynchronous Chrome messaging. No application behavior was changed for this correction.
- The worker test assumed termination would emit a Playwright Worker close event and create a new handle. [Playwright preserves its MV3 worker handle across suspension](https://playwright.dev/docs/chrome-extensions#service-worker-idle-suspension-mv3). The test now uses CDP `ServiceWorker.stopWorker`, asserts `stopped` then `running` lifecycle states, and verifies a worker-global sentinel disappears. This proves a fresh execution even when browser target and Playwright handle identities remain stable. The recovered temporary override then survives navigation and expires on a full browser restart; the saved domain rule remains.
- The real toolbar popup initially measured about **199px** wide and crowded its controls. Ordinary-page popup tests did not reveal Chrome's initial viewport sizing. `popup.html` now identifies its document, and CSS assigns a **390px** intrinsic root width to the toolbar popup. The separate editor window retains responsive sizing. The actual toolbar popup was reopened and exercised after rebuilding.

## Tailwind 4 dependency remediation

The original full audit reported **seven affected package entries** from two underlying advisories: [braces stack exhaustion](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm) and [PostCSS selector parsing](https://github.com/advisories/GHSA-rj75-hqrm-r3gf). Their demonstrated repository paths were build-time source globs and CSS selectors; visited websites and saved rules do not use these packages. No runtime exploit was demonstrated.

The approved migration pins `tailwindcss` and `@tailwindcss/vite` to **4.3.3**, adds the official Vite plugin, switches the stylesheet to the CSS import/source configuration, and removes the old Tailwind/PostCSS configuration files and direct `autoprefixer`/`postcss` dependencies. Vite still uses its own unaffected PostCSS dependency. No forced dependency overrides were added.

Fresh installation and lockfile inspection show **braces, chokidar, micromatch, fast-glob, postcss-selector-parser and postcss-nested are all absent**, eliminating both previously flagged parser paths, including alternate pattern/selector forms. `npm audit` reports zero known vulnerabilities across the complete current graph. The background script, content script and manifest are byte-identical to the pre-migration production artifacts.

The stylesheet retains the previous used color palette, shadow sizes, accessible outline utility and placeholder color. An actual visual check found Tailwind 4's cascade layers overrode the color input's padding; a component-layer rule restores **4px padding** and its **42px height**. Final checks confirm primary buttons remain `rgb(79, 70, 229)`, placeholders `rgb(156, 163, 175)`, focused fields have a **3px outline**, the toolbar document remains **390×600** with Save in view, and narrow rule/editor views have no horizontal overflow. The real toolbar uses native input and click events and saves into Chrome storage.

Independent read-only investigation and candidate review found no surviving affected dependency path or further concrete regression. Full suites passed (**117 unit + 6 content + 10 extension**); after the final placeholder adjustment, build/typecheck and all **10 extension tests** passed again, alongside the final rendered checks. No additional regression tests were added for this build-tool migration; existing functional suites and actual browser geometry/style checks supplied the evidence.

## Query wildcard matching in 0.3.0

The exact failing pattern from the screenshot, `https://ww5.autotask.net/AutotaskOnyx/LandingPage?view=inventory-order*`, is now accepted, persisted unchanged and tested against actual extension messaging. Partial hostname patterns such as `ww*.autotask.net` also work. Multiple explicit query filters match independently of parameter order, while omitted query keys do not restrict the match. Filtered keys must occur once; names are literal and values use the same greedy wildcard matcher as paths. Controls, credentials, fragments, duplicate filter keys and oversized patterns remain rejected. Pattern canonicalization and matching enforce the same normalized size limit.

A parser-only fix would have been insufficient: 0.2.0 stripped unreviewed query values before worker selection. The worker now reads the current URL directly from Chrome for rule selection, previews, reapplication and SPA-ready responses. Raw query values stay transient in worker memory. Sanitized content messages and UI URLs are unchanged. Only query filters explicitly typed by the user are stored; actual omitted `view-data`, token and other query values are not copied.

Schema **4** migrates schemas 1–3 while preserving old exact semantics, recognized view rules and query-free patterns. Pattern specificity and existing exact-over-pattern priority remain intact. The preview reports whether the current tab matches and whether an exact rule has priority; save feedback reports that conflict too.

The full suite passed **178 unit + 6 content + 16 extension = 200 tests**. After consolidating the encoded-size guard, typecheck, all **178 unit tests**, build and the **three targeted query-pattern browser tests** passed again. New coverage includes the reported inventory wildcard, hostname fragments, query encoding/order/duplicates, long/adversarial inputs, preview privacy/authorization, SPA query changes, settings, original pattern fallbacks and browser restart. All Autotask network requests were intercepted; live application access remains untested.

A 390×600 popup visual check confirmed the live match status, saving without an error, a changed website title, Save remaining visible, and no horizontal overflow. Stored rules contain only the user-entered inventory filter, without synthetic private values. Existing shared-module preload warnings remain; no application errors were observed. Visual evidence is under `/tmp/tabmarker-query-patterns-qa/` (`pattern-confirmed.png`, `pattern-saved.png`).

## Autotask view routing in 0.2.0

The user supplied three HTTPS links sharing `/AutotaskOnyx/LandingPage`, distinguished by `view=quote-search`, `view=generate-invoices` and `view=payment-processing-search`. Exact URL matching now preserves only these reviewed values on Autotask hosts. Content messaging, tab updates, rule writes, reapplication and stale-route checks use the same canonical matching URL. At the time of 0.2.0, patterns and general exact URLs retained query-insensitive behavior; 0.3.0 adds explicit query filters to patterns.

Schema **3** preserves new view-specific matches; migration from schemas 1 and 2 retains their path-only exact rule behavior. A view-specific exact match outranks a generic exact landing-page rule. Unknown or ambiguous views are stripped and can use an existing generic fallback. `view-data` is never decoded; credentials, other queries and fragments are excluded from stored addresses.

**19 additional unit cases** cover allowed views, host/path boundaries, duplicate keys, inherited-property names, sanitization, priority and migration. **Three additional real-extension tests** intercept the Autotask host without network access, covering independent popup saves for all three screens, view-specific settings entry, all-screen browser-restart persistence, query-only `pushState`/`replaceState`, fallback/restoration and exclusion of both plaintext and base64 synthetic private data from storage. All **155 tests** pass. The popup and settings were also inspected at narrow and desktop sizes; existing preload warnings remain and no application errors were observed.

MacBook SSH reachability was confirmed, but no Chrome debugging/extension automation bridge was available in this session. Its browser settings and live application were not changed. Verification used the existing local Chrome for Testing browser.

## What the DOM and extension tests prove

The six content-only checks verify title/favicon replacement and restoration, rendered SVG dimensions and color, observer convergence, reused favicon nodes, whole-head replacement, page-authored metadata on an extension-created icon, and SPA heartbeat URL sanitization. Their mocked runtime does not independently establish extension loading or storage behavior.

The ten full-extension checks establish real declarative injection and messaging; a decoded 64×64 SVG and Chrome's `tabs.Tab.favIconUrl`; persistent rules after tab reopening and complete browser restart; deterministic rule fallback; ordinary and SPA navigation; page-driven metadata conflict correction without ongoing rewrites; actual forced worker stop/restart with cleared globals and retained session overrides; diagnostic privacy; settings create/search/edit/disable/re-enable/delete; restricted-page feedback; and native menu API probing.

The native command was additionally exercised through the rendered Chrome menu. Registration probing alone is not the evidence for its visual availability or inactive-tab targeting.

## Remaining validation limits

- These results cover Chrome for Testing **151** on Linux. Chrome **120** is the declared baseline, but that version, other operating systems, incognito, enterprise policies and user-withheld site access were not exercised here. Verify native menu availability in each intended browser; toolbar fallback remains available.
- Forced worker stop/restart was verified. Natural idle suspension was not independently tested; debugger/automation attachment can affect lifetime.
- The restart test reopens a matching address in the same profile. It does not verify Chrome restoring a previously open or discarded tab session automatically.
- The three supplied Autotask view routes are synthetically verified; live application behavior, additional routes, iframe modules and DOM module signatures remain unverified. `APPROVED_AUTOTASK_ADAPTERS` stays empty. Follow [the live-test guide](autotask-testing.md) with an approved sample-data account before adding adapters.
- Strict website CSP, favicon caches and browser-managed surfaces can still affect the visible favicon, as documented in the README.

Autotask 0.2.0 visual evidence is in `/tmp/tabmarker-autotask-qa/`. Earlier Tailwind 4 visual evidence is in `/tmp/tabmarker-tailwind4/`: `toolbar-final.png`, `settings-desktop.png`, `settings-narrow.png` and `settings-editor-narrow.png`. Earlier local-installation evidence is in `/tmp/tabmarker-verification/`, including `toolbar-popup-after.png`, `background-tab-menu.png`, `background-editor.png`, `settings-desktop.png` and `settings-narrow.png`. Temporary evidence is not committed and may be cleared by the host.

## Historical cloud attempt

The original cloud environment used Node **24.19.0**, npm **11.9.0** and system Chromium **154.0.8037.57**. Dependency installation, build, 117 unit tests, six mocked-runtime DOM tests and a mocked-page UI review passed. The full extension suite encountered one startup failure, nine tests did not run, and zero passed.

That image's managed `ExtensionInstallBlocklist: ["*"]` prevented unpacked-extension installation. Its policy was left unchanged. Official test-browser downloads from `cdn.playwright.dev` and `storage.googleapis.com` received HTTP 403 from the environment proxy. Network/environment drafts were saved but not published or verified. Those were cloud prerequisites; the local installed test browser allowed acceptance checks to run without changing them.
