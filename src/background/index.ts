import { findMatchingRule } from '../core/matching';
import { normalizeUrl, normalizeMatchingUrl, normalizeDomain, normalizePattern, patternMatches, urlForPattern } from '../core/normalization';
import { migrateState, normalizeRule, validateCustomization } from '../core/rules';
import { mergeBackup, parseBackup, serializeBackup } from '../core/backups';
import { backupOverview, disconnectFile, HISTORY_KEY, recordBeforeChange, recoverySnapshots, resetFileStatus, syncFile } from './backups';
import type { AppState, Customization, Diagnostics, Request, Response, Rule, StoredState, TabState } from '../shared/types';

const STATE_KEY = 'tabmarker.state';
const OVERRIDES_KEY = 'tabmarker.overrides';
const MENU_KEY = 'tabmarker.nativeTabMenu';
const EDIT_MENU = 'tabmarker.edit';
const OPTIONS_MENU = 'tabmarker.options';
type Overrides = Record<string, Customization>;

// Every read-modify-write goes through one queue; globals carry no durable state.
let queue: Promise<unknown> = Promise.resolve();
function serial<T>(operation: () => Promise<T>): Promise<T> {
  const result = queue.then(operation, operation);
  queue = result.catch(() => undefined);
  return result;
}
function safeError(error: unknown): string {
  return error instanceof Error ? error.message : 'TabMarker could not complete this operation.';
}
async function readState(): Promise<StoredState> {
  const raw = (await chrome.storage.local.get(STATE_KEY))[STATE_KEY];
  if (raw === undefined || raw === null) {
    const history = (await chrome.storage.local.get(HISTORY_KEY))[HISTORY_KEY];
    const backup = (await chrome.storage.local.get('tabmarker.backupStatus'))['tabmarker.backupStatus'];
    if (history !== undefined || backup !== undefined) throw new Error('Saved rules are missing. Restore a recovery copy or import a backup; existing backups have been preserved.');
  }
  const state = migrateState(raw);
  // Validate before writing. Future or malformed state must never be discarded.
  if (JSON.stringify(raw) !== JSON.stringify(state)) await chrome.storage.local.set({ [STATE_KEY]: state });
  return state;
}
async function readOverrides(): Promise<Overrides> {
  const raw: unknown = (await chrome.storage.session.get(OVERRIDES_KEY))[OVERRIDES_KEY];
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const safe: Overrides = {};
  for (const [id, value] of Object.entries(raw)) {
    if (!/^\d+$/.test(id)) continue;
    try { safe[id] = validateCustomization(value); } catch { /* Ignore corrupt temporary entries only. */ }
  }
  return safe;
}
function restrictedReason(url: string | undefined): string | null {
  if (!url || !normalizeUrl(url)) return 'Chrome protects this page. TabMarker supports ordinary HTTP and HTTPS pages only.';
  const parsed = new URL(url);
  if (parsed.hostname === 'chromewebstore.google.com' || (parsed.hostname === 'chrome.google.com' && parsed.pathname.startsWith('/webstore'))) {
    return 'Chrome does not allow extensions to customize the Chrome Web Store.';
  }
  return null;
}
async function targetTab(id?: number): Promise<chrome.tabs.Tab | undefined> {
  if (id !== undefined) {
    if (!Number.isInteger(id) || id < 0) throw new Error('Choose an existing browser tab.');
    try { return await chrome.tabs.get(id); } catch { throw new Error('This tab has closed. Open TabMarker from the tab you want to customize.'); }
  }
  return (await chrome.tabs.query({ active: true, currentWindow: true }))[0];
}
function select(state: StoredState, overrides: Overrides, tabId: number, url: string): { customization: Customization | null; rule: Rule | null; temporary: boolean } {
  const override = overrides[String(tabId)];
  if (override) return { customization: override, rule: null, temporary: true };
  const rule = findMatchingRule(state.rules, url);
  return { customization: rule ? { title: rule.title, icon: rule.icon } : null, rule, temporary: false };
}
async function getTabState(state: StoredState, overrides: Overrides, id?: number): Promise<TabState | null> {
  const tab = await targetTab(id);
  if (tab?.id === undefined) return null;
  const rawUrl = tab.url ?? tab.pendingUrl;
  let unsupportedReason = restrictedReason(rawUrl);
  if (!unsupportedReason) {
    try {
      const ping = await chrome.tabs.sendMessage(tab.id, { type: 'TM_PING' }, { frameId: 0 });
      if (!ping?.supported) throw new Error('Unsupported document.');
    } catch {
      unsupportedReason = 'TabMarker cannot access this page. Refresh it after installing, allow site access in Chrome, or check whether it is a protected PDF/viewer.';
    }
  }
  const url = normalizeMatchingUrl(rawUrl ?? '') ?? '';
  const selected = select(state, overrides, tab.id, rawUrl ?? '');
  return { id: tab.id, url, unsupportedReason, customization: selected.customization, matchedRuleId: selected.rule?.id ?? null, temporary: selected.temporary };
}
async function appState(tabId?: number): Promise<AppState> {
  const state = await readState();
  const overrides = await readOverrides();
  return {
    rules: state.rules,
    tab: await getTabState(state, overrides, tabId),
    nativeTabMenu: Boolean((await chrome.storage.session.get(MENU_KEY))[MENU_KEY]),
  };
}
async function applyTab(id: number, state?: StoredState, overrides?: Overrides): Promise<void> {
  try {
    const tab = await targetTab(id);
    const rawUrl = tab?.url ?? tab?.pendingUrl ?? '';
    const url = normalizeMatchingUrl(rawUrl);
    if (!url || restrictedReason(rawUrl)) return;
    // Raw query values are examined only in worker memory, never returned or stored.
    const selected = select(state ?? await readState(), overrides ?? await readOverrides(), id, rawUrl);
    await chrome.tabs.sendMessage(id, { type: 'TM_APPLY', customization: selected.customization, url }, { frameId: 0 });
  } catch { /* Closed, restricted, discarded, or pre-install tabs will apply at their next content-script load. */ }
}
async function reapplyAll(): Promise<void> {
  const state = await readState();
  const overrides = await readOverrides();
  const tabs = await chrome.tabs.query({});
  await Promise.all(tabs.filter(tab => tab.id !== undefined && tab.url && !restrictedReason(tab.url))
    .map(tab => applyTab(tab.id!, state, overrides)));
}
async function saveRules(rules: Rule[], explicitRestore = false): Promise<void> {
  let previous: StoredState;
  try { previous = await readState(); }
  catch (error) {
    if (!explicitRestore) throw error;
    // Only an explicitly confirmed restore may replace unreadable state. Keep
    // the original bytes/structure for recovery instead of silently resetting it.
    const raw = (await chrome.storage.local.get(STATE_KEY))[STATE_KEY];
    await chrome.storage.local.set({ [STATE_KEY]: { version: 4, rules } satisfies StoredState, 'tabmarker.preservedState': { createdAt: Date.now(), value: raw ?? null } });
    await reapplyAll();
    await syncFile({ version: 4, rules });
    return;
  }
  const next = { version: 4, rules } satisfies StoredState;
  if (JSON.stringify(previous) === JSON.stringify(next)) return;
  // Persist the previous state and new rules in one operation, before touching a linked file.
  await chrome.storage.local.set({ [STATE_KEY]: next, [HISTORY_KEY]: await recordBeforeChange(previous) });
  await reapplyAll();
  await syncFile(next);
}
async function editableTab(id: number): Promise<TabState> {
  const tab = (await appState(id)).tab;
  if (!tab) throw new Error('No browser tab was selected.');
  if (tab.unsupportedReason) throw new Error(tab.unsupportedReason);
  return tab;
}
async function handle(request: Request): Promise<unknown> {
  switch (request.type) {
    case 'GET_STATE': return appState(request.tabId);
    case 'GET_PATTERN_URL': {
      const tab = await targetTab(request.tabId);
      const rawUrl = tab?.url ?? tab?.pendingUrl;
      const reason = restrictedReason(rawUrl);
      if (reason) throw new Error(reason);
      const url = urlForPattern(rawUrl ?? '');
      if (!url || tab?.id === undefined) throw new Error('Choose a website tab to use its current URL.');
      // This trusted-editor response is not state, telemetry, diagnostics, or a saved rule.
      return { tabId: tab.id, url };
    }
    case 'GET_BACKUPS': {
      try { return await backupOverview(await readState()); }
      catch {
        return { file: { state: 'error', fileName: null, lastSyncedAt: null, message: 'Saved rules cannot be read. Restore a recovery copy or import a backup using Replace all my rules. The unreadable data will be preserved.' }, snapshots: (await recoverySnapshots()).map(item => ({ id: item.id, createdAt: item.createdAt, ruleCount: item.state.rules.length })) };
      }
    }
    case 'EXPORT_BACKUP': return serializeBackup(await readState(), chrome.runtime.getManifest().version);
    case 'SYNC_BACKUP': {
      const state = await readState();
      if (request.newConnection) await resetFileStatus();
      await syncFile(state, true);
      return backupOverview(state);
    }
    case 'DISCONNECT_BACKUP': {
      await disconnectFile();
      return backupOverview(await readState());
    }
    case 'IMPORT_BACKUP': {
      if (request.mode !== 'merge' && request.mode !== 'replace') throw new Error('Choose merge or replace before restoring rules.');
      const incoming = parseBackup(request.text);
      const rules = request.mode === 'replace' ? incoming.rules : mergeBackup((await readState()).rules, incoming.rules);
      await saveRules(rules, request.mode === 'replace');
      return appState();
    }
    case 'RESTORE_SNAPSHOT': {
      const snapshot = (await recoverySnapshots()).find(item => item.id === request.id);
      if (!snapshot) throw new Error('That recovery copy is no longer available.');
      await saveRules(snapshot.state.rules, true);
      return appState();
    }
    case 'PREVIEW_PATTERN': {
      const pattern = normalizePattern(request.pattern);
      const tab = await targetTab(request.tabId);
      const rawUrl = tab?.url ?? tab?.pendingUrl ?? '';
      const current = findMatchingRule((await readState()).rules, rawUrl);
      return {
        matches: patternMatches(pattern, rawUrl),
        normalizedPattern: pattern,
        exactRuleTakesPriority: current?.scope === 'exact',
      };
    }
    case 'SAVE_CUSTOMIZATION': {
      const tab = await editableTab(request.tabId);
      const customization = validateCustomization(request);
      if (request.scope === 'tab') {
        const overrides = await readOverrides();
        overrides[String(tab.id)] = customization;
        await chrome.storage.session.set({ [OVERRIDES_KEY]: overrides });
        await applyTab(tab.id);
      } else {
        if (!['exact', 'pattern', 'domain'].includes(request.scope)) throw new Error('Choose a supported rule scope.');
        const state = await readState();
        const match = request.match ?? (request.scope === 'domain' ? normalizeDomain(new URL(tab.url).hostname) : tab.url);
        const now = Date.now();
        const candidate = normalizeRule({ id: crypto.randomUUID(), enabled: true, ...customization, scope: request.scope, match, createdAt: now, updatedAt: now });
        const existing = state.rules.find(rule => rule.scope === candidate.scope && rule.match === candidate.match);
        // Saving an identical scope/target edits it; intentional conflicts in imported/edited rules use deterministic matching.
        const rule = existing ? normalizeRule({ ...candidate, id: existing.id, createdAt: existing.createdAt, updatedAt: Math.max(now, existing.createdAt, existing.updatedAt) }) : candidate;
        const overrides = await readOverrides();
        delete overrides[String(tab.id)];
        await chrome.storage.session.set({ [OVERRIDES_KEY]: overrides });
        await saveRules([...state.rules.filter(item => item.id !== rule.id), rule]);
      }
      return appState(tab.id);
    }
    case 'REMOVE_APPLIED': {
      const tab = await editableTab(request.tabId);
      if (tab.temporary) {
        const overrides = await readOverrides();
        delete overrides[String(tab.id)];
        await chrome.storage.session.set({ [OVERRIDES_KEY]: overrides });
        await applyTab(tab.id);
      } else if (tab.matchedRuleId) {
        const state = await readState();
        await saveRules(state.rules.filter(rule => rule.id !== tab.matchedRuleId));
      }
      return appState(tab.id);
    }
    case 'UPSERT_RULE': {
      const state = await readState();
      const rule = normalizeRule(request.rule);
      const existing = state.rules.find(item => item.id === rule.id);
      rule.createdAt = existing?.createdAt ?? Date.now();
      rule.updatedAt = Math.max(Date.now(), rule.createdAt, existing?.updatedAt ?? 0);
      await saveRules([...state.rules.filter(item => item.id !== rule.id), rule]);
      return appState();
    }
    case 'DELETE_RULE': {
      const state = await readState();
      await saveRules(state.rules.filter(rule => rule.id !== request.id));
      return appState();
    }
    case 'TOGGLE_RULE': {
      if (typeof request.enabled !== 'boolean') throw new Error('The rule enabled state is invalid.');
      const state = await readState();
      if (!state.rules.some(rule => rule.id === request.id)) throw new Error('That rule no longer exists.');
      await saveRules(state.rules.map(rule => rule.id === request.id ? { ...rule, enabled: request.enabled, updatedAt: Math.max(Date.now(), rule.createdAt, rule.updatedAt) } : rule));
      return appState();
    }
    case 'GET_DIAGNOSTICS': {
      const state = await appState(request.tabId);
      const tab = await editableTab(request.tabId);
      const safe = await chrome.tabs.sendMessage(tab.id, { type: 'TM_DIAGNOSTICS' }, { frameId: 0 }) as Omit<Diagnostics, 'matchingScope' | 'nativeTabMenu'>;
      // Content diagnostics are deliberately not written to storage or logs.
      const target = await targetTab(tab.id);
      const rawUrl = target?.url ?? target?.pendingUrl ?? '';
      const matchingRules: NonNullable<Diagnostics['matchingRules']> = [];
      let remaining = state.rules;
      let rule: Rule | null;
      while ((rule = findMatchingRule(remaining, rawUrl))) {
        matchingRules.push({ id: rule.id, scope: rule.scope, selected: !tab.temporary && rule.id === tab.matchedRuleId });
        remaining = remaining.filter(item => item.id !== rule!.id);
      }
      const applied = safe.application;
      const recommendation = applied && ((applied.titleRequested && !applied.titleApplied) || (applied.iconRequested && !applied.iconLinksApplied))
        ? 'The page metadata does not match the requested customization. Refresh the page and inspect again; the site may be rewriting it.'
        : tab.temporary ? 'A temporary tab override takes priority over all saved rules.'
        : matchingRules.length > 1 ? 'The first rule wins by scope, specificity and update time. Disable it to use the next match.'
        : matchingRules.length ? 'The matching rule is selected. If only the favicon looks wrong, check the page CSP or browser icon cache.'
        : 'No enabled rule matches. Use a URL pattern with ?view=… to distinguish additional Autotask screens.';
      return { ...safe, matchingRules, recommendation, extensionVersion: chrome.runtime.getManifest().version, matchingScope: tab.temporary ? 'tab' : state.rules.find(rule => rule.id === tab.matchedRuleId)?.scope ?? null, nativeTabMenu: state.nativeTabMenu } satisfies Diagnostics;
    }
    default: throw new Error('Unknown TabMarker command.');
  }
}

// Register listeners synchronously so Chrome can wake a suspended worker.
chrome.runtime.onMessage.addListener((message: unknown, sender, sendResponse) => {
  if (!message || typeof message !== 'object' || !('type' in message)) return false;
  const typed = message as Record<string, unknown>;
  if (typed.type === 'TM_READY') {
    if (sender.id !== chrome.runtime.id || sender.tab?.id === undefined || sender.frameId !== 0) return false;
    const url = typeof typed.url === 'string' ? normalizeMatchingUrl(typed.url) : null;
    if (!url) return false;
    void serial(async () => {
      const tab = await targetTab(sender.tab!.id!);
      const rawUrl = tab?.url ?? tab?.pendingUrl ?? '';
      const selected = select(await readState(), await readOverrides(), sender.tab!.id!, rawUrl);
      sendResponse({ ok: true, data: selected.customization });
    }).catch(error => sendResponse({ ok: false, error: safeError(error) }));
    return true;
  }
  // Content scripts cannot invoke management commands; only our own extension UI can.
  if (sender.id !== chrome.runtime.id || !sender.url?.startsWith(chrome.runtime.getURL(''))) return false;
  void serial(() => handle(message as Request))
    .then(data => sendResponse({ ok: true, data } satisfies Response<unknown>))
    .catch(error => sendResponse({ ok: false, error: safeError(error) } satisfies Response<unknown>));
  return true;
});
chrome.tabs.onRemoved.addListener(id => {
  void serial(async () => {
    const overrides = await readOverrides();
    delete overrides[String(id)];
    await chrome.storage.session.set({ [OVERRIDES_KEY]: overrides });
  }).catch(() => undefined);
});
chrome.tabs.onUpdated.addListener((id, change, tab) => {
  if ((change.status === 'complete' || change.url) && tab.url && !restrictedReason(tab.url)) {
    void serial(() => applyTab(id)).catch(() => undefined);
  }
});
// Handles explicit settings changes as well as another trusted extension view.
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && STATE_KEY in changes) void serial(reapplyAll).catch(() => undefined);
});
function createMenu(properties: chrome.contextMenus.CreateProperties): Promise<void> {
  return new Promise((resolve, reject) => {
    try {
      chrome.contextMenus.create(properties, () => {
        const error = chrome.runtime.lastError;
        if (error) reject(new Error(error.message)); else resolve();
      });
    } catch (error) { reject(error); }
  });
}
async function initialize(): Promise<void> {
  await chrome.storage.local.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' });
  await chrome.storage.session.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' });
  await chrome.contextMenus.removeAll();
  let native = false;
  try {
    // Older Chrome rejects this enum; both synchronous and callback errors are caught.
    await createMenu({ id: EDIT_MENU, title: 'Customize tab with TabMarker…', contexts: ['tab' as chrome.contextMenus.ContextType] });
    native = true;
  } catch {
    await createMenu({ id: EDIT_MENU, title: 'Customize this tab…', contexts: ['action'] });
  }
  await createMenu({ id: OPTIONS_MENU, title: 'Manage TabMarker rules…', contexts: ['action'] });
  await chrome.storage.session.set({ [MENU_KEY]: native });
  await readState();
  await syncFile(await readState());
}
chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === OPTIONS_MENU) { void chrome.runtime.openOptionsPage(); return; }
  if (info.menuItemId === EDIT_MENU && tab?.id !== undefined) {
    // An explicit editor window preserves the context-clicked tab even when it is inactive.
    void chrome.windows.create({ url: chrome.runtime.getURL(`popup.html?tabId=${tab.id}`), type: 'popup', width: 420, height: 610 });
  }
});
chrome.runtime.onInstalled.addListener(() => { void serial(async () => { await initialize(); await reapplyAll(); }).catch(() => undefined); });
chrome.runtime.onStartup.addListener(() => { void serial(async () => { await initialize(); await reapplyAll(); }).catch(() => undefined); });
void serial(initialize).catch(() => undefined);
