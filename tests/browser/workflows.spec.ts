import type { Page } from '@playwright/test';
import type { AppState, Diagnostics, Rule } from '../../src/shared/types';
import { test, expect, type ExtensionHarness } from './fixture';

async function customIcon(page: Page): Promise<string> {
  return page.evaluate(() => [...document.querySelectorAll<HTMLLinkElement>('link[rel~="icon"]')]
    .map((link) => link.href).find((href) => href.startsWith('data:image/svg+xml')) ?? '');
}

function rule(id: string, scope: Rule['scope'], match: string, title: string): Rule {
  return { id, scope, match, title, icon: null, enabled: true, createdAt: 1, updatedAt: 1 };
}

async function apply(extension: ExtensionHarness, page: Page, title: string, scope: 'tab' | 'exact' | 'domain' = 'exact'): Promise<number> {
  const tabId = await extension.tabId(page);
  await extension.request({ type: 'SAVE_CUSTOMIZATION', tabId, scope, title, icon: { color: '#7c3aed', glyph: 'A' } });
  await expect(page).toHaveTitle(title);
  return tabId;
}

test('popup saves a title and colored SVG favicon, then restores original metadata', async ({ extension }) => {
  const page = await extension.open();
  const tabId = await extension.tabId(page);
  const popup = await extension.popup(tabId);
  await popup.getByLabel('Tab title', { exact: true }).fill('Service desk');
  await popup.getByLabel('Icon color', { exact: true }).fill('#dc2626');
  await popup.getByLabel('Icon symbol', { exact: true }).fill('7');
  await popup.getByLabel('Rule scope', { exact: true }).selectOption('exact');
  await popup.getByRole('button', { name: 'Save customization', exact: true }).click();
  await expect(page).toHaveTitle('Service desk');
  await expect.poll(() => customIcon(page)).toContain('data:image/svg+xml');
  const svg = decodeURIComponent((await customIcon(page)).split(',')[1]);
  expect(svg).toContain('#dc2626');
  expect(svg).toContain('7');
  const iconURL = await customIcon(page);
  await expect.poll(() => extension.bridge.evaluate(async (id) => (await chrome.tabs.get(id)).favIconUrl, tabId))
    .toBe(iconURL);
  const image = await page.evaluate(async (source) => {
    const icon = new Image();
    icon.src = source;
    await icon.decode();
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 64;
    const drawing = canvas.getContext('2d')!;
    drawing.drawImage(icon, 0, 0);
    return { width: icon.naturalWidth, height: icon.naturalHeight, pixel: [...drawing.getImageData(32, 6, 1, 1).data] };
  }, iconURL);
  expect(image).toEqual({ width: 64, height: 64, pixel: [220, 38, 38, 255] });
  await popup.getByRole('button', { name: 'Remove applied customization', exact: true }).click();
  await expect(page).toHaveTitle('Original · Alpha');
  await expect.poll(() => customIcon(page)).toBe('');
  await expect(page.locator('link[rel="icon"]')).toHaveAttribute('href', '/original.svg');
});

test('persistent rules reopen across a complete browser restart and never store query or fragment data', async ({ extension }) => {
  const privateURL = '/module/alpha?token=PRIVATE_QUERY_SENTINEL&customer=PRIVATE_CUSTOMER_SENTINEL#PRIVATE_FRAGMENT_SENTINEL';
  const page = await extension.open(privateURL);
  const tabId = await apply(extension, page, 'My module');
  const state = await extension.request({ type: 'GET_STATE', tabId });
  expect(state.tab?.url).toBe(`${extension.baseURL}/module/alpha`);
  expect(state.rules[0].match).toBe(`${extension.baseURL}/module/alpha`);
  const storage = await extension.bridge.evaluate(() => chrome.storage.local.get(null));
  expect(JSON.stringify(storage)).not.toMatch(/PRIVATE_|token=|customer=|Original · Alpha/);
  await page.close();
  const reopened = await extension.open('/module/alpha?different=another-value');
  await expect(reopened).toHaveTitle('My module');
  await expect.poll(() => customIcon(reopened)).toContain('data:image/svg+xml');
  await extension.restart();
  const restarted = await extension.open('/module/alpha');
  await expect(restarted).toHaveTitle('My module');
  await expect.poll(() => customIcon(restarted)).toContain('data:image/svg+xml');
});

test('exact, pattern, and domain rules have deterministic priority; disabling and deleting reveal fallbacks', async ({ extension }) => {
  const page = await extension.open();
  const tabId = await extension.tabId(page);
  const host = new URL(extension.baseURL).hostname;
  await extension.request({ type: 'UPSERT_RULE', rule: rule('domain', 'domain', host, 'Domain') });
  await expect(page).toHaveTitle('Domain');
  await extension.request({ type: 'UPSERT_RULE', rule: rule('pattern', 'pattern', `${extension.baseURL}/module/*`, 'Pattern') });
  await expect(page).toHaveTitle('Pattern');
  await extension.request({ type: 'UPSERT_RULE', rule: rule('exact', 'exact', `${extension.baseURL}/module/alpha`, 'Exact') });
  await expect(page).toHaveTitle('Exact');
  await extension.request({ type: 'TOGGLE_RULE', id: 'exact', enabled: false });
  await expect(page).toHaveTitle('Pattern');
  await extension.request({ type: 'DELETE_RULE', id: 'pattern' });
  await expect(page).toHaveTitle('Domain');
  await extension.request({ type: 'REMOVE_APPLIED', tabId });
  await expect(page).toHaveTitle('Original · Alpha');
  await expect.poll(() => customIcon(page)).toBe('');
});

test('SPA pushState chooses the new matching rule and ordinary navigation reapplies rules', async ({ extension }) => {
  const page = await extension.open();
  await extension.request({ type: 'UPSERT_RULE', rule: rule('alpha', 'exact', `${extension.baseURL}/module/alpha`, 'Alpha workspace') });
  await extension.request({ type: 'UPSERT_RULE', rule: rule('beta', 'exact', `${extension.baseURL}/module/beta`, 'Beta workspace') });
  await expect(page).toHaveTitle('Alpha workspace');
  await page.locator('#spa').click();
  await expect(page).toHaveURL(/\/module\/beta\?/);
  await expect(page).toHaveTitle('Beta workspace');
  await page.goto(`${extension.baseURL}/module/alpha`);
  await expect(page).toHaveTitle('Alpha workspace');
  await page.locator('#navigate').click();
  await expect(page).toHaveTitle('Beta workspace');
});

test('page-driven title and favicon replacements converge without a mutation loop and restore the latest originals', async ({ extension }) => {
  const page = await extension.open();
  const tabId = await apply(extension, page, 'Stable workspace');
  await page.locator('#mutate').click();
  await expect(page).toHaveTitle('Stable workspace');
  await expect.poll(() => customIcon(page)).toContain('data:image/svg+xml');
  // Give both observer debounce windows time to settle, then verify no periodic rewriting.
  await page.waitForTimeout(600);
  const settledCount = await page.evaluate(() => (window as unknown as { fixtureMutations: number }).fixtureMutations);
  await page.waitForTimeout(900);
  const laterCount = await page.evaluate(() => (window as unknown as { fixtureMutations: number }).fixtureMutations);
  expect(laterCount - settledCount).toBe(0);
  await extension.request({ type: 'REMOVE_APPLIED', tabId });
  await expect(page).toHaveTitle('Page replacement title');
  await expect.poll(() => customIcon(page)).toBe('');
  await expect(page.locator('link[rel="icon"]')).toHaveAttribute('href', '/replacement.svg');
});

test('temporary overrides survive navigation and actual service-worker termination, then expire on browser restart', async ({ extension }) => {
  const page = await extension.open();
  const tabId = await apply(extension, page, 'Persistent default', 'domain');
  await apply(extension, page, 'Temporary workspace', 'tab');
  const worker = extension.context.serviceWorkers()[0];
  expect(worker).toBeTruthy();
  const cdp = await extension.context.newCDPSession(extension.bridge);
  const { targetInfos } = await cdp.send('Target.getTargets');
  const target = targetInfos.find((candidate) => candidate.type === 'service_worker' && candidate.url === worker.url());
  expect(target, 'The extension worker must exist before termination').toBeTruthy();
  const destroyed = worker.waitForEvent('close');
  const restarted = extension.context.waitForEvent('serviceworker', (candidate) => candidate !== worker);
  const { success } = await cdp.send('Target.closeTarget', { targetId: target!.targetId });
  expect(success, 'CDP must acknowledge service-worker target termination').toBe(true);
  await destroyed;
  expect(extension.context.serviceWorkers()).not.toContain(worker);
  const state = await extension.request({ type: 'GET_STATE', tabId });
  const newWorker = await restarted;
  expect(newWorker).not.toBe(worker);
  expect(state.tab?.temporary).toBe(true);
  await page.goto(`${extension.baseURL}/module/beta`);
  await expect(page).toHaveTitle('Temporary workspace');
  await cdp.detach();
  await extension.restart();
  const newPage = await extension.open('/module/beta');
  await expect(newPage).toHaveTitle('Persistent default');
  const newState = await extension.request({ type: 'GET_STATE', tabId: await extension.tabId(newPage) });
  expect(newState.tab?.temporary).toBe(false);
});

test('diagnostics report only structural identification data and never page content or URL values', async ({ extension }) => {
  const page = await extension.open('/module/4815162342?token=PRIVATE_TOKEN&customer=PRIVATE_CUSTOMER#PRIVATE_FRAGMENT');
  const tabId = await extension.tabId(page);
  const diagnostic = await extension.request<Diagnostics>({ type: 'GET_DIAGNOSTICS', tabId });
  expect(diagnostic.formatVersion).toBe(1);
  expect(diagnostic.siteKind).toBe('ordinary');
  expect(diagnostic.pathSegmentKinds).toContain('number');
  expect(JSON.stringify(diagnostic)).not.toMatch(/PRIVATE_|4815162342|127\.0\.0\.1|Original|Local extension test fixture/);
});

test('settings can create, search, edit, disable, re-enable, and delete a rule', async ({ extension }) => {
  const page = await extension.open();
  const options = extension.bridge;
  await options.getByRole('button', { name: 'Add rule', exact: true }).click();
  await options.getByLabel('Rule scope', { exact: true }).selectOption('exact');
  await options.getByLabel('Exact URL', { exact: true }).fill(`${extension.baseURL}/module/alpha`);
  await options.getByLabel('Tab title', { exact: true }).fill('Settings workspace');
  await options.getByRole('button', { name: 'Save rule', exact: true }).click();
  await expect(page).toHaveTitle('Settings workspace');
  await options.getByLabel('Search rules', { exact: true }).fill('does-not-exist');
  await expect(options.getByRole('heading', { name: 'No matching rules', exact: true })).toBeVisible();
  await options.getByLabel('Search rules', { exact: true }).fill('Settings workspace');
  await options.getByRole('button', { name: 'Edit rule Settings workspace', exact: true }).click();
  await options.getByLabel('Tab title', { exact: true }).fill('Edited workspace');
  await options.getByRole('button', { name: 'Save rule', exact: true }).click();
  await expect(page).toHaveTitle('Edited workspace');
  await options.getByLabel('Search rules', { exact: true }).fill('');
  const enabled = options.getByRole('checkbox', { name: 'Enable rule Edited workspace', exact: true });
  await enabled.uncheck();
  await expect(page).toHaveTitle('Original · Alpha');
  await enabled.check();
  await expect(page).toHaveTitle('Edited workspace');
  await options.getByRole('button', { name: 'Delete rule Edited workspace', exact: true }).click();
  await options.getByRole('button', { name: 'Confirm delete rule', exact: true }).click();
  await expect(page).toHaveTitle('Original · Alpha');
  await expect.poll(() => customIcon(page)).toBe('');
});

test('restricted browser pages show a clear unavailable state in the popup', async ({ extension }) => {
  const page = await extension.context.newPage();
  await page.goto('chrome://version/');
  const popup = await extension.popup(await extension.tabId(page));
  await expect(popup.getByText(/Chrome|browser|restricted|unavailable|cannot customize/i).first()).toBeVisible();
  await expect(popup.getByRole('button', { name: 'Save customization', exact: true })).toBeDisabled();
  const state = await extension.request({ type: 'GET_STATE', tabId: await extension.tabId(page) });
  expect(state.tab?.unsupportedReason).toBeTruthy();
});

test('native tab-menu capability is probed without assuming support from a Chrome version number', async ({ extension }) => {
  const supported = await extension.bridge.evaluate(() => new Promise<boolean>((resolve) => {
    try {
      chrome.contextMenus.create({ id: 'browser-test-tab-probe', title: 'Test probe', contexts: ['tab'] }, () => {
        const error = chrome.runtime.lastError;
        if (error) { resolve(false); return; }
        chrome.contextMenus.remove('browser-test-tab-probe', () => resolve(true));
      });
    } catch { resolve(false); }
  }));
  const state = await extension.request<AppState>({ type: 'GET_STATE' });
  expect(state.nativeTabMenu).toBe(supported);
});
