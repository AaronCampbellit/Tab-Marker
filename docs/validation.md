# Validation record

Date: **2026-10-14**. This is an MVP candidate; full-extension browser acceptance is outstanding.

Environment: Linux, Node **24.19.0**, npm **11.9.0**, system Chromium **154.0.8037.57**. Tests use synthetic local pages, not Autotask or customer data.

| Check | Result | Evidence and boundary |
| --- | --- | --- |
| Clean dependency installation | Passed | `npm ci --no-audit --no-fund`, using writable `/tmp/tabmarker-npm-cache`; frozen lockfile |
| Production build and TypeScript | Passed | `npm run build` and `npm run typecheck`; packaged MV3 manifest, React pages, worker and content bundles in `dist/` |
| Vitest | **117 passed, 5 files** | Normalization, priority, deterministic glob matching, validation, schema migration, SVG safety, privacy, concurrent worker writes, sender authorization, clock rollback, module reload persistence |
| Chromium content DOM tests | **6 passed** | Actual built `dist/content.js` executes in real Chromium, with runtime messaging mocked; all six tests ran, none skipped |
| Popup/settings visual review | Passed within stated scope | Built pages served locally with an in-memory Chrome API mock; 390×600 popup keeps Save visible, narrow settings have no horizontal overflow, no page errors. This does not test a Chrome toolbar popup itself. |
| Full-extension Playwright suite | **Blocked: 1 startup failure; 9 did not run; 0 passed** | `npx playwright test --max-failures=1`; extension worker never appeared because this browser blocks all extension installation. No workflow assertion executed. |
| Production dependency audit | Passed | `npm audit --omit=dev` reported zero known vulnerabilities at execution; this is not a comprehensive security audit |

## What the six DOM tests prove

Run `npm run test:content`. These checks load the compiled content script into an ordinary HTTP page and mock only its Chrome runtime boundary. They verify:

1. Title replacement, SVG image decoding to 64×64 with the expected background pixel, latest page-authored title/icon restoration, and no further head mutations after settling.
2. Custom title A → B → no matching rule restores the original title/icon.
3. A favicon node detached for longer than the debounce window and reused retains its original metadata.
4. Replacing the whole document head reapplies customization and later restores the replacement head's metadata.
5. A page editing an extension-created favicon retains its authored icon when customization ends.
6. SPA `pushState` without DOM mutations is discovered through the URL heartbeat; outgoing match URLs omit query values and fragments.

They do **not** prove declarative extension injection, isolated-world behavior, Chrome tab-strip favicon rendering, message transport, Chrome storage persistence, native menu visibility, or an actual MV3 worker lifecycle.

## Worker and persistence boundary

Vitest imports the real background module, mocking Chrome APIs. It verifies serialized writes and reloads the module while retaining mocked local/session storage. This demonstrates the code does not rely on worker globals for rule/override recovery. It does **not** demonstrate real Chrome service-worker suspension, a Chrome browser restart, or tab restoration.

The full-extension suite includes profile restart/reopening tests and a CDP forced-worker-termination test that requires worker closure and a new worker instance. Those are written but **unexecuted**. Natural 30-second idle suspension is not independently tested. No claim of successful browser-session restoration or worker suspension is made here.

## Confirmed external blockers and next action

The existing system Chromium has a managed `ExtensionInstallBlocklist` containing `"*"`. Its managed policy was inspected read-only and left unchanged. This prevents unpacked-extension loading even with a clean temporary profile and the normal automation flags. A restricted-browser-page test also needs an authorized browser whose URL policy permits that test target.

The official Playwright Chrome for Testing installer was attempted. Downloads from `cdn.playwright.dev` failed with HTTP 403 `Domain forbidden`; a read-only check of the official `storage.googleapis.com/chrome-for-testing-public/…` archive also received proxy403. This is a network prerequisite, not an extension test failure.

Environment draft fields **install_script**, **start_skill**, and custom network domain additions were saved. The added domains are `developer.chrome.com`, `cdn.playwright.dev`, `playwright.download.prss.microsoft.com`, and `storage.googleapis.com`; existing package-manager presets were retained. Draft saving does not apply runtime policy, download a browser, or publish the environment.

To finish acceptance:

1. Apply the saved network settings in environment settings, or supply an already authorized extension-capable test browser. Keep managed browser policy unchanged.
2. If downloading, run `PLAYWRIGHT_BROWSERS_PATH=/workspace/.cache/tabmarker-playwright npx playwright install chromium --no-shell`. Use that installation's Chrome executable as `CHROMIUM_PATH`.
3. Run `CHROMIUM_PATH=/path/to/authorized/chrome npm run test:browser`. Fix any newly exposed failure, then update this record with actual outcomes.
4. Manually inspect native tab context-menu visibility and its background-tab target in the target Chrome version; registration acceptance alone is insufficient.
5. Follow [the Autotask live-test guide](autotask-testing.md) before approving any module signatures.

Reusable setup instructions are saved for review. Environment publication and restoration in a new task have not been performed or verified.
