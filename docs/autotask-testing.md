# Autotask module testing

Version 0.3.0 supports user-defined query-filtered URL patterns as well as the reviewed exact landing-page views below and ordinary URL/domain rules. This does **not** claim live Autotask or DOM module validation. `APPROVED_AUTOTASK_ADAPTERS` in `src/integrations/autotask.ts` is empty, so no module routes or DOM identifiers have been guessed.

## Reviewed landing-page views

The user supplied links on `ww5.autotask.net/AutotaskOnyx/LandingPage` with these routing values:

| View | Screen |
| --- | --- |
| `quote-search` | Quote search |
| `generate-invoices` | Generate invoices |
| `payment-processing-search` | Payment processing |

The pure helper in `src/integrations/autotask-routing.ts` recognizes only these static values on the exact landing-page path and `autotask.net` or dot-delimited subdomains. Duplicate or differently cased view keys, unreviewed values, lookalike domains and other paths do not receive an exception. The extension never decodes `view-data`.

Use **Exact URL** in the popup, or paste a full link into an Exact URL rule in settings. Only the reviewed `view` survives sanitization. Screen-specific exact matches outrank path-only exact matches. Existing rules migrate to schema 4 without changing prior exact/view semantics or query-free patterns. Older extension versions refuse schema 4 and preserve it instead of overwriting it.

Synthetic full-extension tests intercept every request to the example Autotask host. They prove independent matching for all three views, query-only `pushState`/`replaceState`, settings full-link sanitization, legacy fallbacks, storage privacy and browser-restart persistence. They do not load the real Autotask application. Additional automatic exact-view values must be reviewed before adding them to the static map. This restriction does not apply to explicit user-defined patterns.

## Explicit query wildcard patterns

The reported `https://ww5.autotask.net/AutotaskOnyx/LandingPage?view=inventory-order*` is supported under **URL pattern** in 0.3.0. It matches `inventory-order`, `inventory-order-search`, and `inventory-order-details` without treating `inventory-receipts` as a match. `https://ww*.autotask.net/*?view=inventory-order*` additionally handles different numbered hosts.

Only the query filters the user enters are saved. `view-data`, tokens and other omitted parameters do not affect the match and are not copied into the rule. The worker reads the current tab URL transiently for matching; content messages and UI state retain their sanitized URLs. No base64 payload is decoded. Every explicitly filtered query key must occur exactly once; extra keys are ignored. Query-free patterns retain their old behavior.

The popup shows matching/nonmatching status, follows query-only navigation in the preview, and identifies an existing exact-rule priority conflict. Synthetic full-extension tests cover the reported pattern, worker query handling, settings, partial hostnames, multiple filters, navigation, privacy and browser restart. These tests intercept all requests to the fixture hosts and do not contact Autotask.

## On-demand diagnostic mode

Open TabMarker on the page, expand **Module diagnostics**, and select **Generate safe diagnostic summary**. Diagnostics are generated locally on demand and returned to the extension UI; they are not automatically logged, saved as rules, or sent to a server. **Copy safe diagnostic summary** is a deliberate user action.

The summary includes only:

- Whether the hostname is `autotask.net` or a subdomain, rather than the actual hostname.
- The HTTP/HTTPS protocol, up to 20 coarse path-segment categories (`text`, `number`, `uuid`, `opaque`), and whether a fragment exists.
- Presence of the reviewed query-key names `module`, `view`, `page`, and `action`, plus `other-keys-present` for every unreviewed name. No query values or unknown key names are returned.
- The matching scope and whether Chrome accepted native tab-menu registration.
- An approved module identifier and approved boolean presence signals only after reviewed adapters exist. These are currently `null` and an empty object.

It excludes raw URLs, hostname/path strings, credentials, query values, fragment text, page-authored titles, DOM text, form values, customer/account identifiers, authentication tokens and arbitrary discovered DOM attribute names. Path categories intentionally cannot reveal which literal routes identify modules. An ordinary website can produce the same categories as an Autotask page.

## Safe live validation workflow

1. Use an approved test account with non-customer sample records. Build/install the extension as described in [README.md](../README.md), then refresh the test application tabs.
2. Open representative modules that currently share a generic title/icon. Record human-readable module names such as “Ticket list” in your own test notes; do not include customer record names or identifiers.
3. Request the local diagnostic summary in each tab. Confirm that no sensitive values appear before copying anything. Compare coarse structure to identify where further manual route review is needed.
4. In the browser, inspect whether module identity is in a stable pathname, query key/value, fragment, top document, or iframe. Keep full production URLs, HAR files, cookies, and screenshots of real records out of issue reports.
5. Start with temporary overrides or broad non-sensitive patterns in the test profile. Check title/icon visibility, full navigation, SPA transitions, new-tab links, duplicate/reopened tabs, browser restart, removal/restoration, and restricted or withheld site access.
6. If a stable signature is found, review it explicitly before adding an adapter. Add representative synthetic fixtures and unit tests, then repeat live testing. Record Chrome version, deployment region, module name, sanitized expected behavior and observed behavior.

Do not add an adapter based only on a path category, a module title guessed from page text, a record ID, a customer name, or a token-bearing query string. Exact URL matching retains only the reviewed landing-page view values above. User-defined URL patterns can filter other query values explicitly; fragments remain ignored. Only automatic module adapters require a separately reviewed routing or DOM signature.

## Adapter contract

An adapter has a static approved `id` and one or both of:

- Reviewed pathname regular expressions that return only whether a match occurred. No captured URL values are reported.
- Reviewed DOM selectors with static signal IDs. Only element presence is tested; no DOM text, attribute value, or form value is returned.

Path alternatives use “any”; an adapter's required DOM signals use “all”. If multiple adapters match, module identification remains unresolved instead of choosing an arbitrary module. Query values and page contents are outside the initial adapter interface. Domain classification currently recognizes only `autotask.net` and dot-delimited subdomains; other deployment domains need verification.

## Questions requiring live application access

| Question | Why it matters |
| --- | --- |
| Which exact Autotask deployment domains and regions are in use? | Verify hostname classification and site access without guessing aliases. |
| Which initial modules need distinct labels/icons, and do they have stable pathnames? | Define useful, reviewable route adapters. |
| Are modules differentiated only by a query or fragment? Which routing keys/values are explicitly non-sensitive and stable? | The three reviewed values support exact matching; explicit query patterns support other keys/values. Hash matching is not implemented. |
| Does module identity live in the top document, same-origin iframe, or cross-origin iframe? | The MVP customizes and diagnoses the top document only. |
| Are there stable non-sensitive element IDs or `data-*` presence markers unique to each module? | Enable approved boolean DOM probes without reading customer content. |
| Do modules use full navigation, `pushState`, `replaceState`, popup windows, or links opening new tabs? | Verify reapplication and latency in actual workflows. |
| Does deployment CSP permit generated `data:image/svg+xml` favicon links? | Detect cases where title works but custom icon rendering is blocked. |
| How often does the application rewrite its title/icon, and does it replace `<head>`? | Exercise observer correction, performance, and faithful metadata restoration. |
| Are Autotask popup/child-window tabs normal scriptable HTTP(S) documents? | Verify toolbar/native commands and rule matching on every relevant surface. |
| Are enterprise Chrome policies, withheld site access, managed extensions, or alternative Chrome versions involved? | Establish permission and native tab-menu constraints in the target environment. |

No live Autotask access has been used to validate this release. Record any eventual live results separately from the local synthetic suite described in [validation.md](validation.md).
