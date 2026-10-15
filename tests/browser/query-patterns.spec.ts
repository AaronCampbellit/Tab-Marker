import { test, expect, type ExtensionHarness } from './fixture';

const landing = 'https://ww5.autotask.net/AutotaskOnyx/LandingPage';
const reportedPattern = `${landing}?view=inventory-order*`;
const privateData = Buffer.from('PRIVATE_RECORD_DATA').toString('base64');
const address = (view: string, host = 'ww5') => `https://${host}.autotask.net/AutotaskOnyx/LandingPage?view-data=${privateData}&token=PRIVATE_TOKEN&view=${view}#PRIVATE_FRAGMENT`;

async function intercept(extension: ExtensionHarness) {
  await extension.context.route(/^https:\/\/ww(?:5|12)\.autotask\.net\//, route => route.fulfill({
    contentType: 'text/html',
    body: '<!doctype html><html><head><title>Original inventory fixture</title></head><body><h1>Query wildcard fixture</h1></body></html>',
  }));
}

test('the reported inventory-order wildcard saves, previews, follows SPA routes and survives restart', async ({ extension }) => {
  await intercept(extension);
  const page = await extension.context.newPage();
  await page.goto(address('inventory-order-search'));
  const tabId = await extension.tabId(page);
  const popup = await extension.popup(tabId);
  await popup.getByLabel('Tab title', { exact: true }).fill('Inventory orders');
  await popup.getByLabel('Rule scope', { exact: true }).selectOption('pattern');
  await popup.getByLabel('URL pattern', { exact: true }).fill(reportedPattern);
  await expect(popup.getByText('This pattern matches the current tab.', { exact: true })).toBeVisible();
  await popup.getByRole('button', { name: 'Save customization', exact: true }).click();
  await expect(page).toHaveTitle('Inventory orders');
  await expect(popup.getByRole('alert')).toHaveCount(0);
  const state = await extension.request({ type: 'GET_STATE', tabId });
  expect(state.tab?.url).toBe(landing);
  expect(state.rules[0].match).toBe(reportedPattern);
  const stored = JSON.stringify(await extension.bridge.evaluate(() => chrome.storage.local.get(null)));
  expect(stored).not.toMatch(/PRIVATE_|view-data|token=/);
  expect(stored).not.toContain(privateData);
  expect(await extension.bridge.evaluate(() => chrome.storage.local.get('tabmarker.state')))
    .toMatchObject({ 'tabmarker.state': { version: 4 } });

  // All these views are outside 0.2.0's exact-view allowlist. Query matching
  // must use the live URL in worker memory, rather than the sanitized UI URL.
  await page.evaluate(url => history.pushState({}, '', url), address('inventory-order-details'));
  await expect(page).toHaveTitle('Inventory orders');
  await page.evaluate(url => history.replaceState({}, '', url), address('inventory-receipts'));
  await expect(page).toHaveTitle('Original inventory fixture');
  await expect(popup.getByText('This pattern does not match the current tab.', { exact: true })).toBeVisible();
  await page.evaluate(url => history.pushState({}, '', url), address('inventory-order-grid'));
  await expect(page).toHaveTitle('Inventory orders');
  await expect(popup.getByText('This pattern matches the current tab.', { exact: true })).toBeVisible();
  await extension.restart();
  await intercept(extension);
  const reopened = await extension.context.newPage();
  await reopened.goto(address('inventory-order-new'));
  await expect(reopened).toHaveTitle('Inventory orders');
});

test('partial hostname and multiple query filters work through settings and exclude nonmatches', async ({ extension }) => {
  await intercept(extension);
  const page = await extension.context.newPage();
  await page.goto(address('inventory-order-search'));
  const options = extension.bridge;
  await options.getByRole('button', { name: 'Add rule', exact: true }).click();
  await options.getByLabel('Rule scope', { exact: true }).selectOption('pattern');
  await options.getByLabel('URL pattern', { exact: true }).fill('https://ww*.autotask.net/AutotaskOnyx/*?view=inventory-order*&mode=*grid');
  await options.getByLabel('Tab title', { exact: true }).fill('Inventory grid');
  await options.getByRole('button', { name: 'Save rule', exact: true }).click();
  await expect(page).toHaveTitle('Original inventory fixture');
  await page.goto(`${address('inventory-order-search', 'ww12').split('#')[0]}&mode=large-grid`);
  await expect(page).toHaveTitle('Inventory grid');
  await page.goto(`${address('inventory-receipts', 'ww12').split('#')[0]}&mode=large-grid`);
  await expect(page).toHaveTitle('Original inventory fixture');
  await options.getByRole('button', { name: 'Edit rule Inventory grid', exact: true }).click();
  await expect(options.getByLabel('URL pattern', { exact: true }))
    .toHaveValue('https://ww*.autotask.net/AutotaskOnyx/*?mode=*grid&view=inventory-order*');
});

test('preview reports exact-rule priority and a query-free pattern remains a fallback', async ({ extension }) => {
  await intercept(extension);
  const page = await extension.context.newPage();
  await page.goto(address('inventory-order-search'));
  const tabId = await extension.tabId(page);
  await extension.request({ type: 'SAVE_CUSTOMIZATION', tabId, scope: 'exact', title: 'Existing exact', icon: null });
  const popup = await extension.popup(tabId);
  await popup.getByLabel('Tab title', { exact: true }).fill('Pattern inventory');
  await popup.getByLabel('Rule scope', { exact: true }).selectOption('pattern');
  await popup.getByLabel('URL pattern', { exact: true }).fill(reportedPattern);
  await expect(popup.getByText(/This pattern matches the current tab\. An exact URL rule currently takes priority\./)).toBeVisible();
  await popup.getByRole('button', { name: 'Save customization', exact: true }).click();
  await expect(popup.getByText(/Pattern saved\. An exact URL rule takes priority/)).toBeVisible();
  await expect(page).toHaveTitle('Existing exact');
  const state = await extension.request({ type: 'GET_STATE', tabId });
  await extension.request({ type: 'DELETE_RULE', id: state.rules.find(rule => rule.scope === 'exact')!.id });
  await expect(page).toHaveTitle('Pattern inventory');
  await extension.request({ type: 'UPSERT_RULE', rule: {
    id: 'query-free-fallback', scope: 'pattern', match: `${landing}*`, title: 'All inventory screens',
    icon: null, enabled: true, createdAt: 1, updatedAt: 1,
  } });
  await expect(page).toHaveTitle('Pattern inventory');
  await page.evaluate(url => history.pushState({}, '', url), address('inventory-receipts'));
  await expect(page).toHaveTitle('All inventory screens');
});
