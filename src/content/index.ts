import { createFavicon } from '../core/favicon';
import { normalizeUrl } from '../core/normalization';
import { getPageDiagnostics } from '../integrations/autotask';
import type { ContentMessage, Customization, Response } from '../shared/types';

const supported = document.contentType === 'text/html' || document.contentType === 'application/xhtml+xml';
const CONTROLLED_ATTRIBUTES = ['href', 'type', 'sizes'] as const;
type AttributeSnapshot = Record<(typeof CONTROLLED_ATTRIBUTES)[number], string | null>;
interface SavedIcon { original: AttributeSnapshot; applied: AttributeSnapshot }
let customization: Customization | null = null;
let originalTitle = document.title;
let appliedTitle: string | null = null;
let iconUrl: string | null = null;
let ownIcon: HTMLLinkElement | null = null;
let ownApplied: AttributeSnapshot | null = null;
let ownPageSnapshot: AttributeSnapshot | null = null;
const savedIcons = new Map<HTMLLinkElement, SavedIcon>();
let head: HTMLHeadElement | null = null;
let root: HTMLElement | null = null;
let repairTimer: ReturnType<typeof setTimeout> | undefined;
let disposed = false;
let ready = document.readyState !== 'loading';
let lastUrl = '';
let requestSequence = 0;
let responseFailed = false;

function snapshot(link: HTMLLinkElement): AttributeSnapshot {
  return Object.fromEntries(CONTROLLED_ATTRIBUTES.map(key => [key, link.getAttribute(key)])) as AttributeSnapshot;
}
function restoreAttributes(link: HTMLLinkElement, attributes: AttributeSnapshot): void {
  for (const key of CONTROLLED_ATTRIBUTES) {
    const value = attributes[key];
    if (value === null) { if (link.hasAttribute(key)) link.removeAttribute(key); }
    else if (link.getAttribute(key) !== value) link.setAttribute(key, value);
  }
}
function isIcon(link: HTMLLinkElement): boolean { return /(?:^|\s)icon(?:\s|$)/i.test(link.rel); }
function capturePageChanges(): void {
  if (!ready) return;
  if (appliedTitle === null || document.title !== appliedTitle) originalTitle = document.title;
  if (ownIcon && ownApplied) {
    if (!ownIcon.isConnected) ownPageSnapshot = null;
    else {
      const current = snapshot(ownIcon);
      // Sites with no initial icon may adopt the link we added. Preserve their authored href.
      if (current.href !== ownApplied.href && current.href !== null) {
        ownPageSnapshot ??= { href: null, type: null, sizes: null };
        ownPageSnapshot.href = current.href;
      }
      if (ownPageSnapshot) for (const key of ['type', 'sizes'] as const) {
        if (current[key] !== ownApplied[key]) ownPageSnapshot[key] = current[key];
      }
    }
  }
  for (const [link, saved] of savedIcons) {
    // Preserve only attributes the page actually changed; the others still contain our SVG overrides.
    const current = snapshot(link);
    for (const key of CONTROLLED_ATTRIBUTES) if (current[key] !== saved.applied[key]) saved.original[key] = current[key];
    if (!link.isConnected) {
      // Detached nodes may be reused by an SPA; never let our SVG become their new original.
      restoreAttributes(link, saved.original);
      savedIcons.delete(link);
    }
  }
}
function observeHead(): void {
  if (head && !disposed) headObserver.observe(head, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['href', 'rel', 'type', 'sizes'] });
}
function withoutObserver(write: () => void): void {
  // Taking pending records into account before disconnecting prevents losing page edits that arrive during debounce.
  capturePageChanges();
  headObserver.disconnect();
  try { write(); } finally { observeHead(); }
}
function attach(): void {
  if (disposed) return;
  if (root !== document.documentElement) {
    rootObserver.disconnect();
    root = document.documentElement;
    if (root) rootObserver.observe(root, { childList: true });
  }
  if (head !== document.head) {
    capturePageChanges();
    headObserver.disconnect();
    head = document.head;
    observeHead();
  }
}
function reconcile(): void {
  repairTimer = undefined;
  if (disposed || !supported) return;
  attach();
  if (!ready || !head) return;
  withoutObserver(() => {
    const desiredTitle = customization?.title;
    if (desiredTitle !== null && desiredTitle !== undefined) {
      if (document.title !== desiredTitle) document.title = desiredTitle;
      appliedTitle = desiredTitle;
    }
    const desiredIcon = customization?.icon;
    if (desiredIcon && iconUrl) {
      // The browser may choose any candidate icon; override each regular favicon while retaining its attributes.
      for (const link of head!.querySelectorAll<HTMLLinkElement>('link[rel]')) {
        if (link === ownIcon || !isIcon(link)) continue;
        let saved = savedIcons.get(link);
        if (!saved) { saved = { original: snapshot(link), applied: snapshot(link) }; savedIcons.set(link, saved); }
        restoreAttributes(link, { href: iconUrl, type: 'image/svg+xml', sizes: null });
        saved.applied = snapshot(link);
      }
      // A page can repurpose an existing <link>; stop treating it as a favicon without restoring its old rel.
      for (const [link, saved] of savedIcons) {
        if (link.isConnected && !isIcon(link)) { restoreAttributes(link, saved.original); savedIcons.delete(link); }
      }
      if (!ownIcon || !ownIcon.isConnected || ownIcon.parentElement !== head) {
        ownIcon?.remove();
        ownPageSnapshot = null;
        ownApplied = null;
        ownIcon = document.createElement('link');
        ownIcon.setAttribute('data-tabmarker', 'favicon');
        ownIcon.rel = 'icon';
        ownIcon.type = 'image/svg+xml';
        ownIcon.href = iconUrl;
        head!.appendChild(ownIcon);
      } else {
        if (ownIcon.rel !== 'icon') ownIcon.rel = 'icon';
        if (ownIcon.type !== 'image/svg+xml') ownIcon.type = 'image/svg+xml';
        if (ownIcon.getAttribute('href') !== iconUrl) ownIcon.setAttribute('href', iconUrl);
      }
      ownApplied = snapshot(ownIcon);
    }
  });
}
function scheduleRepair(): void {
  if (disposed || repairTimer !== undefined) return;
  // At most one repair per 60ms, with idempotent writes and observer disconnected during our changes.
  repairTimer = setTimeout(reconcile, 60);
}
function setCustomization(next: Customization | null): void {
  if (JSON.stringify(customization) === JSON.stringify(next)) { scheduleRepair(); return; }
  attach();
  withoutObserver(() => {
    if (ready && appliedTitle !== null && !next?.title) {
      if (document.title !== originalTitle) document.title = originalTitle;
      appliedTitle = null;
    }
    if (customization?.icon && !next?.icon) {
      for (const [link, saved] of savedIcons) if (link.isConnected) restoreAttributes(link, saved.original);
      savedIcons.clear();
      if (ownIcon?.isConnected && ownPageSnapshot?.href) {
        restoreAttributes(ownIcon, ownPageSnapshot);
        ownIcon.removeAttribute('data-tabmarker');
      } else ownIcon?.remove();
      ownIcon = null;
      ownPageSnapshot = null;
      ownApplied = null;
    }
    customization = next;
    iconUrl = next?.icon ? createFavicon(next.icon) : null;
  });
  scheduleRepair();
}
async function synchronize(): Promise<void> {
  const url = normalizeUrl(location.href);
  if (!url || disposed || !supported) return;
  lastUrl = location.href;
  responseFailed = false;
  const sequence = ++requestSequence;
  try {
    const response = await chrome.runtime.sendMessage({ type: 'TM_READY', url }) as Response<Customization | null>;
    if (disposed || sequence !== requestSequence || lastUrl !== location.href) return;
    if (response?.ok) setCustomization(response.data);
    else responseFailed = true;
  } catch {
    // The extension may have been updated/reloaded. Do not spin or log page data.
    responseFailed = true;
    if (!chrome.runtime.id) dispose();
  }
}
function checkLocation(): void {
  if (location.href !== lastUrl) void synchronize();
}
const headObserver = new MutationObserver(() => { checkLocation(); scheduleRepair(); });
const rootObserver = new MutationObserver(() => { attach(); scheduleRepair(); });
const documentObserver = new MutationObserver(() => { attach(); scheduleRepair(); });
function dispose(): void {
  disposed = true;
  headObserver.disconnect();
  rootObserver.disconnect();
  documentObserver.disconnect();
  clearInterval(heartbeat);
  if (repairTimer !== undefined) clearTimeout(repairTimer);
}
chrome.runtime.onMessage.addListener((message: ContentMessage | { type: 'TM_PING' }, _sender, sendResponse) => {
  if (message.type === 'TM_PING') { sendResponse({ supported }); return false; }
  if (!supported) return false;
  if (message.type === 'TM_APPLY') {
    // Invalidate any older in-flight navigation response, then verify the current route.
    ++requestSequence;
    if (location.href !== lastUrl || normalizeUrl(location.href) !== message.url) void synchronize();
    else setCustomization(message.customization);
    sendResponse({ ok: true });
  } else if (message.type === 'TM_DIAGNOSTICS') {
    sendResponse(getPageDiagnostics(location.href, document));
  }
  return false;
});
if (supported) {
  documentObserver.observe(document, { childList: true });
  attach();
  document.addEventListener('DOMContentLoaded', () => {
    ready = true;
    originalTitle = document.title;
    attach();
    scheduleRepair();
  }, { once: true });
  window.addEventListener('popstate', checkLocation);
  window.addEventListener('hashchange', checkLocation);
  window.addEventListener('pageshow', () => { attach(); checkLocation(); scheduleRepair(); });
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) { attach(); if (responseFailed) void synchronize(); else checkLocation(); scheduleRepair(); }
  });
  void synchronize();
}
// A modest isolated-world heartbeat covers pushState/replaceState without extra permissions or main-world hooks.
const heartbeat = setInterval(checkLocation, 750);
