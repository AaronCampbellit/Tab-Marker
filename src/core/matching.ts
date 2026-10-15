import type { Rule } from '../shared/types';
import { normalizeDomain, normalizeMatchingUrl, normalizeUrl, patternMatches } from './normalization';
import { getAutotaskView } from '../integrations/autotask-routing';

const SCOPE_PRIORITY = { exact: 3, pattern: 2, domain: 1 } as const;

/** Stable across service-worker restarts and storage insertion order. */
export function findMatchingRule(rules: readonly Rule[], input: string): Rule | null {
  const normalized = normalizeUrl(input);
  if (!normalized) return null;
  const hostname = new URL(normalized).hostname;
  const candidates = rules.filter(rule => {
    if (!rule.enabled) return false;
    if (rule.scope === 'exact') {
      return getAutotaskView(rule.match)
        ? normalizeMatchingUrl(rule.match) === normalizeMatchingUrl(input)
        : normalizeUrl(rule.match) === normalized;
    }
    if (rule.scope === 'pattern') return patternMatches(rule.match, normalized);
    if (rule.scope !== 'domain') return false;
    try {
      const domain = normalizeDomain(rule.match);
      return hostname === domain || hostname.endsWith(`.${domain}`);
    } catch {
      return false;
    }
  });
  candidates.sort((left, right) => {
    const scope = SCOPE_PRIORITY[right.scope] - SCOPE_PRIORITY[left.scope];
    if (scope) return scope;
    if (left.scope === 'exact' && right.scope === 'exact') {
      const viewSpecificity = Number(Boolean(getAutotaskView(right.match))) - Number(Boolean(getAutotaskView(left.match)));
      if (viewSpecificity) return viewSpecificity;
    }
    if (left.scope === 'pattern' && right.scope === 'pattern') {
      const specificity = right.match.replaceAll('*', '').length - left.match.replaceAll('*', '').length;
      if (specificity) return specificity;
    }
    const recency = right.updatedAt - left.updatedAt;
    if (recency) return recency;
    return left.id < right.id ? -1 : left.id > right.id ? 1 : 0;
  });
  return candidates[0] ?? null;
}
