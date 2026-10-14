import { test as base, chromium, type BrowserContext, type Page } from '@playwright/test';
import { createServer, type Server } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { AppState, Request, Response } from '../../src/shared/types';

const extensionPath = path.resolve('dist');

export class ExtensionHarness {
  context!: BrowserContext;
  extensionId = '';
  bridge!: Page;

  constructor(readonly profile: string, readonly baseURL: string) {}

  async launch(): Promise<void> {
    this.context = await chromium.launchPersistentContext(this.profile, {
      executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium',
      headless: true,
      ignoreDefaultArgs: ['--disable-extensions'],
      args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`, '--no-sandbox'],
    });
    const worker = this.context.serviceWorkers()[0]
      ?? await this.context.waitForEvent('serviceworker', { timeout: 10_000 }).catch(() => {
        throw new Error('TabMarker service worker did not load. The selected Chromium must permit unpacked extensions. Check managed extension policy or select an authorized development browser with CHROMIUM_PATH.');
      });
    this.extensionId = new URL(worker.url()).hostname;
    this.bridge = await this.context.newPage();
    await this.bridge.goto(`chrome-extension://${this.extensionId}/options.html`);
  }

  async restart(): Promise<void> {
    await this.context.close();
    await this.launch();
  }

  async open(pathname = '/module/alpha'): Promise<Page> {
    const page = await this.context.newPage();
    await page.goto(this.baseURL + pathname);
    await page.locator('#ready').waitFor();
    return page;
  }

  async tabId(page: Page): Promise<number> {
    await page.bringToFront();
    const url = page.url();
    return this.bridge.evaluate(async (targetURL) => {
      const tabs = await chrome.tabs.query({});
      // Chrome withholds internal-page URLs without the broad `tabs` permission.
      const tab = tabs.find((candidate) => candidate.url === targetURL)
        ?? (targetURL.startsWith('chrome:') ? tabs.find((candidate) => candidate.active) : undefined);
      if (tab?.id === undefined) throw new Error(`Tab not found: ${targetURL}`);
      return tab.id;
    }, url);
  }

  async request<T = AppState>(request: Request): Promise<T> {
    const response = await this.bridge.evaluate(async (message) =>
      chrome.runtime.sendMessage(message), request) as Response<T>;
    if (!response?.ok) throw new Error(response?.error ?? 'Missing TabMarker response');
    return response.data;
  }

  async popup(tabId: number): Promise<Page> {
    const popup = await this.context.newPage();
    await popup.goto(`chrome-extension://${this.extensionId}/popup.html?tabId=${tabId}`);
    await popup.getByRole('heading', { name: 'TabMarker', exact: true }).waitFor();
    return popup;
  }

  async close(): Promise<void> {
    await this.context?.close();
  }
}

type Fixtures = { extension: ExtensionHarness };

export const test = base.extend<Fixtures>({
  extension: async ({}, use) => {
    const server = createFixtureServer();
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Fixture server has no TCP address');
    const profile = await mkdtemp(path.join(tmpdir(), 'tabmarker-browser-'));
    const extension = new ExtensionHarness(profile, `http://127.0.0.1:${address.port}`);
    try {
      await extension.launch();
      await use(extension);
    } finally {
      await extension.close();
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
      await rm(profile, { recursive: true, force: true });
    }
  },
});

export { expect } from '@playwright/test';

function createFixtureServer(): Server {
  return createServer((request, response) => {
    const pathname = new URL(request.url ?? '/', 'http://fixture.test').pathname;
    if (pathname.endsWith('.svg')) {
      response.writeHead(200, { 'Content-Type': 'image/svg+xml', 'Cache-Control': 'no-store' });
      response.end('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect fill="#64748b" width="32" height="32"/></svg>');
      return;
    }
    const label = pathname.endsWith('/beta') ? 'Beta' : pathname.endsWith('/alpha') ? 'Alpha' : 'Other';
    response.writeHead(200, { 'Content-Type': 'text/html', 'Cache-Control': 'no-store' });
    response.end(`<!doctype html>
      <html><head><meta charset="utf-8"><title>Original · ${label}</title>
      <link rel="icon" href="/original.svg"></head><body>
      <h1 id="ready">Local extension test fixture</h1>
      <a href="/module/beta" id="navigate">Navigate to Beta</a>
      <button id="spa">SPA to Beta</button>
      <button id="mutate">Page replaces title and favicon</button>
      <script>
        window.fixtureMutations = 0;
        new MutationObserver((records) => { window.fixtureMutations += records.length; })
          .observe(document.head, { subtree: true, childList: true, attributes: true, characterData: true });
        document.querySelector('#spa').onclick = () => {
          history.pushState({}, '', '/module/beta?token=SPA_PRIVATE_SENTINEL#private-fragment');
          document.title = 'Original · Beta';
          document.querySelector('link[rel="icon"]').href = '/beta.svg';
        };
        document.querySelector('#mutate').onclick = () => {
          document.title = 'Page replacement title';
          for (const icon of document.querySelectorAll('link[rel~="icon"]')) icon.remove();
          const icon = document.createElement('link');
          icon.rel = 'icon'; icon.href = '/replacement.svg'; document.head.append(icon);
        };
      </script></body></html>`);
  });
}
