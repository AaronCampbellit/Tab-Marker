import { describe, expect, it, vi, afterEach } from 'vitest';
import { deploymentState, readDeployment } from '../../src/shared/deployment';

const manifest = { name: 'TabMarker', manifest_version: 3, version: '0.4.5' };
const marker = { schemaVersion: 1, product: 'TabMarker', state: 'ready', version: '0.4.5' };
describe('RMM deployment status', () => {
  afterEach(() => vi.unstubAllGlobals());
  it('offers reload only for a complete deployment of a different version', () => {
    expect(deploymentState('0.4.4', manifest, marker)).toEqual({ kind: 'ready', running: '0.4.4', installed: '0.4.5' });
    expect(deploymentState('0.4.5', manifest, marker).kind).toBe('current');
    expect(deploymentState('0.4.6', manifest, marker).kind).toBe('ready'); // intentional rollback
  });
  it('blocks reload during installation, even before the manifest changes', () => {
    expect(deploymentState('0.4.4', null, { ...marker, state: 'applying' }).kind).toBe('applying');
  });
  it.each([
    [manifest, null], [manifest, { ...marker, version: '0.4.6' }],
    [manifest, { ...marker, state: 'failed' }], [manifest, { ...marker, product: 'Other' }],
    [{ ...manifest, name: 'Other' }, marker], [{ ...manifest, version: 'broken' }, marker],
    [{ ...manifest, version: '99999' }, { ...marker, version: '99999' }],
  ])('does not offer reload for missing, partial or invalid metadata', (disk, status) => {
    expect(deploymentState('0.4.4', disk, status).kind).toBe('unavailable');
  });
  it('reads disk metadata without cache and uses Chrome loaded version', async () => {
    vi.stubGlobal('chrome', { runtime: { getManifest: () => ({ version: '0.4.4' }), getURL: (file: string) => `chrome-extension://test/${file}` } });
    const fetcher = vi.fn().mockResolvedValueOnce({ ok: true, json: async () => manifest }).mockResolvedValueOnce({ ok: true, json: async () => marker });
    vi.stubGlobal('fetch', fetcher);
    expect((await readDeployment()).kind).toBe('ready');
    expect(fetcher.mock.calls[0][1]).toEqual({ cache: 'no-store' });
    fetcher.mockRejectedValue(new Error('not found'));
    expect((await readDeployment()).kind).toBe('unavailable');
  });
});
