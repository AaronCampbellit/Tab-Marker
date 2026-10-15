import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppState, BackupOverview, Request, Response, Rule } from '../../src/shared/types';

const STATE_KEY = 'tabmarker.state';
const OVERRIDES_KEY = 'tabmarker.overrides';
const EXTENSION_ID = 'tabmarker-test-extension';
const PAGE_URL = 'https://example.com/Module';
type MessageListener = (message: unknown, sender: chrome.runtime.MessageSender, reply: (response: unknown) => void) => boolean | void;
type StorageListener = (changes: Record<string, chrome.storage.StorageChange>, area: string) => void;

function mockEvent<T>() {
  const listeners: T[] = [];
  return { listeners, addListener: (listener: T) => listeners.push(listener), clear: () => { listeners.length = 0; } };
}

function createChromeMock() {
  const local: Record<string, unknown> = {};
  const session: Record<string, unknown> = {};
  const onMessage = mockEvent<MessageListener>();
  const onChanged = mockEvent<StorageListener>();
  const onRemoved = mockEvent<(id: number) => void>();
  const onUpdated = mockEvent<() => void>();
  const onInstalled = mockEvent<() => void>();
  const onStartup = mockEvent<() => void>();
  const onClicked = mockEvent<() => void>();
  function storageArea(data: Record<string, unknown>, name: 'local' | 'session') {
    return {
      get: vi.fn(async (key: string) => {
        await Promise.resolve();
        return key in data ? { [key]: structuredClone(data[key]) } : {};
      }),
      set: vi.fn(async (values: Record<string, unknown>) => {
        await Promise.resolve();
        const changes: Record<string, chrome.storage.StorageChange> = {};
        for (const [key, value] of Object.entries(values)) {
          if (JSON.stringify(data[key]) === JSON.stringify(value)) continue;
          changes[key] = { oldValue: structuredClone(data[key]), newValue: structuredClone(value) };
          data[key] = structuredClone(value);
        }
        if (Object.keys(changes).length) for (const listener of onChanged.listeners) listener(changes, name);
      }),
      setAccessLevel: vi.fn(async () => undefined),
    };
  }
  const tab = { id: 7, url: PAGE_URL, active: true, windowId: 1 };
  const api = {
    runtime: {
      id: EXTENSION_ID,
      getURL: (path: string) => `chrome-extension://${EXTENSION_ID}/${path}`,
      getManifest: () => ({ version: '0.4.0' }),
      onMessage,
      onInstalled,
      onStartup,
      openOptionsPage: vi.fn(async () => undefined),
    },
    storage: { local: storageArea(local, 'local'), session: storageArea(session, 'session'), onChanged },
    tabs: {
      get: vi.fn(async (id: number) => {
        if (id !== tab.id) throw new Error('No tab with that id.');
        return { ...tab };
      }),
      query: vi.fn(async () => [{ ...tab }]),
      sendMessage: vi.fn(async (_id: number, message: { type: string }) => message.type === 'TM_PING' ? { supported: true } : { ok: true }),
      onRemoved,
      onUpdated,
    },
    contextMenus: {
      removeAll: vi.fn(async () => undefined),
      create: vi.fn((properties: chrome.contextMenus.CreateProperties, callback: () => void) => {
        if (properties.contexts?.includes('tab')) throw new Error('Unsupported tab context in this mock browser.');
        callback();
        return properties.id;
      }),
      onClicked,
    },
    windows: { create: vi.fn(async () => undefined) },
  };
  const uiSender: chrome.runtime.MessageSender = { id: EXTENSION_ID, url: api.runtime.getURL('options.html') };
  async function send<T = AppState>(message: Request | { type: 'TM_READY'; url: string }, sender = uiSender): Promise<Response<T> | undefined> {
    const listener = onMessage.listeners[0];
    if (!listener) throw new Error('Background message listener was not registered synchronously.');
    return new Promise(resolve => {
      const keepOpen = listener(message, sender, response => resolve(response as Response<T>));
      if (!keepOpen) resolve(undefined);
    });
  }
  async function request<T = AppState>(message: Request): Promise<T> {
    const response = await send<T>(message);
    if (!response?.ok) throw new Error(response?.error ?? 'Message was rejected.');
    return response.data;
  }
  async function load() {
    await import('../../src/background/index');
    // Real worker operations serialize behind initialization and storage events.
    await request({ type: 'GET_STATE', tabId: tab.id });
    await request({ type: 'GET_STATE', tabId: tab.id });
  }
  async function restartModule() {
    await request({ type: 'GET_STATE', tabId: tab.id });
    for (const event of [onMessage, onChanged, onRemoved, onUpdated, onInstalled, onStartup, onClicked]) event.clear();
    vi.resetModules();
    await load();
  }
  return { api, local, session, tab, send, request, load, restartModule };
}

function rule(id: string, match = PAGE_URL): Rule {
  return { id, enabled: true, scope: 'exact', match, title: id, icon: null, createdAt: 1, updatedAt: 1 };
}

describe('real background module with mocked Chrome API boundaries', () => {
  let browser: ReturnType<typeof createChromeMock>;
  beforeEach(() => {
    vi.resetModules();
    browser = createChromeMock();
    vi.stubGlobal('chrome', browser.api);
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('serializes simultaneous rule writes without losing rules', async () => {
    await browser.load();
    await Promise.all(Array.from({ length: 12 }, (_, index) => browser.request({
      type: 'UPSERT_RULE', rule: rule(`rule-${index}`, `https://example.com/module/${index}`),
    })));
    const result = await browser.request({ type: 'GET_STATE', tabId: browser.tab.id });
    expect(result.rules.map(item => item.id).sort()).toEqual(Array.from({ length: 12 }, (_, index) => `rule-${index}`).sort());
    expect(browser.local[STATE_KEY]).toEqual({ version: 4, rules: result.rules });
    expect(browser.api.storage.local.setAccessLevel).toHaveBeenCalledWith({ accessLevel: 'TRUSTED_CONTEXTS' });
    expect(result.nativeTabMenu).toBe(false);
  });

  it('migrates known state but rejects a future schema without overwriting it', async () => {
    browser.local[STATE_KEY] = { version: 1, rules: [{ ...rule('legacy'), icon: { color: '#123456', letter: 'L' } }] };
    await browser.load();
    const migrated = await browser.request({ type: 'GET_STATE', tabId: browser.tab.id });
    expect(migrated.rules[0].icon).toEqual({ color: '#123456', glyph: 'L' });
    expect(browser.local[STATE_KEY]).toEqual({ version: 4, rules: migrated.rules });
    const future = { version: 9, rules: [{ futureData: 'preserve me' }] };
    browser.local[STATE_KEY] = structuredClone(future);
    const rejected = await browser.send({ type: 'UPSERT_RULE', rule: rule('new') });
    expect(rejected).toEqual({ ok: false, error: expect.stringContaining('unsupported schema version') });
    expect(browser.local[STATE_KEY]).toEqual(future);
  });

  it('recovers persistent rules and temporary session overrides after a module reload', async () => {
    await browser.load();
    await browser.request({ type: 'SAVE_CUSTOMIZATION', tabId: browser.tab.id, scope: 'exact', title: 'Persistent', icon: null });
    await browser.request({ type: 'SAVE_CUSTOMIZATION', tabId: browser.tab.id, scope: 'tab', title: 'Temporary', icon: { color: '#123456', glyph: 'T' } });
    const savedLocal = structuredClone(browser.local[STATE_KEY]);
    const savedOverrides = structuredClone(browser.session[OVERRIDES_KEY]);
    await browser.restartModule();
    const result = await browser.request({ type: 'GET_STATE', tabId: browser.tab.id });
    expect(result.tab).toMatchObject({ temporary: true, matchedRuleId: null, customization: { title: 'Temporary' } });
    expect(browser.local[STATE_KEY]).toEqual(savedLocal);
    expect(browser.session[OVERRIDES_KEY]).toEqual(savedOverrides);
    const removed = await browser.request({ type: 'REMOVE_APPLIED', tabId: browser.tab.id });
    expect(removed.tab).toMatchObject({ temporary: false, customization: { title: 'Persistent' } });
  });

  it('rejects management commands from content pages and other extensions', async () => {
    await browser.load();
    const contentSender: chrome.runtime.MessageSender = { id: EXTENSION_ID, url: PAGE_URL, tab: browser.tab as chrome.tabs.Tab, frameId: 0 };
    expect(await browser.send({ type: 'UPSERT_RULE', rule: rule('unauthorized') }, contentSender)).toBeUndefined();
    expect(await browser.send({ type: 'DELETE_RULE', id: 'anything' }, { id: 'another-extension', url: browser.api.runtime.getURL('options.html') })).toBeUndefined();
    expect(await browser.send({ type: 'TM_READY', url: PAGE_URL }, { ...contentSender, frameId: 1 })).toBeUndefined();
    expect(await browser.send({ type: 'TM_READY', url: PAGE_URL }, contentSender)).toEqual({ ok: true, data: null });
    expect((await browser.request({ type: 'GET_STATE', tabId: browser.tab.id })).rules).toEqual([]);
  });

  it('keeps stored timestamps valid and monotonic when the system clock moves backward', async () => {
    const futureRule = { ...rule('clock-safe'), createdAt: 1000, updatedAt: 2000 };
    browser.local[STATE_KEY] = { version: 2, rules: [futureRule] };
    vi.spyOn(Date, 'now').mockReturnValue(100);
    await browser.load();
    const operations: Request[] = [
      { type: 'UPSERT_RULE', rule: { ...futureRule, title: 'Edited' } },
      { type: 'TOGGLE_RULE', id: futureRule.id, enabled: false },
      { type: 'SAVE_CUSTOMIZATION', tabId: browser.tab.id, scope: 'exact', title: 'Saved again', icon: null },
    ];
    for (const operation of operations) {
      await browser.request(operation);
      const stored = await browser.request({ type: 'GET_STATE', tabId: browser.tab.id });
      expect(stored.rules).toHaveLength(1);
      expect(stored.rules[0]).toMatchObject({ id: futureRule.id, createdAt: 1000, updatedAt: 2000 });
    }
  });

  it('previews and applies query filters without returning or storing unrelated query values', async () => {
    const landing = 'https://ww5.autotask.net/AutotaskOnyx/LandingPage';
    browser.tab.url = `${landing}?view=inventory-order-grid&view-data=PRIVATE_ENCODED&token=PRIVATE_TOKEN`;
    await browser.load();
    const pattern = `${landing}?view=inventory-order*`;
    const preview = await browser.request({ type: 'PREVIEW_PATTERN', tabId: browser.tab.id, pattern });
    expect(preview).toEqual({ matches: true, normalizedPattern: pattern, exactRuleTakesPriority: false });
    await browser.request({ type: 'SAVE_CUSTOMIZATION', tabId: browser.tab.id, scope: 'pattern', match: pattern, title: 'Inventory', icon: null });
    const state = await browser.request({ type: 'GET_STATE', tabId: browser.tab.id });
    expect(state.tab).toMatchObject({ url: landing, customization: { title: 'Inventory' } });
    expect(state.rules[0].match).toBe(pattern);
    const contentSender = { id: EXTENSION_ID, url: browser.tab.url, tab: browser.tab as chrome.tabs.Tab, frameId: 0 };
    expect(await browser.send({ type: 'TM_READY', url: landing }, contentSender)).toEqual({ ok: true, data: { title: 'Inventory', icon: null } });
    expect(await browser.send({ type: 'PREVIEW_PATTERN', tabId: browser.tab.id, pattern }, contentSender)).toBeUndefined();
    expect(JSON.stringify([state, preview, browser.local, browser.session, browser.api.tabs.sendMessage.mock.calls]))
      .not.toMatch(/PRIVATE_|view-data|token=/);
    browser.tab.url = `${landing}?view=quote-search&view-data=PRIVATE_CHANGED`;
    expect((await browser.request({ type: 'GET_STATE', tabId: browser.tab.id })).tab?.customization).toBeNull();
    expect(await browser.request({ type: 'PREVIEW_PATTERN', tabId: browser.tab.id, pattern }))
      .toMatchObject({ matches: false });
  });

  it('reports an exact-rule priority conflict in pattern previews', async () => {
    await browser.load();
    await browser.request({ type: 'UPSERT_RULE', rule: rule('exact') });
    expect(await browser.request({ type: 'PREVIEW_PATTERN', tabId: browser.tab.id, pattern: 'https://example.com/*' }))
      .toMatchObject({ matches: true, exactRuleTakesPriority: true });
  });

  it('exports validated rules and restores deleted rules after a worker restart', async () => {
    await browser.load();
    await browser.request({ type: 'UPSERT_RULE', rule: rule('recover-me') });
    const text = await browser.request<string>({ type: 'EXPORT_BACKUP' });
    expect(JSON.parse(text).state.rules[0].id).toBe('recover-me');
    await browser.request({ type: 'DELETE_RULE', id: 'recover-me' });
    await browser.restartModule();
    const backups = await browser.request<BackupOverview>({ type: 'GET_BACKUPS' });
    const beforeDeletion = backups.snapshots.find(item => item.ruleCount === 1)!;
    expect(beforeDeletion).toBeTruthy();
    expect((await browser.request({ type: 'RESTORE_SNAPSHOT', id: beforeDeletion.id })).rules[0].id).toBe('recover-me');
    await browser.request({ type: 'IMPORT_BACKUP', text, mode: 'replace' });
    expect((await browser.request({ type: 'GET_STATE' })).rules).toHaveLength(1);
  });

  it('rejects invalid imports atomically, including a single bad rule and invalid mode', async () => {
    await browser.load();
    await browser.request({ type: 'UPSERT_RULE', rule: rule('existing') });
    const before = structuredClone(browser.local);
    const bad = JSON.stringify({ format: 'tabmarker-backup', version: 1, state: { version: 4, rules: [rule('valid'), { ...rule('bad'), enabled: 'yes' }] } });
    for (const text of ['not json', bad]) {
      await expect(browser.request({ type: 'IMPORT_BACKUP', text, mode: 'replace' })).rejects.toThrow();
      expect(browser.local).toEqual(before);
    }
    await expect(browser.request({ type: 'IMPORT_BACKUP', text: '{}', mode: 'invalid' } as unknown as Request)).rejects.toThrow('Choose merge or replace');
    await expect(browser.request({ type: 'RESTORE_SNAPSHOT', id: 'missing' })).rejects.toThrow('no longer available');
    expect(browser.local).toEqual(before);
  });

  it('preserves current rules and recovery history if a storage write fails', async () => {
    await browser.load();
    await browser.request({ type: 'UPSERT_RULE', rule: rule('existing') });
    const before = structuredClone(browser.local);
    browser.api.storage.local.set.mockRejectedValueOnce(new Error('Storage quota exceeded.'));
    await expect(browser.request({ type: 'DELETE_RULE', id: 'existing' })).rejects.toThrow('quota');
    expect(browser.local).toEqual(before);
  });

  it('allows explicit recovery from damaged state while preserving the unreadable original', async () => {
    await browser.load();
    await browser.request({ type: 'UPSERT_RULE', rule: rule('recoverable') });
    const backup = await browser.request<string>({ type: 'EXPORT_BACKUP' });
    const damaged = { version: 4, rules: [{ id: 'damaged', title: null }] };
    browser.local[STATE_KEY] = damaged;
    await expect(browser.request({ type: 'GET_STATE' })).rejects.toThrow();
    const overview = await browser.request<BackupOverview>({ type: 'GET_BACKUPS' });
    expect(overview.file.message).toContain('Saved rules cannot be read');
    expect(overview.snapshots.length).toBeGreaterThan(0);
    await browser.request({ type: 'IMPORT_BACKUP', text: backup, mode: 'replace' });
    expect((await browser.request({ type: 'GET_STATE' })).rules[0].id).toBe('recoverable');
    expect(browser.local['tabmarker.preservedState']).toEqual({ createdAt: expect.any(Number), value: damaged });
  });

  it('does not turn a missing state key into an empty state when recovery data already exists', async () => {
    await browser.load();
    await browser.request({ type: 'UPSERT_RULE', rule: rule('missing-state') });
    const backup = await browser.request<string>({ type: 'EXPORT_BACKUP' });
    delete browser.local[STATE_KEY];
    await expect(browser.request({ type: 'GET_STATE' })).rejects.toThrow('Saved rules are missing');
    await expect(browser.request({ type: 'SYNC_BACKUP' })).rejects.toThrow('Saved rules are missing');
    expect(browser.local[STATE_KEY]).toBeUndefined();
    await browser.request({ type: 'IMPORT_BACKUP', text: backup, mode: 'replace' });
    expect((await browser.request({ type: 'GET_STATE' })).rules[0].id).toBe('missing-state');
  });
});
