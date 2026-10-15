import { useCallback, useEffect, useState } from 'react';
import { MAX_BACKUP_BYTES, parseBackup } from '../core/backups';
import { backupHandle } from '../shared/backup-file';
import type { BackupPickerWindow } from '../shared/backup-file';
import { request } from '../shared/client';
import type { BackupOverview } from '../shared/types';
import { Feedback } from './components';

export function Backups() {
  const [overview, setOverview] = useState<BackupOverview | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [incoming, setIncoming] = useState<{ text: string; count: number; name: string } | null>(null);
  const [mode, setMode] = useState<'merge' | 'replace'>('merge');
  const [recovery, setRecovery] = useState('');
  const refresh = useCallback(async () => {
    try { setOverview(await request('GET_BACKUPS', {})); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not load backups.'); }
  }, []);
  useEffect(() => {
    void refresh();
    const changed = (_: unknown, area: string) => { if (area === 'local') void refresh(); };
    chrome.storage.onChanged.addListener(changed);
    return () => chrome.storage.onChanged.removeListener(changed);
  }, [refresh]);

  async function run(action: () => Promise<void>) {
    setBusy(true); setError(''); setSuccess('');
    try { await action(); }
    catch (cause) { if (!(cause instanceof DOMException && cause.name === 'AbortError')) setError(cause instanceof Error ? cause.message : 'Could not complete the backup operation.'); }
    finally { setBusy(false); await refresh(); }
  }

  async function connect() {
    const picker = (window as BackupPickerWindow).showSaveFilePicker;
    if (!picker) throw new Error('Automatic file backups are unavailable in this browser. Use Download backup.');
    const handle = await picker.call(window, { suggestedName: 'TabMarker-backup.json', types: [{ description: 'TabMarker backup', accept: { 'application/json': ['.json'] } }] });
    await backupHandle('set', handle);
    setOverview(await request('SYNC_BACKUP', { newConnection: true }));
  }
  async function sync() {
    const handle = await backupHandle('get');
    if (!handle) throw new Error('Choose a backup file first.');
    if (await handle.queryPermission({ mode: 'readwrite' }) !== 'granted' && await handle.requestPermission({ mode: 'readwrite' }) !== 'granted') throw new Error('File access was not granted. Your rules remain saved in Chrome.');
    setOverview(await request('SYNC_BACKUP', {}));
  }
  async function download() {
    const text = await request('EXPORT_BACKUP', {});
    const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
    const anchor = document.createElement('a');
    anchor.href = url; anchor.download = `TabMarker-backup-${new Date().toISOString().slice(0, 10)}.json`;
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 30_000);
    setSuccess('Backup download started. Keep this file outside the extension folder.');
  }
  async function selectImport(file: File) {
    setIncoming(null);
    if (file.size > MAX_BACKUP_BYTES) throw new Error('Choose a TabMarker backup smaller than 32 MB.');
    const text = await file.text();
    const state = parseBackup(text);
    setMode('merge'); setIncoming({ text, count: state.rules.length, name: file.name });
  }

  const file = overview?.file;
  return <section id="backups" className="panel mt-7 scroll-mt-5 p-5" aria-labelledby="backup-heading">
    <div className="flex flex-wrap items-start justify-between gap-3"><div><h2 id="backup-heading" className="text-lg font-bold text-slate-900">Backups & recovery</h2><p className="hint">Rules live in this Chrome profile. A separate file protects them if the extension or profile is removed.</p></div><span className="badge">On your device</span></div>
    <div className="mt-4 space-y-3"><Feedback error={error} success={success}/></div>
    <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-4">
      <h3 className="text-sm font-semibold text-slate-800">Automatic file backup</h3>
      <p className={`mt-2 text-sm ${file && ['error', 'permission', 'pending'].includes(file.state) ? 'text-red-700' : 'text-slate-600'}`} role="status">{file?.message ?? 'Checking backup status…'}</p>
      {file?.fileName && <p className="hint break-all">{file.fileName}{file.lastSyncedAt ? ` · Last saved ${new Date(file.lastSyncedAt).toLocaleString()}` : ' · Not yet backed up'}</p>}
      <p className="hint">Choose a JSON file in Documents or a folder backed up by your computer. TabMarker updates it after each saved-rule change. Chrome may ask you to allow file access again after a restart. This is a one-way backup; file edits are imported only when you restore them.</p>
      <div className="mt-3 flex flex-wrap gap-2"><button type="button" className="secondary" disabled={busy} onClick={() => void run(connect)}>{file?.fileName ? 'Choose another backup file' : 'Choose backup file'}</button>{file?.fileName && <><button type="button" className="secondary" disabled={busy} onClick={() => void run(sync)}>{file.state === 'permission' ? 'Allow file access' : 'Sync now'}</button><button type="button" className="text-button text-slate-600" disabled={busy} onClick={() => void run(async () => { setOverview(await request('DISCONNECT_BACKUP', {})); setSuccess('Automatic backup disconnected. The file on disk was kept.'); })}>Disconnect</button></>}</div>
    </div>
    <div className="mt-4 flex flex-wrap items-center gap-3"><button className="secondary" type="button" disabled={busy} onClick={() => void run(download)}>Download backup</button><label className={`secondary ${busy ? 'opacity-50' : 'cursor-pointer'}`}>Import backup<input className="sr-only" type="file" accept=".json,application/json" aria-label="Import backup" disabled={busy} onChange={event => { const file = event.target.files?.[0]; event.target.value = ''; if (file) void run(() => selectImport(file)); }}/></label></div>
    {incoming && <div className="mt-4 rounded-xl border border-slate-300 p-4"><p className="text-sm font-semibold text-slate-800">Ready to import {incoming.count} {incoming.count === 1 ? 'rule' : 'rules'}</p><p className="hint break-all">{incoming.name}</p><label className="label mt-3" htmlFor="restore-mode">Import behavior</label><select id="restore-mode" className="field" value={mode} disabled={busy} onChange={event => setMode(event.target.value as typeof mode)}><option value="merge">Merge with my rules</option><option value="replace">Replace all my rules</option></select><p className="hint">{mode === 'merge' ? 'Existing rules stay. Conflicting imported copies are disabled so you can review them.' : 'Replaces every saved rule, including with an empty backup. Your current rules become a recovery copy.'} Temporary tab overrides are unaffected.</p><div className="mt-3 flex gap-3"><button className="primary" type="button" disabled={busy} onClick={() => void run(async () => { await request('IMPORT_BACKUP', { text: incoming.text, mode }); setIncoming(null); setSuccess('Backup imported. Open matching tabs update automatically.'); })}>Confirm import</button><button className="secondary" type="button" disabled={busy} onClick={() => setIncoming(null)}>Cancel import</button></div></div>}
    <details className="mt-5 border-t border-slate-200 pt-4"><summary className="cursor-pointer text-sm font-semibold text-slate-700">Recent recovery copies ({overview?.snapshots.length ?? 0})</summary><p className="hint">Up to 10 recent states, within a 1 MB limit, saved before rule changes. These stay inside Chrome and are also removed when the extension/profile is removed.</p>{!!overview?.snapshots.length && <><label className="label mt-3" htmlFor="recovery-copy">Recovery copy</label><select id="recovery-copy" className="field" value={recovery} disabled={busy} onChange={event => setRecovery(event.target.value)}><option value="">Choose a recovery copy…</option>{overview.snapshots.map(item => <option key={item.id} value={item.id}>{new Date(item.createdAt).toLocaleString()} · {item.ruleCount} rules</option>)}</select>{recovery && <><p className="hint text-red-700">Restoring replaces all saved rules. The current state will become a recovery copy.</p><button className="secondary mt-3" type="button" disabled={busy} onClick={() => void run(async () => { await request('RESTORE_SNAPSHOT', { id: recovery }); setRecovery(''); setSuccess('Recovery copy restored.'); })}>Confirm restore recovery copy</button></>}</>}</details>
    <p className="hint mt-4">Backups contain your custom titles, icons and matching addresses. Keep the file somewhere private. Temporary tab overrides are not backed up.</p>
  </section>;
}
