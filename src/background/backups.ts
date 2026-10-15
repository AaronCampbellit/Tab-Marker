import { addSnapshot, readSnapshots, serializeBackup } from '../core/backups';
import type { RecoverySnapshot } from '../core/backups';
import { backupHandle } from '../shared/backup-file';
import type { BackupOverview, BackupStatus, StoredState } from '../shared/types';

export const HISTORY_KEY = 'tabmarker.recovery';
const FILE_STATUS_KEY = 'tabmarker.backupStatus';
interface FileStatus extends BackupStatus { digest?: string; fileSize?: number; fileModifiedAt?: number }

async function digest(state: StoredState): Promise<string> {
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(state))))).map(byte => byte.toString(16).padStart(2, '0')).join('');
}
async function status(): Promise<FileStatus | undefined> {
  const value = (await chrome.storage.local.get(FILE_STATUS_KEY))[FILE_STATUS_KEY] as Partial<FileStatus> | undefined;
  if (!value || !['off', 'synced', 'pending', 'permission', 'error'].includes(value.state ?? '') || typeof value.message !== 'string' || !(value.fileName === null || typeof value.fileName === 'string') || !(value.lastSyncedAt === null || Number.isSafeInteger(value.lastSyncedAt))) return undefined;
  return value as FileStatus;
}
async function saveStatus(next: FileStatus): Promise<void> {
  if (JSON.stringify(await status()) !== JSON.stringify(next)) await chrome.storage.local.set({ [FILE_STATUS_KEY]: next });
}
export async function recoverySnapshots(): Promise<RecoverySnapshot[]> {
  const raw = (await chrome.storage.local.get(HISTORY_KEY))[HISTORY_KEY];
  return readSnapshots(raw);
}
export async function recordBeforeChange(state: StoredState): Promise<RecoverySnapshot[]> {
  return addSnapshot((await chrome.storage.local.get(HISTORY_KEY))[HISTORY_KEY], state);
}
export async function fileStatus(state: StoredState): Promise<BackupStatus> {
  const previous = await status();
  try {
    const handle = await backupHandle('get');
    if (!handle) return { state: 'off', fileName: null, lastSyncedAt: null, message: 'No backup file connected.' };
    if (await handle.queryPermission({ mode: 'readwrite' }) !== 'granted') return { state: 'permission', fileName: handle.name, lastSyncedAt: previous?.lastSyncedAt ?? null, message: 'Allow file access again to resume automatic backups.' };
    const file = await handle.getFile();
    if (previous?.digest && (file.size !== previous.fileSize || file.lastModified !== previous.fileModifiedAt)) return { state: 'error', fileName: handle.name, lastSyncedAt: previous.lastSyncedAt, message: 'Backup file changed outside TabMarker. Keep a copy of that file before using Sync now to replace it.' };
    if (previous?.state === 'error') return { ...previous, fileName: handle.name };
    const synced = previous?.digest === await digest(state);
    return { state: synced ? 'synced' : 'pending', fileName: handle.name, lastSyncedAt: previous?.lastSyncedAt ?? null, message: synced ? 'Backup file is up to date.' : 'Changes are waiting to be backed up. Choose Sync now.' };
  } catch { return { state: 'error', fileName: previous?.fileName ?? null, lastSyncedAt: previous?.lastSyncedAt ?? null, message: 'Backup file is unavailable. Reconnect it or download a backup.' }; }
}
export async function syncFile(state: StoredState, force = false): Promise<void> {
  let previous: FileStatus | undefined;
  let fileName: string | null = null;
  try {
    previous = await status();
    fileName = previous?.fileName ?? null;
    const handle = await backupHandle('get');
    if (!handle) return;
    fileName = handle.name;
    if (await handle.queryPermission({ mode: 'readwrite' }) !== 'granted') {
      await saveStatus({ state: 'permission', fileName, lastSyncedAt: previous?.lastSyncedAt ?? null, message: 'Allow file access again to resume automatic backups.' });
      return;
    }
    if (!force && previous?.digest) {
      const file = await handle.getFile();
      if (file.size !== previous.fileSize || file.lastModified !== previous.fileModifiedAt) {
        await saveStatus({ ...previous, state: 'error', message: 'Backup file changed outside TabMarker. Keep a copy of that file before using Sync now to replace it.' });
        return;
      }
    }
    const revision = await digest(state);
    // Mark pending before opening the stream; a suspended worker cannot leave a false synced status.
    await saveStatus({ state: 'pending', fileName, lastSyncedAt: previous?.lastSyncedAt ?? null, message: 'Writing backup file…' });
    const writable = await handle.createWritable();
    try {
      await writable.write(serializeBackup(state, chrome.runtime.getManifest().version));
      await writable.close();
    } catch (error) { await writable.abort().catch(() => undefined); throw error; }
    const file = await handle.getFile();
    await saveStatus({ state: 'synced', fileName, lastSyncedAt: Date.now(), message: 'Backup file is up to date.', digest: revision, fileSize: file.size, fileModifiedAt: file.lastModified });
  } catch {
    // Keep the saved rules even if the disk is full, removed, or permission is revoked.
    await saveStatus({ state: 'error', fileName, lastSyncedAt: previous?.lastSyncedAt ?? null, message: 'Could not update the backup file. Reconnect it or download a backup.' }).catch(() => undefined);
  }
}
export async function resetFileStatus(): Promise<void> {
  await saveStatus({ state: 'pending', fileName: null, lastSyncedAt: null, message: 'Connecting backup file…' });
}
export async function backupOverview(state: StoredState): Promise<BackupOverview> {
  return { file: await fileStatus(state), snapshots: (await recoverySnapshots()).map(item => ({ id: item.id, createdAt: item.createdAt, ruleCount: item.state.rules.length })) };
}
export async function disconnectFile(): Promise<void> {
  await backupHandle('delete');
  await saveStatus({ state: 'off', fileName: null, lastSyncedAt: null, message: 'No backup file connected.' });
}
