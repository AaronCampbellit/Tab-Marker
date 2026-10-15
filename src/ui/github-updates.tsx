import { useCallback, useEffect, useRef, useState } from 'react';
import { callHelper, compareVersions, latestRelease, type GitHubRelease, type HelperResult } from '../shared/github-updates';
import { readDeployment } from '../shared/deployment';
import { helperSetupArchive, HELPER_SETUP_NAME } from '../shared/helper-setup';

export function GitHubUpdates({ busy, hasUnsavedChanges }: { busy: boolean; hasUnsavedChanges: () => boolean }) {
  const [windows, setWindows] = useState<boolean | null>(null);
  const [helper, setHelper] = useState<HelperResult | null>(null);
  const [connection, setConnection] = useState('Checking helper connection…');
  const [release, setRelease] = useState<GitHubRelease | null>(null);
  const [checkedAt, setCheckedAt] = useState<number | null>(null);
  const [working, setWorking] = useState('');
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [logPath, setLogPath] = useState('');
  const connectionSequence = useRef(0);
  const running = chrome.runtime.getManifest().version;
  const connected = helper?.ok && helper.protocol === 1;
  const available = release && compareVersions(release.version, running) > 0;
  const checkConnection = useCallback(async () => {
    const sequence = ++connectionSequence.current;
    setConnection('Checking helper connection…');
    try {
      const result = await callHelper('status');
      if (sequence !== connectionSequence.current) return;
      setHelper(result);
      setConnection(result.ok && result.protocol === 1 ? `Helper connected · v${result.helperVersion}` : result.error || 'Reinstall the helper to connect this TabMarker installation.');
    } catch (cause) { if (sequence !== connectionSequence.current) return; setHelper(null); const detail = cause instanceof Error ? cause.message : ''; setConnection(/host not found/i.test(detail) ? 'Helper not connected yet.' : `Helper not connected. ${detail || 'Try Check connection again.'}`); }
  }, []);
  const checkRelease = useCallback(async (force = false) => {
    try { const next = await latestRelease(force); setRelease(next.release); setCheckedAt(next.checkedAt); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not check GitHub for updates.'); }
  }, []);
  useEffect(() => {
    void checkRelease();
    let active = true, isWindows = false;
    void chrome.runtime.getPlatformInfo().then(platform => { if (!active) return; isWindows = platform.os === 'win'; setWindows(isWindows); if (isWindows) void checkConnection(); else setConnection('The update helper is available for Windows.'); });
    const focused = () => { if (isWindows) void checkConnection(); };
    window.addEventListener('focus', focused);
    return () => { active = false; window.removeEventListener('focus', focused); };
  }, [checkConnection, checkRelease]);
  async function task(name: string, operation: () => Promise<void>) {
    setWorking(name); setError(''); setNotice('');
    try { await operation(); } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not complete this step.'); }
    finally { setWorking(''); }
  }
  async function downloadHelper() {
    const [script, launcher] = await Promise.all(['helper/Install-TabMarkerHelper.ps1', 'helper/Install TabMarker Helper.cmd'].map(async file => {
      const response = await fetch(chrome.runtime.getURL(file));
      if (!response.ok) throw new Error('Helper setup is missing. Reinstall the latest built TabMarker package.');
      return response.text();
    }));
    const archive = helperSetupArchive(script, launcher, chrome.runtime.id);
    const url = URL.createObjectURL(new Blob([archive], { type: 'application/zip' }));
    try { await chrome.downloads.download({ url, filename: HELPER_SETUP_NAME, saveAs: true }); }
    finally { setTimeout(() => URL.revokeObjectURL(url), 60_000); }
    setNotice('ZIP ready. Choose Extract All, then double-click Install TabMarker Helper.cmd.');
  }
  async function update() {
    if (!release) return;
    if (hasUnsavedChanges()) throw new Error('Save or cancel your rule edits before installing an update.');
    const local = await readDeployment();
    if (local.kind === 'ready') throw new Error('An update is already installed. Use Reload TabMarker above first.');
    if (local.kind === 'applying') throw new Error('An update is already in progress. Wait for it to finish.');
    setNotice('Installing update… Keep this Settings page open.');
    const result = await callHelper('update', release.version, text => {
      if (text.includes('[Cleanup]')) setNotice('Finishing update and cleaning temporary files…');
    });
    if (result.report?.logPath) setLogPath(result.report.logPath);
    window.dispatchEvent(new Event('tabmarker-deployment-changed'));
    if (!result.ok) throw new Error(result.error || 'Update failed. Review the run log.');
    setNotice('Update installed. Use “Update installed — Reload TabMarker” above, then refresh your website tabs.');
  }
  const disabled = busy || !!working;
  return <section id="updates" className="panel mt-7 scroll-mt-5 p-5" aria-labelledby="updates-heading" aria-busy={!!working}>
    <div className="flex flex-wrap items-start justify-between gap-3"><div><h2 id="updates-heading" className="text-lg font-bold text-slate-900">TabMarker updates</h2><p className="hint">Check GitHub for new releases and update this installation.</p></div><span className="badge">Running v{running}</span></div>
    <p className="mt-4 text-sm font-semibold text-slate-800" role="status">{available ? `Version ${release.version} is available` : release ? 'You’re up to date with the latest published release' : error ? 'Update check unavailable' : 'Checking GitHub for a release…'}</p>
    {checkedAt && <p className="hint">Last checked {new Date(checkedAt).toLocaleString()}. {release && <a className="text-button text-xs" href={release.releaseUrl} target="_blank" rel="noreferrer">Release notes ↗</a>}</p>}
    <div className="mt-3 flex flex-wrap gap-2"><button type="button" className="secondary" disabled={disabled} onClick={() => void task('check', () => checkRelease(true))}>{working === 'check' ? 'Checking…' : 'Check for updates'}</button>{available && <button type="button" className="primary" disabled={disabled || !connected || !windows} onClick={() => void task('update', update)}>{working === 'update' ? 'Installing…' : `Install v${release.version}`}</button>}</div>
    <div className="mt-5 border-t border-slate-200 pt-4"><h3 className="text-sm font-bold text-slate-800">Windows update helper</h3><p className="hint" role="status">{connection}</p>
      {windows && <><div className="mt-3 flex flex-wrap gap-2"><button type="button" className={connected ? 'secondary' : 'primary'} disabled={disabled} onClick={() => void task('download', downloadHelper)}>{connected ? 'Download helper installer again' : 'Install helper'}</button><button type="button" className="secondary" disabled={disabled} onClick={() => void task('connection', checkConnection)}>Check connection</button></div>
        {!connected && <ol className="mt-4 list-decimal space-y-2 pl-5 text-sm text-slate-600"><li>Download the ZIP and choose <strong>Extract All</strong>.</li><li>Open the extracted folder. Double-click <strong>Install TabMarker Helper.cmd</strong>.</li><li>Return here. The helper connects automatically.</li></ol>}
      </>}
    </div>
    {notice && <p className="mt-4 text-sm text-slate-700" role="status">{notice}</p>}
    {error && <p className="mt-4 text-sm text-rose-700" role="alert">{error}</p>}
    {logPath && <p className="hint break-all">Update log: {logPath}</p>}
    <p className="hint mt-4">Saved rules stay. Reload TabMarker after updating, then refresh your website tabs.</p>
  </section>;
}
