import { describe, expect, it } from 'vitest';
import type { Rule } from '../../src/shared/types';
import { migrateState, normalizeRule, validateCustomization } from '../../src/core/rules';
import { createFavicon } from '../../src/core/favicon';

const valid: Rule = {
  id: 'rule-1', enabled: true, scope: 'exact', match: 'https://example.com/Module',
  title: 'Tickets', icon: { color: '#C92834', glyph: 'T' }, createdAt: 100, updatedAt: 200,
};

describe('customization validation', () => {
  it('allows title-only and icon-only customizations', () => {
    expect(validateCustomization({ title: '  Tickets  ', icon: null })).toEqual({ title: 'Tickets', icon: null });
    expect(validateCustomization({ title: null, icon: { color: '#FAAA00', glyph: '👩‍💻' } })).toEqual({ title: null, icon: { color: '#faaa00', glyph: '👩‍💻' } });
  });
  it('accepts a single grapheme, including composed symbols and combining letters', () => {
    expect(validateCustomization({ title: null, icon: { color: '#123456', glyph: 'e\u0301' } }).icon?.glyph).toBe('é');
    expect(validateCustomization({ title: null, icon: { color: '#123456', glyph: '🇺🇸' } }).icon?.glyph).toBe('🇺🇸');
  });
  it.each([
    { title: null, icon: null },
    { title: '', icon: null },
    { title: undefined, icon: null },
    { title: 'x'.repeat(121), icon: null },
    { title: 'title\nspoof', icon: null },
    { title: 'title\u202espoof', icon: null },
    { title: 'Valid', icon: { color: 'red', glyph: 'T' } },
    { title: 'Valid', icon: { color: '#ffffff;fill:red', glyph: 'T' } },
    { title: 'Valid', icon: { color: '#ffffff', glyph: 'AB' } },
    { title: 'Valid', icon: { color: '#ffffff', glyph: '<' } },
    { title: 'Valid', icon: { color: '#ffffff', glyph: '\u200b' } },
    { title: 'Valid', icon: { color: '#ffffff', glyph: '\nT' } },
    { title: 'Valid', icon: { color: '#ffffff', glyph: '\ud800' } },
  ])('rejects invalid customization %#', value => {
    expect(() => validateCustomization(value)).toThrow();
  });
  it('encodes and XML-escapes SVG text and chooses visible contrast', () => {
    const svg = decodeURIComponent(createFavicon({ color: '#ffffff', glyph: '&' }).split(',')[1]);
    expect(svg).toContain('>&amp;</text>');
    expect(svg).toContain('fill="#111827"');
    expect(svg).not.toContain('<script');
    expect(decodeURIComponent(createFavicon({ color: '#000000', glyph: '1' }))).toContain('fill="#ffffff"');
  });
});

describe('strict rules and safe migration', () => {
  it('normalizes rules and does not retain unrecognized fields or private URL components', () => {
    expect(normalizeRule({ ...valid, match: 'https://user:password@EXAMPLE.com:443/Module?token=secret#private', pageContents: 'private' })).toEqual({
      ...valid, match: 'https://example.com/Module', icon: { color: '#c92834', glyph: 'T' },
    });
  });
  it.each([
    { id: '' }, { id: 'x'.repeat(101) }, { enabled: 'true' }, { scope: 'regexp' },
    { match: 'chrome://settings' }, { createdAt: -1 }, { createdAt: NaN }, { updatedAt: 50 }, { updatedAt: 1.5 },
  ])('rejects invalid rule fields %#', invalid => {
    expect(() => normalizeRule({ ...valid, ...invalid })).toThrow();
  });
  it('uses an empty v2 state only for absent storage', () => {
    expect(migrateState(undefined)).toEqual({ version: 2, rules: [] });
    expect(migrateState(null)).toEqual({ version: 2, rules: [] });
    expect(() => migrateState({})).toThrow();
  });
  it('supports the explicit v1 letter-to-glyph migration without mutating stored input', () => {
    const legacy = { version: 1, rules: [{ ...valid, icon: { color: '#123456', letter: 'T' } }] };
    const migrated = migrateState(legacy);
    expect(migrated.version).toBe(2);
    expect(migrated.rules[0].icon).toEqual({ color: '#123456', glyph: 'T' });
    expect(legacy.rules[0].icon).toEqual({ color: '#123456', letter: 'T' });
  });
  it('normalizes an existing v2 state idempotently', () => {
    const state = migrateState({ version: 2, rules: [valid] });
    expect(migrateState(state)).toEqual(state);
  });
  it.each([
    { version: 3, rules: [] }, { version: 2, rules: 'broken' }, { version: 2, rules: [valid, valid] },
    { version: 1, rules: [{ ...valid, icon: { letter: 'T' } }] }, { version: 2, rules: [{ ...valid, title: 123 }] },
  ])('rejects malformed or future data instead of silently dropping it %#', value => {
    const original = structuredClone(value);
    expect(() => migrateState(value)).toThrow();
    expect(value).toEqual(original);
  });
});
