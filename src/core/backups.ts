import { migrateState, normalizeRule } from './rules';
import type { Rule, StoredState } from '../shared/types';

export const MAX_BACKUP_BYTES = 32 * 1024 * 1024;
export interface RecoverySnapshot { id: string; createdAt: number; state: StoredState }

export function serializeBackup(state: StoredState, appVersion: string): string {
  return JSON.stringify({ format: 'tabmarker-backup', version: 1, appVersion, createdAt: Date.now(), state: migrateState(state) }, null, 2);
}

export function parseBackup(text: string): StoredState {
  if (typeof text !== 'string' || new TextEncoder().encode(text).length > MAX_BACKUP_BYTES) throw new Error('Choose a TabMarker backup smaller than 32 MB.');
  let value: unknown;
  try { value = JSON.parse(text); } catch { throw new Error('This file is not valid JSON. Your rules have not changed.'); }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('This is not a TabMarker backup.');
  const backup = value as Record<string, unknown>;
  if (backup.format !== 'tabmarker-backup' || backup.version !== 1 || !backup.state || typeof backup.state !== 'object') throw new Error('Unsupported TabMarker backup format. Your rules have not changed.');
  return migrateState(backup.state);
}

/** Merge preserves existing IDs and targets. Conflicting imports get a new ID and are disabled for review. */
export function mergeBackup(current: Rule[], incoming: Rule[], newId: () => string = () => crypto.randomUUID()): Rule[] {
  const result = [...current];
  for (const rule of incoming) {
    const sameId = result.find(item => item.id === rule.id);
    if (sameId && JSON.stringify(normalizeRule(sameId)) === JSON.stringify(normalizeRule(rule))) continue;
    const conflict = sameId || result.find(item => item.scope === rule.scope && item.match === rule.match);
    result.push(conflict ? { ...rule, id: newId(), enabled: false } : rule);
  }
  return result;
}

/** Bounded local undo history; external backups protect against extension/profile removal. */
export function readSnapshots(raw: unknown): RecoverySnapshot[] {
  const snapshots: RecoverySnapshot[] = [];
  for (const entry of Array.isArray(raw) ? raw : []) {
    try {
      if (!entry || typeof entry.id !== 'string' || !Number.isSafeInteger(entry.createdAt) || entry.createdAt < 0 || !entry.state) continue;
      snapshots.push({ id: entry.id, createdAt: entry.createdAt, state: migrateState(entry.state) });
    } catch { /* A damaged recovery entry must not prevent saving otherwise valid rules. */ }
  }
  const bounded: RecoverySnapshot[] = [];
  let bytes = 0;
  for (const snapshot of snapshots.slice(0, 10)) {
    bytes += new TextEncoder().encode(JSON.stringify(snapshot)).length;
    if (bytes > 1024 * 1024) break;
    bounded.push(snapshot);
  }
  return bounded;
}

export function addSnapshot(raw: unknown, state: StoredState): RecoverySnapshot[] {
  const snapshots = readSnapshots(raw);
  const normalized = migrateState(state);
  if (JSON.stringify(snapshots[0]?.state) !== JSON.stringify(normalized)) snapshots.unshift({ id: crypto.randomUUID(), createdAt: Date.now(), state: normalized });
  return readSnapshots(snapshots);
}
