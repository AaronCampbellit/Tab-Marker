/** File handles stay in extension-owned IndexedDB; they cannot cross runtime JSON messages. */
export type BackupFileHandle = FileSystemFileHandle & {
  queryPermission(options: { mode: 'readwrite' }): Promise<PermissionState>;
  requestPermission(options: { mode: 'readwrite' }): Promise<PermissionState>;
};
export type BackupPickerWindow = Window & {
  showSaveFilePicker?: (options: { suggestedName: string; types: { description: string; accept: Record<string, string[]> }[] }) => Promise<BackupFileHandle>;
};

export async function backupHandle(operation: 'get'): Promise<BackupFileHandle | null>;
export async function backupHandle(operation: 'set', handle: BackupFileHandle): Promise<void>;
export async function backupHandle(operation: 'delete'): Promise<void>;
export async function backupHandle(operation: 'get' | 'set' | 'delete', handle?: BackupFileHandle): Promise<BackupFileHandle | null | void> {
  if (typeof indexedDB === 'undefined') {
    if (operation === 'get') return null;
    throw new Error('File backup storage is unavailable. Download a backup instead.');
  }
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const opening = indexedDB.open('tabmarker.backup', 1);
    opening.onupgradeneeded = () => opening.result.createObjectStore('files');
    opening.onsuccess = () => resolve(opening.result);
    opening.onerror = () => reject(new Error('Could not access the backup file connection.'));
  });
  try {
    return await new Promise<BackupFileHandle | null | void>((resolve, reject) => {
      const transaction = db.transaction('files', operation === 'get' ? 'readonly' : 'readwrite');
      const store = transaction.objectStore('files');
      const request = operation === 'get' ? store.get('backup') : operation === 'set' ? store.put(handle, 'backup') : store.delete('backup');
      transaction.oncomplete = () => resolve(operation === 'get' ? request.result ?? null : undefined);
      transaction.onerror = transaction.onabort = () => reject(new Error('Could not save the backup file connection.'));
    });
  } finally { db.close(); }
}
