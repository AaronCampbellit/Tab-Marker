import { describe, expect, it } from 'vitest';
import { AUTOTASK_VIEWS, getAutotaskView } from '../../src/integrations/autotask-routing';
import { normalizeMatchingUrl, normalizeUrl } from '../../src/core/normalization';
import { findMatchingRule } from '../../src/core/matching';
import { migrateState, normalizeRule } from '../../src/core/rules';
import type { Rule } from '../../src/shared/types';

const landing = 'https://ww5.autotask.net/AutotaskOnyx/LandingPage';
const rule = (id: string, match: string, updatedAt = 1): Rule => ({
  id, match, scope: 'exact', title: id, icon: null, enabled: true, createdAt: 1, updatedAt,
});

describe('reviewed Autotask view matching', () => {
  it.each(Object.entries(AUTOTASK_VIEWS))('keeps only view=%s and its reviewed screen label', (view, label) => {
    const raw = `${landing}?view-data=PRIVATE_ENCODED&token=PRIVATE_TOKEN&view=${view}#PRIVATE_FRAGMENT`;
    expect(getAutotaskView(raw)).toEqual({ id: view, label });
    expect(normalizeMatchingUrl(raw)).toBe(`${landing}?view=${view}`);
    expect(normalizeMatchingUrl(normalizeMatchingUrl(raw)!)).toBe(`${landing}?view=${view}`);
    expect(normalizeUrl(raw)).toBe(landing);
    expect(normalizeRule(rule(view, raw)).match).toBe(`${landing}?view=${view}`);
  });

  it.each([
    '?view=PRIVATE_CUSTOMER', '?view=constructor', '?view=__proto__',
    '?view=quote-search&view=generate-invoices', '?view=quote-search&VIEW=private',
    '?VIEW=quote-search', '?view=', '?view-data=eyJ2aWV3IjoicXVvdGUtc2VhcmNoIn0=',
  ])('drops unapproved or ambiguous query %s', query => {
    expect(getAutotaskView(landing + query)).toBeNull();
    expect(normalizeMatchingUrl(landing + query)).toBe(landing);
  });

  it.each([
    'https://autotask.net.attacker.test/AutotaskOnyx/LandingPage?view=quote-search',
    'https://notautotask.net/AutotaskOnyx/LandingPage?view=quote-search',
    'https://ww5.autotask.net/OtherPage?view=quote-search',
    'https://example.com/AutotaskOnyx/LandingPage?view=quote-search',
    'chrome://settings/?view=quote-search',
  ])('never recognizes a view outside its reviewed host/path: %s', input => {
    expect(getAutotaskView(input)).toBeNull();
    expect(normalizeMatchingUrl(input)).toBe(normalizeUrl(input));
  });

  it('removes credentials and canonicalizes encoded view and hostname values', () => {
    expect(normalizeMatchingUrl('https://user:password@WW5.AUTOTASK.NET.:443/AutotaskOnyx/LandingPage?view=%71uote-search&view-data=private'))
      .toBe(`${landing}?view=quote-search`);
  });

  it('selects each screen independently above a newer path-only fallback', () => {
    const broad = rule('all-screens', landing, 999);
    const rules = [broad, ...Object.keys(AUTOTASK_VIEWS).map(view => rule(view, `${landing}?view=${view}`))];
    for (const view of Object.keys(AUTOTASK_VIEWS)) {
      expect(findMatchingRule(rules, `${landing}?view=${view}&view-data=PRIVATE`)?.id).toBe(view);
    }
    expect(findMatchingRule(rules, `${landing}?view=unknown`)?.id).toBe('all-screens');
    expect(findMatchingRule(rules.filter(item => item.id !== 'all-screens'), `${landing}?view=unknown`)).toBeNull();
    expect(findMatchingRule(rules.map(item => item.id === 'quote-search' ? { ...item, enabled: false } : item), `${landing}?view=quote-search`)?.id).toBe('all-screens');
  });

  it('migrates old exact rules without opting them into new query semantics', () => {
    const legacy = { version: 2, rules: [rule('old', `${landing}?view=quote-search&token=PRIVATE`)] };
    const migrated = migrateState(legacy);
    expect(migrated.version).toBe(3);
    expect(migrated.rules[0].match).toBe(landing);
    expect(findMatchingRule(migrated.rules, `${landing}?view=generate-invoices`)?.id).toBe('old');
    expect(legacy.rules[0].match).toContain('PRIVATE');
    const current = { version: 3, rules: [rule('new', `${landing}?view=quote-search`)] };
    expect(migrateState(current)).toEqual(current);
  });
});
