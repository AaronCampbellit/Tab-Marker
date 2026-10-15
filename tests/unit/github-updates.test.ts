import { afterEach, describe, expect, it, vi } from 'vitest';
import { callHelper, compareVersions, latestRelease, parseRelease, personalizeInstaller, RELEASE_API } from '../../src/shared/github-updates';

const repo = 'https://github.com/AaronCampbellit/Tab-Marker';
function release(version = '0.4.9') {
  return { tag_name: `v${version}`, html_url: `${repo}/releases/tag/v${version}`, draft: false, prerelease: false, assets: [
    { name: `TabMarker-Chrome-${version}.zip`, state: 'uploaded', browser_download_url: `${repo}/releases/download/v${version}/TabMarker-Chrome-${version}.zip`, size: 5000, digest: `sha256:${'a'.repeat(64)}` },
    { name: 'release.json', state: 'uploaded', browser_download_url: `${repo}/releases/download/v${version}/release.json`, digest: `sha256:${'b'.repeat(64)}` },
  ] };
}
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });
describe('GitHub update selection', () => {
  it('uses a completed built release with the fixed repository and digest', () => {
    expect(parseRelease(release())).toEqual({ version: '0.4.9', releaseUrl: `${repo}/releases/tag/v0.4.9`, packageUrl: `${repo}/releases/download/v0.4.9/TabMarker-Chrome-0.4.9.zip`, sha256: 'a'.repeat(64) });
  });
  it.each(['draft', 'prerelease'] as const)('rejects %s releases', field => { expect(() => parseRelease({ ...release(), [field]: true })).toThrow(); });
  it.each(['0.4.9-beta', '00.4.9', '0.4.65536'])('rejects incompatible release version %s', version => { expect(() => parseRelease(release(version))).toThrow(); });
  it('rejects a different repository or arbitrary asset URL', () => {
    expect(() => parseRelease({ ...release(), html_url: 'https://github.com/somebody/other' })).toThrow();
    const data = release(); data.assets[0].browser_download_url = 'https://example.com/replacement.zip'; expect(() => parseRelease(data)).toThrow();
  });
  it('rejects incomplete, duplicate or oversized packages and missing digests', () => {
    const missing = release(); missing.assets.pop(); expect(() => parseRelease(missing)).toThrow();
    const duplicate = release(); duplicate.assets.push(duplicate.assets[0]); expect(() => parseRelease(duplicate)).toThrow();
    const digest = release(); digest.assets[0].digest = ''; expect(() => parseRelease(digest)).toThrow();
    const huge = release(); huge.assets[0].size = 104857601; expect(() => parseRelease(huge)).toThrow();
  });
  it('compares numeric versions and does not treat a rollback as an available update', () => {
    expect(compareVersions('0.4.10', '0.4.9')).toBe(1);
    expect(compareVersions('0.4.7', '0.4.8')).toBe(-1);
    expect(compareVersions('0.4.8', '0.4.8.0')).toBe(0);
    expect(() => compareVersions('broken', '0.4.8')).toThrow();
  });
  it('personalizes only a validated extension ID in the bundled script', () => {
    expect(personalizeInstaller("$id='__TABMARKER_EXTENSION_ID__'", 'a'.repeat(32))).toBe(`$id='${'a'.repeat(32)}'`);
    expect(() => personalizeInstaller('__TABMARKER_EXTENSION_ID__', "'; Start-Process calc; '")).toThrow();
    expect(() => personalizeInstaller('missing token', 'a'.repeat(32))).toThrow();
    expect(() => personalizeInstaller('__TABMARKER_EXTENSION_ID____TABMARKER_EXTENSION_ID__', 'a'.repeat(32))).toThrow();
  });
  it('caches validated checks for an hour and allows explicit refresh', async () => {
    const storage: Record<string, unknown> = {};
    const get = vi.fn(async (key: string) => ({ [key]: storage[key] }));
    const set = vi.fn(async (value: Record<string, unknown>) => { Object.assign(storage, value); });
    vi.stubGlobal('chrome', { storage: { local: { get, set } } });
    const fetch = vi.fn(async (_url: string) => ({ ok: true, json: async () => release() })); vi.stubGlobal('fetch', fetch);
    await latestRelease(); await latestRelease(); expect(fetch).toHaveBeenCalledTimes(1);
    await latestRelease(true); expect(fetch).toHaveBeenCalledTimes(2);
    expect(fetch.mock.calls[0][0]).toBe(RELEASE_API);
  });
  it('reports rate limiting rather than declaring the installation current', async () => {
    vi.stubGlobal('chrome', { storage: { local: { get: async () => ({}) } } });
    vi.stubGlobal('fetch', async () => ({ ok: false, status: 429 }));
    await expect(latestRelease()).rejects.toThrow('limiting update checks');
  });
  it('sends only the limited update action and expected version to the native host', async () => {
    let onMessage: (value: unknown) => void = () => undefined;
    let onDisconnect: () => void = () => undefined;
    const disconnect = vi.fn(() => onDisconnect());
    const postMessage = vi.fn(() => onMessage({ kind: 'complete', result: { ok: true, protocol: 1 } }));
    const connectNative = vi.fn(() => ({ onMessage: { addListener: (fn: typeof onMessage) => { onMessage = fn; } }, onDisconnect: { addListener: (fn: () => void) => { onDisconnect = fn; } }, postMessage, disconnect }));
    vi.stubGlobal('chrome', { runtime: { connectNative } });
    await expect(callHelper('update', '0.4.9')).resolves.toEqual({ ok: true, protocol: 1 });
    expect(connectNative).toHaveBeenCalledWith('com.rarity.tabmarker');
    expect(postMessage).toHaveBeenCalledWith({ action: 'update', version: '0.4.9' }); expect(disconnect).toHaveBeenCalledOnce();
  });
});
