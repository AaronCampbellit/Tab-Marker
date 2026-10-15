import { validVersion } from './deployment';

export const HELPER_HOST = 'com.rarity.tabmarker';
export const RELEASE_API = 'https://api.github.com/repos/AaronCampbellit/Tab-Marker/releases/latest';
const REPOSITORY_URL = 'https://github.com/AaronCampbellit/Tab-Marker';
export interface GitHubRelease { version: string; releaseUrl: string; packageUrl: string; sha256: string }
export interface HelperResult {
  ok: boolean; protocol?: number; helperVersion?: string; error?: string;
  report?: { exitCode: number; logPath: string; cleanup: string; results: { status: string }[] };
}
export function compareVersions(a: string, b: string): number {
  if (!validVersion(a) || !validVersion(b)) throw new Error('Invalid extension version.');
  const left = a.split('.').map(Number), right = b.split('.').map(Number);
  for (let i = 0; i < 4; i++) { const difference = (left[i] ?? 0) - (right[i] ?? 0); if (difference) return Math.sign(difference); }
  return 0;
}
export function parseRelease(input: unknown): GitHubRelease {
  const release = input as { tag_name?: unknown; html_url?: unknown; draft?: unknown; prerelease?: unknown; assets?: unknown } | null;
  if (!release || typeof release.tag_name !== 'string' || !/^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(release.tag_name)
    || !validVersion(release.tag_name.slice(1)) || release.draft !== false || release.prerelease !== false || !Array.isArray(release.assets)) throw new Error('GitHub has no usable stable release.');
  const version = release.tag_name.slice(1), releaseUrl = `${REPOSITORY_URL}/releases/tag/v${version}`;
  if (release.html_url !== releaseUrl) throw new Error('Unexpected release repository.');
  const filename = `TabMarker-Chrome-${version}.zip`, packageUrl = `${REPOSITORY_URL}/releases/download/v${version}/${filename}`;
  const packages = release.assets.filter(asset => asset?.name === filename && asset.state === 'uploaded');
  const metadata = release.assets.filter(asset => asset?.name === 'release.json' && asset.state === 'uploaded');
  if (packages.length !== 1 || metadata.length !== 1 || packages[0].browser_download_url !== packageUrl
    || !/^sha256:[0-9a-f]{64}$/.test(packages[0].digest ?? '') || packages[0].size <= 0 || packages[0].size > 104857600
    || metadata[0].browser_download_url !== `${REPOSITORY_URL}/releases/download/v${version}/release.json`
    || !/^sha256:[0-9a-f]{64}$/.test(metadata[0].digest ?? '')) throw new Error('The release is still being prepared. Try again later.');
  return { version, releaseUrl, packageUrl, sha256: packages[0].digest.slice(7) };
}
const CACHE_KEY = 'tabmarker.githubReleaseCheck';
export async function latestRelease(force = false): Promise<{ release: GitHubRelease; checkedAt: number }> {
  const cached = (await chrome.storage.local.get(CACHE_KEY))[CACHE_KEY] as { data?: unknown; checkedAt?: number } | undefined;
  if (!force && typeof cached?.checkedAt === 'number' && cached.checkedAt <= Date.now() && Date.now() - cached.checkedAt < 3_600_000) {
    try { return { release: parseRelease(cached.data), checkedAt: cached.checkedAt }; } catch { /* Re-fetch invalid cache. */ }
  }
  const response = await fetch(RELEASE_API, { headers: { Accept: 'application/vnd.github+json' }, cache: 'no-store', signal: AbortSignal.timeout(20_000) });
  if (!response.ok) throw new Error(response.status === 403 || response.status === 429 ? 'GitHub is limiting update checks. Try again later.' : 'Could not check GitHub. Try again when you are online.');
  const data: unknown = await response.json(), release = parseRelease(data), checkedAt = Date.now();
  await chrome.storage.local.set({ [CACHE_KEY]: { data, checkedAt } });
  return { release, checkedAt };
}
export function personalizeInstaller(template: string, extensionId: string): string {
  if (!/^[a-p]{32}$/.test(extensionId) || template.split('__TABMARKER_EXTENSION_ID__').length !== 2) throw new Error('Could not prepare this installation’s helper setup.');
  return template.replace('__TABMARKER_EXTENSION_ID__', extensionId);
}
export function callHelper(action: 'status' | 'update', version?: string, progress: (text: string) => void = () => undefined): Promise<HelperResult> {
  return new Promise((resolve, reject) => {
    const port = chrome.runtime.connectNative(HELPER_HOST);
    let complete = false;
    port.onMessage.addListener((message: { kind?: string; message?: unknown; result?: HelperResult }) => {
      if (message.kind === 'progress' && typeof message.message === 'string') progress(message.message);
      if (message.kind === 'complete' && message.result && typeof message.result.ok === 'boolean') {
        complete = true; resolve(message.result); port.disconnect();
      }
    });
    port.onDisconnect.addListener(() => {
      const detail = chrome.runtime.lastError?.message;
      if (!complete) reject(new Error(detail || 'The helper disconnected. Check the connection and its run log.'));
    });
    port.postMessage(action === 'update' ? { action, version } : { action });
  });
}
