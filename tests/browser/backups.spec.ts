import { readFile } from 'node:fs/promises';
import { test, expect } from './fixture';
import type { BackupOverview, Diagnostics, Rule } from '../../src/shared/types';

function rule(id: string, match: string, title = id): Rule {
  return { id, enabled: true, scope: 'exact', match, title, icon: { color: '#c62828', glyph: 'R' }, createdAt: 1, updatedAt: 1 };
}

test('downloaded backup imports transactionally, survives restart, and recovers deletion', async ({ extension }) => {
  const site = await extension.open();
  await extension.request({ type: 'UPSERT_RULE', rule: rule('saved', site.url(), 'Saved rules') });
  await expect(site).toHaveTitle('Saved rules');
  const options = extension.bridge;
  const download = options.waitForEvent('download');
  await options.getByRole('button', { name: 'Download backup', exact: true }).click();
  const file = await download;
  const text = await readFile((await file.path())!, 'utf8');
  expect(JSON.parse(text).state.rules).toHaveLength(1);
  await extension.request({ type: 'DELETE_RULE', id: 'saved' });
  await expect(site).toHaveTitle('Original · Alpha');
  await options.getByLabel('Import backup', { exact: true }).setInputFiles({ name: 'invalid.json', mimeType: 'application/json', buffer: Buffer.from('{invalid') });
  await expect(options.getByRole('alert')).toContainText('not valid JSON');
  expect((await extension.request({ type: 'GET_STATE' })).rules).toHaveLength(0);
  await options.getByLabel('Import backup', { exact: true }).setInputFiles({ name: 'backup.json', mimeType: 'application/json', buffer: Buffer.from(text) });
  await expect(options.getByText('Ready to import 1 rule', { exact: true })).toBeVisible();
  expect((await extension.request({ type: 'GET_STATE' })).rules).toHaveLength(0);
  await options.getByRole('button', { name: 'Confirm import', exact: true }).click();
  await expect(site).toHaveTitle('Saved rules');
  await extension.request({ type: 'DELETE_RULE', id: 'saved' });
  await extension.restart();
  const backups = await extension.request<BackupOverview>({ type: 'GET_BACKUPS' });
  const savedCopy = backups.snapshots.find(copy => copy.ruleCount === 1)!;
  expect(savedCopy).toBeTruthy();
  await extension.bridge.getByText(/Recent recovery copies/).click();
  await extension.bridge.getByLabel('Recovery copy', { exact: true }).selectOption(savedCopy.id);
  await extension.bridge.getByRole('button', { name: 'Confirm restore recovery copy', exact: true }).click();
  await expect.poll(async () => (await extension.request({ type: 'GET_STATE' })).rules.length).toBe(1);
  const reopened = await extension.open();
  await expect(reopened).toHaveTitle('Saved rules');
});

test('a real browser file handle persists across restart and worker writes track saved-rule changes', async ({ extension }) => {
  // The picker is the sole stub: use a real OPFS handle to exercise IndexedDB,
  // permission checks, worker writes and persistence without a native OS dialog in CI.
  await extension.bridge.evaluate(async () => {
    const handle = await (await navigator.storage.getDirectory()).getFileHandle('test-backup.json', { create: true });
    Object.defineProperty(window, 'showSaveFilePicker', { configurable: true, value: async () => handle });
  });
  await extension.bridge.getByRole('button', { name: 'Choose backup file', exact: true }).click();
  await expect.poll(async () => (await extension.request<BackupOverview>({ type: 'GET_BACKUPS' })).file.state).toBe('synced');
  const site = await extension.open();
  await extension.request({ type: 'UPSERT_RULE', rule: rule('file-copy', site.url()) });
  async function fileRules() {
    return extension.bridge.evaluate(async () => JSON.parse(await (await (await (await navigator.storage.getDirectory()).getFileHandle('test-backup.json')).getFile()).text()).state.rules);
  }
  expect(await fileRules()).toHaveLength(1);
  await extension.restart();
  expect((await extension.request<BackupOverview>({ type: 'GET_BACKUPS' })).file.state).toBe('synced');
  await extension.request({ type: 'DELETE_RULE', id: 'file-copy' });
  expect(await fileRules()).toHaveLength(0);
  await extension.request({ type: 'DISCONNECT_BACKUP' });
  await extension.request({ type: 'UPSERT_RULE', rule: rule('not-backed-up', extension.baseURL + '/module/alpha') });
  expect(await fileRules()).toHaveLength(0);
  expect((await extension.request<BackupOverview>({ type: 'GET_BACKUPS' })).file.state).toBe('off');
});

test('compact popup fits at toolbar size after a pattern save and reports actionable diagnostics', async ({ extension }) => {
  const site = await extension.open();
  const tabId = await extension.tabId(site);
  await extension.request({ type: 'UPSERT_RULE', rule: { ...rule('fallback', new URL(site.url()).hostname), scope: 'domain' } });
  const popup = await extension.popup(tabId);
  await popup.setViewportSize({ width: 390, height: 600 });
  await popup.getByLabel('Tab title', { exact: true }).fill('Compact pattern');
  await popup.getByLabel('Rule scope', { exact: true }).selectOption('pattern');
  await popup.getByLabel('URL pattern', { exact: true }).fill(extension.baseURL + '/module/*');
  await popup.getByRole('button', { name: 'Save customization', exact: true }).click();
  await expect(site).toHaveTitle('Compact pattern');
  await expect(popup.getByText('Rule saved.', { exact: true })).toBeVisible();
  const metrics = await popup.evaluate(() => ({
    width: innerWidth, height: innerHeight, scrollHeight: document.documentElement.scrollHeight,
    scrollWidth: document.documentElement.scrollWidth,
    mainHeight: document.querySelector('main')!.getBoundingClientRect().height,
    color: getComputedStyle(document.querySelector('button[type="submit"]')!).backgroundColor,
  }));
  expect(metrics.mainHeight).toBeLessThanOrEqual(metrics.height);
  expect(metrics.scrollHeight).toBe(metrics.height);
  expect(metrics.scrollWidth).toBe(metrics.width);
  expect(metrics.color).toBe('rgb(198, 40, 40)');
  const report = await extension.request<Diagnostics>({ type: 'GET_DIAGNOSTICS', tabId });
  expect(report.application).toEqual({ titleRequested: true, titleApplied: true, iconRequested: true, iconLinksApplied: true });
  expect(report.matchingRules?.map(rule => [rule.scope, rule.selected])).toEqual([['pattern', true], ['domain', false]]);
  expect(report.recommendation).toContain('first rule wins');
  const options = extension.bridge;
  await options.goto(`chrome-extension://${extension.extensionId}/options.html?tabId=${tabId}#diagnostics`);
  await options.getByRole('button', { name: 'Inspect tab', exact: true }).click();
  const results = options.getByLabel('Diagnostic results', { exact: true });
  await expect(results.getByText('Connected', { exact: true })).toBeVisible();
  await expect(results.getByText('Applied', { exact: true })).toBeVisible();
  await expect(results.getByText('Applied to page', { exact: true })).toBeVisible();
  await expect(results.getByText('Active', { exact: true })).toBeVisible();
});
