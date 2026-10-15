import { describe, expect, it } from 'vitest';
import { normalizePattern, patternMatches } from '../../src/core/normalization';
import { findMatchingRule } from '../../src/core/matching';
import { migrateState } from '../../src/core/rules';
import type { Rule } from '../../src/shared/types';

const landing = 'https://ww5.autotask.net/AutotaskOnyx/LandingPage';
const inventory = `${landing}?view=inventory-order*`;

describe('hostname and query-value wildcard patterns', () => {
  it('accepts the reported inventory pattern and preserves its query filter', () => {
    expect(normalizePattern(inventory)).toBe(inventory);
    expect(patternMatches(inventory, `${landing}?view=inventory-order`)).toBe(true);
    expect(patternMatches(inventory, `${landing}?view=inventory-order-search&view-data=PRIVATE&token=SECRET#fragment`)).toBe(true);
    expect(patternMatches(inventory, `${landing}?view=quote-search`)).toBe(false);
  });

  it.each([
    ['https://ww*.autotask.net/*?view=inventory-order*', `${landing}?view=inventory-order-search`, true],
    ['https://ww*.autotask.net/*?view=inventory-order*', `${landing.replace('ww5', 'ww12')}?view=inventory-order-details`, true],
    ['https://ww*.autotask.net/*', 'https://ww5.autotask.net.attacker.test/page', false],
    ['https://*task*.net/*', 'https://autotask.net/page', true],
    ['https://foo.*.com/*', 'https://foo.region.com/page', true],
    ['https://foo.*.com/*', 'https://notfoo.region.com/page', false],
    ['https://*.example.com/*', 'https://example.com/page', true],
    ['https://*.example.com/*', 'https://deep.sub.example.com/page', true],
    ['https://ww*.autotask.net/*?view=*-search', `${landing}?view=quote-search`, true],
    ['https://ww*.autotask.net/*?view=*-search', `${landing}?view=payment-processing-search`, true],
    ['https://ww*.autotask.net/*?view=*-search', `${landing}?view=generate-invoices`, false],
    ['*://ww*.autotask.net:443/*?view=*order*', `${landing}?view=inventory-order-grid`, true],
    ['*://ww*.autotask.net:80/*?view=*order*', `${landing}?view=inventory-order-grid`, false],
    ['https://example.com/*?view=inventory-order*&mode=*grid', 'https://example.com/?mode=large-grid&view=inventory-order-search&private=ignored', true],
    ['https://example.com/*?view=inventory-order*&mode=*grid', 'https://example.com/?view=inventory-order-search', false],
    ['https://example.com/*?view=*', 'https://example.com/?view=', true],
    ['https://example.com/*?view=*', 'https://example.com/', false],
    ['https://example.com/*?view=', 'https://example.com/?view=', true],
    ['https://example.com/*?view=order*', 'https://example.com/?view=order&view=quote', false],
    ['https://example.com/*?view=order*', 'https://example.com/?VIEW=order', false],
    ['https://example.com/*?q=hello+*', 'https://example.com/?q=hello%20world', true],
    ['https://example.com/*?q=a%26b*', 'https://example.com/?q=a%26bc', true],
    ['https://example.com/*?q=a%26b*', 'https://example.com/?q=a&bc=1', false],
    ['https://example.com/*?q=*(test)*', 'https://example.com/?q=a(test)b', true],
    ['https://example.com/*?q=*(test)*', 'https://example.com/?q=atestb', false],
    ['https://example.com/*', 'https://example.com/?any=ignored&any=still-ignored', true],
    ['https://example.com/*?__proto__=*', 'https://example.com/?__proto__=value', true],
  ])('%s against %s = %s', (pattern, url, expected) => {
    expect(patternMatches(pattern, url)).toBe(expected);
  });

  it('canonicalizes query order, encoding, and repeated stars idempotently', () => {
    const normalized = normalizePattern('HTTPS://WW**.AUTOTASK.NET.:0443/a/../*?view=inventory-**&filter%5Bmode%5D=large+grid');
    expect(normalized).toBe('https://ww*.autotask.net:443/*?filter%5Bmode%5D=large+grid&view=inventory-*');
    expect(normalizePattern(normalized)).toBe(normalized);
  });

  it.each([
    `${landing}?vi*w=order*`, `${landing}?=order*`, `${landing}?view=a&view=b`,
    `${landing}?view=order*#fragment`, `${landing}?view=%0A*`, `${landing}?%00view=*`,
    'https://ww*..autotask.net/*', 'https://user:secret@ww*.autotask.net/*?view=*',
    `https://example.com/*?q=${'a'.repeat(4096)}`,
    `https://example.com/*?q=${'é'.repeat(1000)}`,
  ])('rejects ambiguous or unsupported pattern %s', pattern => {
    expect(() => normalizePattern(pattern)).toThrow();
    expect(patternMatches(pattern, landing)).toBe(false);
    expect(patternMatches(pattern, pattern.replaceAll('*', ''))).toBe(false);
  });

  it('handles adversarial query wildcard no-matches without regular expression expansion', () => {
    const pattern = `https://example.com/*?view=${'*a'.repeat(40)}b`;
    expect(patternMatches(pattern, `https://example.com/?view=${'a'.repeat(1600)}`)).toBe(false);
    expect(patternMatches(pattern, `https://example.com/?view=${'a'.repeat(1600)}b`)).toBe(true);
  });

  it('preserves query values until rule selection and retains existing exact priority', () => {
    const broad: Rule = { id: 'broad', scope: 'pattern', match: `${landing}*`, title: 'Broad', icon: null, enabled: true, createdAt: 1, updatedAt: 99 };
    const filtered = { ...broad, id: 'inventory', match: inventory, updatedAt: 1 };
    expect(findMatchingRule([broad, filtered], `${landing}?view=inventory-order-grid`)?.id).toBe('inventory');
    expect(findMatchingRule([broad, filtered], `${landing}?view=quote-search`)?.id).toBe('broad');
    expect(findMatchingRule([filtered, { ...broad, id: 'exact', scope: 'exact', match: landing }], `${landing}?view=inventory-order-grid`)?.id).toBe('exact');
  });

  it('migrates schema 3 while preserving exact view semantics and query-free patterns', () => {
    const base: Rule = { id: 'exact', scope: 'exact', match: `${landing}?view=quote-search`, title: 'Quotes', icon: null, enabled: true, createdAt: 1, updatedAt: 1 };
    const state = { version: 3, rules: [base, { ...base, id: 'pattern', scope: 'pattern', match: 'https://*.autotask.net/*' }] };
    const migrated = migrateState(state);
    expect(migrated).toEqual({ ...state, version: 4 });
    expect(migrateState(migrated)).toEqual(migrated);
    expect(state.version).toBe(3);
  });
});
