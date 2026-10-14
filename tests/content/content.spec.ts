import { appearanceA, appearanceB, expect, test } from './fixture';

test('real DOM applies a renderable icon and title, converges, and restores latest page metadata', async ({ content }) => {
  const page = content.page;
  await content.load();
  await expect(page).toHaveTitle('Workspace A');
  await expect.poll(() => content.iconURL()).toContain('data:image/svg+xml');
  const rendered = await page.evaluate(async (source) => {
    const image = new Image();
    image.src = source;
    await image.decode();
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 64;
    const drawing = canvas.getContext('2d')!;
    drawing.drawImage(image, 0, 0);
    return { width: image.naturalWidth, height: image.naturalHeight, pixel: [...drawing.getImageData(32, 6, 1, 1).data] };
  }, await content.iconURL());
  expect(rendered).toEqual({ width: 64, height: 64, pixel: [220, 38, 38, 255] });
  await page.evaluate(() => {
    document.title = 'Latest page title';
    const icon = document.querySelector<HTMLLinkElement>('#page-icon')!;
    icon.setAttribute('href', '/latest.svg');
    icon.setAttribute('sizes', '48x48');
  });
  await expect(page).toHaveTitle('Workspace A');
  await expect(page.locator('#page-icon')).toHaveAttribute('href', /^data:image\/svg\+xml/);
  await page.waitForTimeout(200);
  const settled = await page.evaluate(() => window.__tmContentTest.mutationCount);
  await page.waitForTimeout(1_000);
  expect(await page.evaluate(() => window.__tmContentTest.mutationCount)).toBe(settled);
  await content.apply(null);
  await expect(page).toHaveTitle('Latest page title');
  await expect(page.locator('#page-icon')).toHaveAttribute('href', '/latest.svg');
  await expect(page.locator('#page-icon')).toHaveAttribute('sizes', '48x48');
  await expect(page.locator('[data-tabmarker]')).toHaveCount(0);
});

test('switching custom title A to B to no rule restores the original title and favicon', async ({ content }) => {
  await content.load();
  await expect(content.page).toHaveTitle('Workspace A');
  await content.apply(appearanceB);
  await expect(content.page).toHaveTitle('Workspace B');
  await expect.poll(() => content.iconURL()).toContain('data:image/svg+xml');
  await content.apply(null);
  await expect(content.page).toHaveTitle('Original page');
  await expect(content.page.locator('#page-icon')).toHaveAttribute('href', '/original.svg');
  await expect(content.page.locator('#page-icon')).toHaveAttribute('sizes', '32x32');
  await expect(content.page.locator('link[rel~="icon"]')).toHaveCount(1);
});

test('removing and reinserting the same favicon node preserves its original attributes', async ({ content }) => {
  const page = content.page;
  await content.load();
  await expect(page).toHaveTitle('Workspace A');
  await expect(page.locator('#page-icon')).toHaveAttribute('href', /^data:image\/svg\+xml/);
  await page.evaluate(() => {
    const icon = document.querySelector<HTMLLinkElement>('#page-icon')!;
    window.__tmContentTest.detachedIcon = icon;
    icon.remove();
  });
  // Deliberately cross the observer debounce boundary before reusing this same node.
  await page.waitForTimeout(180);
  expect(await page.evaluate(() => window.__tmContentTest.detachedIcon?.getAttribute('href'))).toBe('/original.svg');
  await page.evaluate(() => { document.head.append(window.__tmContentTest.detachedIcon!); });
  await expect(page.locator('#page-icon')).toHaveAttribute('href', /^data:image\/svg\+xml/);
  await content.apply(null);
  await expect(page.locator('#page-icon')).toHaveAttribute('href', '/original.svg');
  await expect(page.locator('#page-icon')).toHaveAttribute('sizes', '32x32');
  await expect(page.locator('#page-icon')).toHaveAttribute('type', 'image/svg+xml');
});

test('replacing the entire document head reapplies customization and restores the new head metadata', async ({ content }) => {
  const page = content.page;
  await content.load();
  await expect(page).toHaveTitle('Workspace A');
  await page.evaluate(() => {
    const head = document.createElement('head');
    const title = document.createElement('title');
    title.textContent = 'Replacement head title';
    const icon = document.createElement('link');
    icon.id = 'replacement-icon';
    icon.rel = 'icon';
    icon.href = '/replacement-head.svg';
    head.append(title, icon);
    document.head.replaceWith(head);
  });
  await expect(page).toHaveTitle('Workspace A');
  await expect(page.locator('#replacement-icon')).toHaveAttribute('href', /^data:image\/svg\+xml/);
  await content.apply(null);
  await expect(page).toHaveTitle('Replacement head title');
  await expect(page.locator('#replacement-icon')).toHaveAttribute('href', '/replacement-head.svg');
  await expect(page.locator('[data-tabmarker]')).toHaveCount(0);
});

test('a page-authored favicon on the extension-created node survives customization removal', async ({ content }) => {
  const page = content.page;
  await content.load(appearanceA, { icon: false });
  await expect(page).toHaveTitle('Workspace A');
  await expect(page.locator('link[rel~="icon"]')).toHaveCount(1);
  await page.evaluate(() => {
    const icon = document.querySelector<HTMLLinkElement>('link[rel~="icon"]')!;
    icon.href = '/page-owned.svg';
    icon.type = 'image/png';
    icon.sizes = '64x64';
  });
  await expect.poll(() => content.iconURL()).toContain('data:image/svg+xml');
  // Let the observer capture the page edit before requesting removal.
  await page.waitForTimeout(150);
  await content.apply(null);
  await expect(page).toHaveTitle('Original page');
  await expect(page.locator('link[rel~="icon"]')).toHaveCount(1);
  await expect(page.locator('link[rel~="icon"]')).toHaveAttribute('href', '/page-owned.svg');
  await expect(page.locator('link[rel~="icon"]')).toHaveAttribute('type', 'image/png');
  await expect(page.locator('link[rel~="icon"]')).toHaveAttribute('sizes', '64x64');
  await expect(page.locator('[data-tabmarker]')).toHaveCount(0);
});

test('an SPA pushState without any DOM change is discovered by the heartbeat with sanitized URL messaging', async ({ content }) => {
  const page = content.page;
  await content.load(appearanceA, { routes: { '/module/alpha': appearanceA, '/module/beta': appearanceB } });
  await expect(page).toHaveTitle('Workspace A');
  const callsBefore = await page.evaluate(() => window.__tmContentTest.requests.length);
  await page.evaluate(() => { history.pushState({}, '', '/module/beta?token=LOCAL_PRIVATE_SENTINEL#private'); });
  await expect(page).toHaveTitle('Workspace B');
  const requests = await page.evaluate(() => window.__tmContentTest.requests);
  expect(requests.length).toBeGreaterThan(callsBefore);
  expect(requests.at(-1)).toBe(`${content.baseURL}/module/beta`);
  expect(JSON.stringify(requests)).not.toContain('LOCAL_PRIVATE_SENTINEL');
});
