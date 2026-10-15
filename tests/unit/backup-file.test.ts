import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { StoredState } from '../../src/shared/types';
import { fileStatus, syncFile } from '../../src/background/backups';

const mocks = vi.hoisted(() => ({ getHandle: vi.fn() }));
vi.mock('../../src/shared/backup-file', () => ({ backupHandle: mocks.getHandle }));
const state: StoredState = { version: 4, rules: [] };

describe('linked backup file failures', () => {
  afterEach(() => vi.unstubAllGlobals());
  let local: Record<string, unknown>;
  let handle: {
    name: string;
    queryPermission: ReturnType<typeof vi.fn>;
    getFile: ReturnType<typeof vi.fn>;
    createWritable: ReturnType<typeof vi.fn>;
  };
  let stream: { write: ReturnType<typeof vi.fn>; close: ReturnType<typeof vi.fn>; abort: ReturnType<typeof vi.fn> };
  beforeEach(() => {
    vi.resetAllMocks();
    local = {};
    stream = { write: vi.fn(async () => undefined), close: vi.fn(async () => undefined), abort: vi.fn(async () => undefined) };
    handle = { name: 'backup.json', queryPermission: vi.fn(async () => 'granted'), getFile: vi.fn(async () => ({ size: 100, lastModified: 1 })), createWritable: vi.fn(async () => stream) };
    mocks.getHandle.mockResolvedValue(handle);
    vi.stubGlobal('chrome', { runtime: { getManifest: () => ({ version: '0.4.0' }) }, storage: { local: {
      get: async (key: string) => ({ [key]: local[key] }),
      set: async (values: Record<string, unknown>) => Object.assign(local, values),
    } } });
  });
  it('reports synced only after the stream closes successfully', async () => {
    await syncFile(state);
    expect(stream.write).toHaveBeenCalledWith(expect.stringContaining('tabmarker-backup'));
    expect(stream.close).toHaveBeenCalledOnce();
    expect((await fileStatus(state)).state).toBe('synced');
  });
  it('does not write without permission and reports reconnection is needed', async () => {
    handle.queryPermission.mockResolvedValue('prompt');
    await syncFile(state);
    expect(handle.createWritable).not.toHaveBeenCalled();
    expect((await fileStatus(state)).state).toBe('permission');
  });
  it.each(['write', 'close'] as const)('preserves rule-save success, aborts the stream and reports failure when %s fails', async method => {
    stream[method].mockRejectedValue(new Error('Private /device/path cannot be written'));
    await expect(syncFile(state)).resolves.toBeUndefined();
    expect(stream.abort).toHaveBeenCalledOnce();
    expect((await fileStatus(state)).state).toBe('error');
    expect(JSON.stringify(local)).not.toContain('/device/path');
  });
  it('detects a removed file even when browser write permission remains granted', async () => {
    await syncFile(state);
    handle.getFile.mockRejectedValue(new Error('not found'));
    expect((await fileStatus(state)).state).toBe('error');
  });
  it('detects stale rules and protects an externally modified file until explicit sync', async () => {
    await syncFile(state);
    const changed: StoredState = { version: 4, rules: [{ id: 'new', enabled: true, scope: 'domain', match: 'example.com', title: 'New rule', icon: null, createdAt: 1, updatedAt: 1 }] };
    expect((await fileStatus(changed)).state).toBe('pending');
    handle.getFile.mockResolvedValue({ size: 200, lastModified: 2 });
    expect((await fileStatus(state)).message).toContain('changed outside');
    stream.write.mockClear();
    await syncFile(changed);
    expect(stream.write).not.toHaveBeenCalled();
    await syncFile(changed, true);
    expect(stream.write).toHaveBeenCalledOnce();
    expect((await fileStatus(changed)).state).toBe('synced');
  });
  it('a lost file connection never rejects an otherwise successful rule save', async () => {
    mocks.getHandle.mockRejectedValue(new Error('IndexedDB unavailable'));
    await expect(syncFile(state)).resolves.toBeUndefined();
    expect((await fileStatus(state)).state).toBe('error');
  });
});
