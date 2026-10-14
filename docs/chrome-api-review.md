# Chrome API review

Reviewed on **2026-10-14**, before implementing version-dependent extension behavior.

## Source access and confidence

Requests to the public `developer.chrome.com` documentation returned HTTP 403 from this environment's network proxy, including a retry after an environment allowlist draft was saved. The review therefore used the official **Chromium** source and the official **GoogleChrome/developer.chrome.com** documentation source, retrieved successfully over HTTPS from `raw.githubusercontent.com`. Chromium `main` describes current implementation; it does **not** establish the first released Chrome version of a feature. The GoogleChrome Markdown pages use the former `/mv3/` documentation layout and provide the documented baseline. Runtime feature checks and browser tests remain necessary.

## Native tab context menu

Public documentation: <https://developer.chrome.com/docs/extensions/reference/api/contextMenus>

Authoritative sources inspected:

- [Current API schema](https://raw.githubusercontent.com/chromium/chromium/main/chrome/common/extensions/api/context_menus.json)
- [Tab menu implementation](https://raw.githubusercontent.com/chromium/chromium/main/chrome/browser/ui/tabs/tab_menu_model.cc)
- [Feature defaults](https://raw.githubusercontent.com/chromium/chromium/main/extensions/common/extension_features.cc)
- [Event dispatch and tab information](https://raw.githubusercontent.com/chromium/chromium/main/chrome/browser/extensions/menu_manager.cc)

Findings:

- The current schema explicitly includes `ContextType: "tab"`, described as the context menu of a tab in the tab strip. `"all"` **excludes** `"tab"`; registration must request `contexts: ["tab"]` explicitly.
- Chromium renders these entries only when `kExtensionTabContextMenu` is enabled. Current `main` enables it by default, but registration success alone cannot prove that a particular deployed browser displays the item. No first shipped version was established from these sources.
- Use a stable string `id` when creating menus in a service worker, and a top-level `chrome.contextMenus.onClicked` listener. The `onclick` property of individual menu entries is unavailable in service workers.
- Registration errors can surface either synchronously or in the completion callback through `chrome.runtime.lastError`. Catch both, consume `lastError`, and keep the toolbar popup available in every case.
- `onClicked` receives an optional second `tabs.Tab` argument. For the tab-strip menu, Chromium executes against the context-clicked tab's `WebContents`; this can be a background tab. Do not substitute the currently active tab. The tab can disappear while the menu is open, so validate its ID when performing an operation.
- The tab menu constructs minimal click metadata containing the page URL; no selected page text is required for the workflow. The `tab` event argument may be absent in other menu contexts.
- The schema's six-item limit is specifically for top-level **action** menus. It does not establish a six-item tab menu limit. A small number of entries still gives the clearest interface.

Implementation decision: attempt native registration at runtime, report registration acceptance accurately, and retain the toolbar popup as a permanent fallback. A native Chrome menu requires a manual visual check; creating a menu or dispatching its click handler in a test does not verify rendered menu visibility.

## Programmatically opening the editor

Public documentation: <https://developer.chrome.com/docs/extensions/reference/api/action#method-openPopup>

Source: [Current action schema](https://raw.githubusercontent.com/chromium/chromium/main/chrome/common/extensions/api/action.json).

`chrome.action.openPopup()` is available to ordinary extensions from **Chrome 127**. The current schema explicitly states that Chrome 118–126 restricts it to policy-installed extensions. A Chrome 120 minimum can therefore support the toolbar's normal user-clicked popup, but must catch failure when opening it programmatically and offer an extension editor window. The context-clicked tab ID must be passed explicitly to the editor so an unselected tab is edited correctly.

## Service-worker lifetime and storage

Public documentation:

- <https://developer.chrome.com/docs/extensions/develop/concepts/service-workers/lifecycle>
- <https://developer.chrome.com/docs/extensions/reference/api/storage>

Sources:

- [Official lifecycle documentation source](https://raw.githubusercontent.com/GoogleChrome/developer.chrome.com/main/site/en/docs/extensions/mv3/service_workers/service-worker-lifecycle/index.md)
- [Official storage documentation source](https://raw.githubusercontent.com/GoogleChrome/developer.chrome.com/main/site/en/docs/extensions/reference/storage/index.md)
- [Current storage schema](https://raw.githubusercontent.com/chromium/chromium/main/extensions/common/api/storage.json)

Chrome normally terminates an extension service worker after about 30 seconds of inactivity; individual events/requests and slow fetches also have limits. Events wake a dormant worker. Extension API activity resets the idle timer on modern Chrome, so opening DevTools or repeatedly sending health pings can invalidate an idle-suspension test.

Worker globals are a disposable cache. Persistent rules belong in `chrome.storage.local`; temporary tab overrides belong in `chrome.storage.session`. Session storage survives worker suspension, but is memory-only and does not provide browser-restart persistence. Remove closed-tab overrides using `tabs.onRemoved`; do not treat numeric tab IDs as stable across browser sessions.

`storage.local` and `storage.session` each allow approximately 10 MB on the chosen Chrome 120 baseline. There is no need for `unlimitedStorage`. Session storage is restricted to trusted extension contexts by default. Current `local` storage is exposed to content-script contexts by default and supports `setAccessLevel({accessLevel: "TRUSTED_CONTEXTS"})`. Prefer worker-owned validation and writes rather than exposing all saved rules to every content script. Neither local storage nor session storage is a secret vault.

Register worker listeners synchronously at module scope. Each event should safely initialize/migrate state after a wake. Serialize read-modify-write operations and reject unknown future schema versions instead of silently overwriting them. Migration and restore behavior need tests independent of worker globals.

## Permissions, isolated scripts, and SPA navigation

Public documentation:

- <https://developer.chrome.com/docs/extensions/develop/concepts/content-scripts>
- <https://developer.chrome.com/docs/extensions/reference/api/tabs>
- <https://developer.chrome.com/docs/extensions/reference/api/webNavigation#event-onHistoryStateUpdated>

Sources:

- [Official content-script documentation source](https://raw.githubusercontent.com/GoogleChrome/developer.chrome.com/main/site/en/docs/extensions/mv3/content_scripts/index.md)
- [Current tabs schema](https://raw.githubusercontent.com/chromium/chromium/main/chrome/common/extensions/api/tabs.json)
- [Current navigation schema](https://raw.githubusercontent.com/chromium/chromium/main/chrome/common/extensions/api/web_navigation.json)

Content scripts default to an isolated JavaScript world while sharing the page DOM. This is sufficient for `document.title`, `<head>` favicon links, DOM observation, and reading `location.href`. Overriding `history.pushState` only inside the isolated world does not reliably intercept the page's own JavaScript calls. `popstate` and `hashchange` also do not cover every `pushState`/`replaceState` call.

The MVP can avoid main-world script injection and the additional `webNavigation` permission by checking the current URL on DOM activity, page lifecycle events, and a modest content-script timer. A URL change without a DOM mutation is detected on that timer. Background throttling, tab freezing, and discarding can delay execution; recheck on visibility/pageshow/resume and document that short delays are possible. `webNavigation.onHistoryStateUpdated` is the documented event-based alternative if live testing later justifies the permission.

The `tabs` API namespace itself does not always require the `tabs` permission. Sensitive properties (`url`, `pendingUrl`, `title`, `favIconUrl`) are available with matching host permission **or** `tabs`. Automatic operation on ordinary HTTP(S) websites needs matching site access; `activeTab` alone is a temporary user-gesture grant and cannot supply unattended matching after browser restart. Keep the manifest's permissions explainable: storage for rules/session overrides, contextMenus for native commands, HTTP(S) access for automatic content scripts, and scripting only if used for an existing-tab bootstrap. Avoid history, cookies, webRequest, debugger, and favicon-reading permissions.

## Favicon behavior and restricted pages

Public documentation:

- <https://developer.chrome.com/docs/extensions/how-to/ui/favicons>
- <https://developer.chrome.com/docs/extensions/develop/concepts/declare-permissions>

Sources:

- [Official favicon documentation source](https://raw.githubusercontent.com/GoogleChrome/developer.chrome.com/main/site/en/docs/extensions/mv3/favicon/index.md)
- [Chromium restricted-URL checks](https://raw.githubusercontent.com/chromium/chromium/main/extensions/common/permissions/permissions_data.cc)
- [Chrome Web Store scripting prohibition](https://raw.githubusercontent.com/chromium/chromium/main/chrome/common/extensions/chrome_extensions_client.cc)

Chrome's `favicon` permission provides access to cached website icons through an extension URL. It is **not** an API to set another tab's favicon and is unnecessary when generating a local SVG and modifying the page's `<link rel="icon">` elements. There is also no supported `chrome.tabs.update({title, favicon})` operation; the page DOM is the customization surface.

Chrome does not provide content scripts with a reliable extension-unload cleanup event. Disabling/removing/reloading an extension can leave its DOM changes in the currently loaded page; refresh the website to restore its own metadata or to connect a reinstalled content script.

An SVG favicon is a page resource. The page's effective image policy, browser favicon cache, page rewrites, or another extension may affect its rendering. Restrictive CSP can reject a generated data URL. A test of link markup alone is weaker evidence than confirming `tabs.Tab.favIconUrl` and image decoding. Document any policy restriction rather than disabling page security or claiming universal support. Preserve original link attributes/nodes and the latest page-authored title so removing customization restores page metadata rather than imposing a captured stale value.

Ordinary extensions cannot script Chrome internal pages, Chrome Web Store pages, or other extensions' pages. This MVP intentionally scopes content scripts to HTTP(S); `file:`, `data:`, `about:`, browser PDF viewer documents, extension pages, and unsupported embedded-frame surfaces are outside its supported customization surface. Enterprise policy or the user's withheld site access can additionally block injection on an otherwise normal website. The UI must identify restricted pages or missing access and avoid promising changes there.

## Validation boundary

This review verifies API contracts and implementation constraints. It does not by itself demonstrate TabMarker behavior. Required project validation includes real extension loading; title and decodable favicon replacement; persistent-rule application after navigation, tab reopening and profile restart; page-driven metadata conflict correction without unbounded mutations; session override survival after forced worker stop/restart; and the toolbar fallback. Browser menu visibility and real Autotask route/module identification need explicit manual checks where automation cannot provide evidence.
