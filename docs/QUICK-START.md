# TabMarker quick start

## Give a tab a name and color

1. Open the website you want to label. Refresh it if TabMarker was just installed or reloaded.
2. Click **TabMarker** in Chrome's toolbar.
3. Enter a title, choose a colored icon, or set both.
4. Choose where the customization applies, then click **Save**.

New customizations default to **Exact URL**. An existing rule keeps its matching option.

## Choose the matching option

| Option | Use it when | What it covers |
| --- | --- | --- |
| **This tab only** | You need a temporary label for one open tab. | That tab, including supported navigation; ends when it closes, the extension reloads or the browser fully exits. |
| **Exact URL** | You want a saved label for one page. | The normalized protocol, hostname, port and path. General query parameters and fragments are ignored; reviewed Autotask views have the special behavior below. |
| **URL pattern** | Several related pages should share a label, or a query value identifies the screen. | An HTTP(S) URL pattern with `*` wildcards and optional query-value filters. |
| **Domain** | Most pages on a site should share a label. | That hostname and its subdomains, across paths and ports on HTTP(S). |

For patterns, start with the current URL and replace the changing part with `*`, for example `https://example.com/projects/*`. TabMarker does not append a wildcard automatically. **Use current URL** explicitly replaces the pattern draft with the selected website tab's latest URL. Settings opened independently lets you choose a **Website tab**. Existing patterns and manual edits are preserved when changing matching options.

Check the live match preview before saving. Temporary labels win over saved rules; saved **Exact URL** rules win over patterns, which win over domain rules. A broader rule may appear after you delete or disable a more specific rule.

Patterns can retain query values copied from the current URL. Remove private values, tokens or unwanted filters before saving. Fragments and credentials are excluded from the prefilled pattern. See the [matching reference](../README.md#customizing-tabs) for full wildcard and normalization behavior.

## Autotask screens

Exact URL recognizes the reviewed Quote search, Generate invoices and Payment processing screens on Autotask's shared landing page. Other screens can use an explicit URL pattern such as `https://ww*.autotask.net/AutotaskOnyx/LandingPage?view=inventory-order*`. Additional automatic screen recognition requires separate validation.

## Change or remove saved labels

Open **Manage rules** to find, edit, disable or delete rules. If the old title/icon remains after the extension is disabled or reloaded, refresh the website tab.

## Keep a backup

In **Manage rules → Backups**, use **Download backup** for a portable JSON copy. **Choose backup file** connects one file that TabMarker can update after saved rule changes while Chrome grants access. Choose a private location outside the extension folder.

This is a one-way backup of saved rules, not device-folder access or two-way synchronization. Chrome may ask for file permission again after a restart. Check the backup status and last successful sync. If another program changes the file, automatic writes pause; keep a copy before using **Sync now** to replace it. Temporary tab-only labels are excluded.

**Import backup** offers merge or replace with confirmation. Recent recovery copies live inside Chrome and are removed with the extension/profile; they do not replace an external backup.

## Update TabMarker

With a connected Windows helper:

1. Open **Manage rules → Updates → Check for updates**.
2. Save or cancel any unfinished rule edits, then click **Install v…**.
3. When installation finishes, click **Update installed — Reload TabMarker**.
4. Check the version at the bottom, then refresh your website tabs.

Saved rules remain; temporary labels reset on reload. The footer shows the version Chrome has loaded, which may differ from newly installed files until reload.

The [helper setup](HELPER-UPDATES.md) is a separate, one-time user-run installation. Its current unsigned script can be blocked by Windows policy; see [signing and distribution](SIGNING-AND-DISTRIBUTION.md). The [manual/RMM method](RMM-DEPLOYMENT.md) remains available through the normal approved execution process.
