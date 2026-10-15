import { describe, expect, it } from 'vitest';
import { addSnapshot, mergeBackup, parseBackup, serializeBackup } from '../../src/core/backups';
import type { Rule, StoredState } from '../../src/shared/types';

const rule: Rule = { id: 'one', scope: 'pattern', match: 'https://ww*.autotask.net/*?view=inventory-order*', enabled: true, title: 'Orders', icon: { color: '#c62828', glyph: 'O' }, createdAt: 1, updatedAt: 2 };
const state: StoredState = { version: 4, rules: [rule] };

describe('backup integrity and recovery', () => {
  it('round-trips Unicode labels, query wildcards, disabled rules, and original-icon choices', () => {
    const original: StoredState = { version: 4, rules: [rule, { ...rule, id: 'two', title: 'Facturación é', icon: null, enabled: false }] };
    expect(parseBackup(serializeBackup(original, '0.4.0'))).toEqual(original);
  });
  it.each(['not json', 'null', '{}', '{"format":"tabmarker-backup","version":2,"state":{}}', '{"format":"tabmarker-backup","version":1,"state":{"version":5,"rules":[]}}'])('rejects malformed or unsupported backups: %s', text => {
    expect(() => parseBackup(text)).toThrow();
  });
  it('rejects a bad rule or duplicate ID without returning a partial restore', () => {
    for (const rules of [[rule, { ...rule, id: 'bad', title: 'bad\nlabel' }], [rule, rule]]) {
      expect(() => parseBackup(JSON.stringify({ format: 'tabmarker-backup', version: 1, state: { version: 4, rules } }))).toThrow();
    }
  });
  it('validates the entire import size in UTF-8 bytes', () => {
    expect(() => parseBackup('é'.repeat(16 * 1024 * 1024 + 1))).toThrow('smaller than 32 MB');
  });
  it('merges without replacing existing rules and disables conflicting imports', () => {
    const incoming = [{ ...rule, title: 'New title' }, { ...rule, id: 'same-target' }, { ...rule, id: 'other', match: 'https://example.com/*' }];
    let id = 0;
    const result = mergeBackup([rule], incoming, () => `new-${++id}`);
    expect(result).toEqual([rule, { ...incoming[0], id: 'new-1', enabled: false }, { ...incoming[1], id: 'new-2', enabled: false }, incoming[2]]);
    expect(mergeBackup([rule], [rule])).toEqual([rule]);
    expect(rule.enabled).toBe(true);
  });
  it('keeps ten recent distinct states, ignores damaged history and never mutates earlier snapshots', () => {
    let history = addSnapshot([null, { id: 'bad', state: { version: 5, rules: [] }, createdAt: 1 }], state);
    const first = history[0];
    expect(addSnapshot(history, state)).toEqual(history);
    for (let i = 0; i < 15; i++) history = addSnapshot(history, { version: 4, rules: [{ ...rule, title: `Title ${i}` }] });
    expect(history).toHaveLength(10);
    expect(history[0].state.rules[0].title).toBe('Title 14');
    expect(first.state).toEqual(state);
  });
  it('limits recovery history to 1 MB without truncating rule records', () => {
    const large: StoredState = { version: 4, rules: Array.from({ length: 400 }, (_, i) => ({ ...rule, id: String(i), match: `https://example.com/${'x'.repeat(3900)}` })) };
    expect(addSnapshot([], large)).toEqual([]);
  });
});
