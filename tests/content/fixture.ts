import { test as base, type Page } from '@playwright/test';
import { createServer } from 'node:http';
import path from 'node:path';
import type { ContentMessage, Customization } from '../../src/shared/types';

type Listener = (message: ContentMessage, sender: object, response: (data: unknown) => void) => void;
interface ContentControls {
  desired: Customization | null;
  routes: Record<string, Customization | null>;
  listeners: Listener[];
  requests: string[];
  mutationCount: number;
  detachedIcon?: HTMLLinkElement;
}
declare global {
  interface Window { __tmContentTest: ContentControls }
}

export const appearanceA: Customization = { title: 'Workspace A', icon: { color: '#dc2626', glyph: 'A' } };
export const appearanceB: Customization = { title: 'Workspace B', icon: { color: '#2563eb', glyph: 'B' } };

export class ContentHarness {
  constructor(readonly page: Page, readonly baseURL: string) {}

  async load(customization: Customization | null = appearanceA, options: { icon?: boolean; routes?: Record<string, Customization | null> } = {}): Promise<void> {
    await this.page.goto(`${this.baseURL}/module/alpha${options.icon === false ? '?no-icon' : ''}`);
    await this.page.evaluate(({ desired, routes }) => {
      const controls: ContentControls = { desired, routes, listeners: [], requests: [], mutationCount: 0 };
      window.__tmContentTest = controls;
      const runtime = {
        id: 'tabmarker-content-component-test',
        onMessage: { addListener: (listener: Listener) => controls.listeners.push(listener) },
        sendMessage: async (message: { type: string; url: string }) => {
          if (message.type !== 'TM_READY') throw new Error('Unexpected mocked runtime request');
          controls.requests.push(message.url);
          const route = new URL(message.url).pathname;
          return { ok: true, data: Object.hasOwn(controls.routes, route) ? controls.routes[route] : controls.desired };
        },
      };
      // Only the runtime boundary is mocked. All observers and DOM mutations run in Chromium.
      // Chrome exposes a non-configurable window.chrome; keep that object and
      // mock only the runtime API that this component suite owns.
      Object.defineProperty(window.chrome, 'runtime', { configurable: true, value: runtime });
      new MutationObserver((records) => { controls.mutationCount += records.length; })
        .observe(document.head, { subtree: true, childList: true, attributes: true, characterData: true });
    }, { desired: customization, routes: options.routes ?? {} });
    await this.page.addScriptTag({ path: path.resolve('dist/content.js') });
  }

  async apply(customization: Customization | null): Promise<void> {
    await this.page.evaluate((next) => {
      const controls = window.__tmContentTest;
      controls.desired = next;
      const url = new URL(location.href);
      url.search = '';
      url.hash = '';
      const message: ContentMessage = { type: 'TM_APPLY', customization: next, url: url.href };
      for (const listener of controls.listeners) listener(message, {}, () => undefined);
    }, customization);
  }

  async iconURL(): Promise<string> {
    return this.page.evaluate(() => [...document.querySelectorAll<HTMLLinkElement>('link[rel~="icon"]')]
      .map((icon) => icon.href).find((url) => url.startsWith('data:image/svg+xml')) ?? '');
  }
}

export const test = base.extend<{ content: ContentHarness }, { fixtureURL: string }>({
  fixtureURL: [async ({}, use) => {
    const server = createServer((request, response) => {
      const url = new URL(request.url ?? '/', 'http://fixture.test');
      response.setHeader('Cache-Control', 'no-store');
      if (url.pathname.endsWith('.svg')) {
        response.writeHead(200, { 'Content-Type': 'image/svg+xml' });
        response.end('<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><rect width="32" height="32" fill="gray"/></svg>');
        return;
      }
      response.writeHead(200, { 'Content-Type': 'text/html' });
      response.end(`<!doctype html><html><head><meta charset="utf-8"><title>Original page</title>
        ${url.searchParams.has('no-icon') ? '' : '<link id="page-icon" rel="shortcut icon" href="/original.svg" type="image/svg+xml" sizes="32x32">'}
        </head><body><h1>Local content component fixture</h1></body></html>`);
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('No fixture HTTP address');
    try { await use(`http://127.0.0.1:${address.port}`); }
    finally { await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())); }
  }, { scope: 'worker' }],
  content: async ({ page, fixtureURL }, use) => { await use(new ContentHarness(page, fixtureURL)); },
});

export { expect } from '@playwright/test';
