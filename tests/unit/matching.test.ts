import { describe, expect, it } from 'vitest';
import type { Rule } from '../../src/shared/types';
import { findMatchingRule } from '../../src/core/matching';

function rule(id: string, scope: Rule['scope'], match: string, updatedAt = 100): Rule {
  return { id, scope, match, title: id, icon: null, enabled: true, createdAt: 1, updatedAt };
}

describe('deterministic matching priority', () => {
  const domain = rule('domain', 'domain', 'example.com', 500);
  const pattern = rule('pattern', 'pattern', 'https://example.com/Module/*', 400);
  const exact = rule('exact', 'exact', 'https://example.com/Module/view', 2);
  it('prefers exact URLs over patterns over domains, regardless of recency', () => {
    expect(findMatchingRule([domain, pattern, exact], 'https://example.com/Module/view?ticket=secret#customer')?.id).toBe('exact');
    expect(findMatchingRule([domain, pattern], 'https://example.com/Module/view')?.id).toBe('pattern');
    expect(findMatchingRule([domain, pattern], 'https://example.com/Elsewhere')?.id).toBe('domain');
  });
  it('prefers the pattern with most non-wildcard characters', () => {
    const broad = rule('broad', 'pattern', '*://*.example.com/*', 500);
    const specific = rule('specific', 'pattern', 'https://example.com/Module/*', 100);
    expect(findMatchingRule([broad, specific], 'https://example.com/Module/view')?.id).toBe('specific');
  });
  it('breaks equal specificity ties by updatedAt, then ascending id', () => {
    const old = rule('old', 'exact', exact.match, 20);
    const latest = rule('z', 'exact', exact.match, 40);
    const alphabetic = rule('a', 'exact', exact.match, 40);
    expect(findMatchingRule([latest, old], exact.match)?.id).toBe('z');
    expect(findMatchingRule([latest, alphabetic], exact.match)?.id).toBe('a');
    expect(findMatchingRule([alphabetic, latest], exact.match)?.id).toBe('a');
  });
  it('ignores disabled rules', () => {
    expect(findMatchingRule([domain, { ...exact, enabled: false }], exact.match)?.id).toBe('domain');
  });
  it('matches domains at dot boundaries and across ports', () => {
    expect(findMatchingRule([domain], 'https://sub.example.com:8443/view')?.id).toBe('domain');
    expect(findMatchingRule([domain], 'https://notexample.com/view')).toBeNull();
    expect(findMatchingRule([domain], 'https://example.com.attacker.test/view')).toBeNull();
  });
  it('does not mutate input order', () => {
    const input = [domain, pattern, exact];
    findMatchingRule(input, exact.match);
    expect(input.map(item => item.id)).toEqual(['domain', 'pattern', 'exact']);
  });
  it('returns null for unsupported pages and absent matches', () => {
    expect(findMatchingRule([domain], 'chrome://settings')).toBeNull();
    expect(findMatchingRule([], exact.match)).toBeNull();
    expect(findMatchingRule([domain], 'https://other.test/')).toBeNull();
  });
});
