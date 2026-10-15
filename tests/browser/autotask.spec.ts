import { test, expect, type ExtensionHarness } from './fixture';
import { AUTOTASK_VIEWS } from '../../src/integrations/autotask-routing';

const landing = 'https://ww5.autotask.net/AutotaskOnyx/LandingPage';
const encodedPrivate = Buffer.from(JSON.stringify({ url: 'https://ww5.autotask.net/Mvc/PRIVATE_CUSTOMER_RECORD' })).toString('base64');
const address = (view: string) => `${landing}?view=${view}&view-data=${encodeURIComponent(encodedPrivate)}&token=PRIVATE_TOKEN#PRIVATE_FRAGMENT`;

async function interceptAutotask(extension: ExtensionHarness) {
  // Every request to this host is intercepted: these tests never contact Autotask.
  await extension.context.route('https://ww5.autotask.net/**', route => route.fulfill({
    contentType: 'text/html',
    body: '<!doctype html><html><head><meta charset="utf-8"><title>Original Autotask fixture</title></head><body><h1>Autotask route fixture</h1></body></html>',
  }));
}

test('popup saves three independent Autotask views and restores them across a browser restart', async ({ extension }) => {
  await interceptAutotask(extension);
  const tabs = [];
  let index = 0;
  for (const [view, label] of Object.entries(AUTOTASK_VIEWS)) {
    const page = await extension.context.newPage();
    await page.goto(address(view));
    const tabId = await extension.tabId(page);
    const popup = await extension.popup(tabId);
    await expect(popup.getByLabel('Rule scope', { exact: true })).toHaveValue('exact');
    await expect(popup.getByText(`Matches this Autotask screen: ${label}`, { exact: false })).toBeVisible();
    await popup.getByLabel('Tab title', { exact: true }).fill(label);
    await popup.getByLabel('Icon symbol', { exact: true }).fill(String(++index));
    await popup.getByRole('button', { name: 'Save customization', exact: true }).click();
    await expect(page).toHaveTitle(label);
    tabs.push({ page, label, view });
    await popup.close();
  }
  for (const { page, label } of tabs) await expect(page).toHaveTitle(label);
  const state = await extension.request({ type: 'GET_STATE', tabId: await extension.tabId(tabs[0].page) });
  expect(state.rules).toHaveLength(3);
  expect(state.rules.map(rule => rule.match).sort()).toEqual(Object.keys(AUTOTASK_VIEWS).map(view => `${landing}?view=${view}`).sort());
  const stored = JSON.stringify(await extension.bridge.evaluate(() => chrome.storage.local.get(null)));
  expect(stored).not.toMatch(/PRIVATE_|view-data|token=|Original Autotask/);
  expect(stored).not.toContain(encodedPrivate);
  expect(await extension.bridge.evaluate(() => chrome.storage.local.get('tabmarker.state')))
    .toMatchObject({ 'tabmarker.state': { version: 4 } });
  await extension.restart();
  await interceptAutotask(extension);
  for (const [view, label] of Object.entries(AUTOTASK_VIEWS)) {
    const page = await extension.context.newPage();
    await page.goto(`${landing}?other=ignored&view=${view}&view-data=changed`);
    await expect(page).toHaveTitle(label);
  }
});

test('query-only SPA changes choose the right view; legacy landing-page rules remain fallbacks', async ({ extension }) => {
  await interceptAutotask(extension);
  await extension.request({ type: 'UPSERT_RULE', rule: {
    id: 'landing-fallback', scope: 'exact', match: landing, title: 'Landing fallback', icon: null,
    enabled: true, createdAt: 1, updatedAt: 1,
  } });
  const page = await extension.context.newPage();
  await page.goto(address('quote-search'));
  const tabId = await extension.tabId(page);
  for (const [view, label] of Object.entries(AUTOTASK_VIEWS)) {
    await extension.request({ type: 'UPSERT_RULE', rule: {
      id: view, scope: 'exact', match: address(view), title: label, icon: null,
      enabled: true, createdAt: 1, updatedAt: 1,
    } });
  }
  await expect(page).toHaveTitle('Quote search');
  for (const [view, label] of Object.entries(AUTOTASK_VIEWS)) {
    // No DOM mutation: exercise the isolated content script's URL heartbeat.
    await page.evaluate(url => history.pushState({}, '', url), address(view));
    await expect(page).toHaveTitle(label);
    expect((await extension.request({ type: 'GET_STATE', tabId })).tab?.url).toBe(`${landing}?view=${view}`);
  }
  await extension.request({ type: 'TOGGLE_RULE', id: 'payment-processing-search', enabled: false });
  await expect(page).toHaveTitle('Landing fallback');
  await page.evaluate(url => history.replaceState({}, '', url), address('quote-search'));
  await expect(page).toHaveTitle('Quote search');
  await page.evaluate(url => history.pushState({}, '', url), address('unreviewed-view'));
  await expect(page).toHaveTitle('Landing fallback');
  await extension.request({ type: 'DELETE_RULE', id: 'landing-fallback' });
  await expect(page).toHaveTitle('Original Autotask fixture');
});

test('settings accepts full Autotask links and keeps only the reviewed view', async ({ extension }) => {
  await interceptAutotask(extension);
  const page = await extension.context.newPage();
  await page.goto(address('generate-invoices'));
  const options = extension.bridge;
  await options.getByRole('button', { name: 'Add rule', exact: true }).click();
  await options.getByLabel('Exact URL', { exact: true }).fill(address('generate-invoices'));
  await options.getByLabel('Tab title', { exact: true }).fill('Invoice workspace');
  await options.getByRole('button', { name: 'Save rule', exact: true }).click();
  await expect(page).toHaveTitle('Invoice workspace');
  await expect(options.getByText(`${landing}?view=generate-invoices`, { exact: true })).toBeVisible();
  await options.getByRole('button', { name: 'Edit rule Invoice workspace', exact: true }).click();
  await expect(options.getByLabel('Exact URL', { exact: true })).toHaveValue(`${landing}?view=generate-invoices`);
  await options.getByRole('button', { name: 'Cancel', exact: true }).click();
  await page.goto(address('quote-search'));
  await expect(page).toHaveTitle('Original Autotask fixture');
});
