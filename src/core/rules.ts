import type { Customization, Rule, StoredState } from '../shared/types';
import { normalizeDomain, normalizeMatchingUrl, normalizePattern, normalizeUrl } from './normalization';
import { validateIcon } from './icon';

const CONTROLS = /[\u0000-\u001f\u007f-\u009f]/;
const INVISIBLE_FORMATTING = /[\u200b\u200e\u200f\u202a-\u202e\u2060-\u206f\ufeff]/;

function object(value: unknown, description: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error(`${description} must be an object.`);
  return value as Record<string, unknown>;
}

export function validateCustomization(value: unknown): Customization {
  const customization = object(value, 'Customization');
  if (customization.title !== null && typeof customization.title !== 'string') {
    throw new Error('A title must be text or null.');
  }
  const title = typeof customization.title === 'string' ? customization.title.trim() || null : null;
  if (typeof customization.title === 'string' && (CONTROLS.test(customization.title) || INVISIBLE_FORMATTING.test(customization.title) || customization.title.length > 120)) {
    throw new Error('A title must contain at most 120 characters and no control characters.');
  }
  const icon = customization.icon === null ? null : validateIcon(customization.icon);
  if (title === null && icon === null) throw new Error('Set a title or an icon.');
  return { title, icon };
}

export function normalizeRule(value: unknown): Rule {
  const rule = object(value, 'Rule');
  if (typeof rule.id !== 'string' || !rule.id.trim() || rule.id !== rule.id.trim() || rule.id.length > 100 || CONTROLS.test(rule.id)) {
    throw new Error('A rule needs an identifier of at most 100 characters.');
  }
  if (typeof rule.enabled !== 'boolean') throw new Error('A rule must have an enabled status.');
  if (rule.scope !== 'exact' && rule.scope !== 'pattern' && rule.scope !== 'domain') throw new Error('Unknown rule scope.');
  if (typeof rule.match !== 'string' || rule.match.length > 4096) throw new Error('A rule needs a matching URL, pattern, or domain of at most 4096 characters.');
  let match: string | null;
  if (rule.scope === 'exact') match = normalizeMatchingUrl(rule.match);
  else if (rule.scope === 'pattern') match = normalizePattern(rule.match);
  else match = normalizeDomain(rule.match);
  if (!match) throw new Error('Exact rules require an HTTP or HTTPS URL.');
  if (!Number.isSafeInteger(rule.createdAt) || (rule.createdAt as number) < 0 || !Number.isSafeInteger(rule.updatedAt) || (rule.updatedAt as number) < (rule.createdAt as number)) {
    throw new Error('Rule timestamps must be non-negative integers; updatedAt must not precede createdAt.');
  }
  return {
    id: rule.id,
    enabled: rule.enabled,
    scope: rule.scope,
    match,
    ...validateCustomization(rule),
    createdAt: rule.createdAt as number,
    updatedAt: rule.updatedAt as number,
  };
}

/** Never reset corrupt or newer data: callers can report the error and preserve it. */
export function migrateState(value: unknown): StoredState {
  if (value === null || value === undefined) return { version: 3, rules: [] };
  const state = object(value, 'Saved state');
  if (state.version !== 1 && state.version !== 2 && state.version !== 3) {
    throw new Error('This saved data uses an unsupported schema version. It has been preserved.');
  }
  if (!Array.isArray(state.rules)) throw new Error('Saved rules are invalid. The saved data has been preserved.');
  const rules = state.rules.map(value => {
    if (state.version === 3) return normalizeRule(value);
    const legacy = object(value, 'Legacy rule');
    let icon = legacy.icon;
    if (state.version === 1 && icon !== null && typeof icon === 'object' && !Array.isArray(icon)) {
      const legacyIcon = icon as Record<string, unknown>;
      if (typeof legacyIcon.letter === 'string' && legacyIcon.glyph === undefined) {
        icon = { color: legacyIcon.color, glyph: legacyIcon.letter };
      }
    }
    // Earlier versions always ignored queries. Preserve their path-only behavior.
    const match = legacy.scope === 'exact' && typeof legacy.match === 'string'
      ? normalizeUrl(legacy.match) : legacy.match;
    return normalizeRule({ ...legacy, match, icon });
  });
  if (new Set(rules.map(rule => rule.id)).size !== rules.length) {
    throw new Error('Saved rules contain duplicate identifiers. The saved data has been preserved.');
  }
  return { version: 3, rules };
}

export { createFavicon } from './favicon';
export { validateIcon } from './icon';
