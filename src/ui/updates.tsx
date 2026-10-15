import { useEffect, useState } from 'react';
import { readDeployment, type UpdateState } from '../shared/deployment';

export function UpdateNotice({ busy = false, hasUnsavedChanges = () => false }: { busy?: boolean; hasUnsavedChanges?: () => boolean }) {
  const [update, setUpdate] = useState<UpdateState>({ kind: 'current', running: chrome.runtime.getManifest().version });
  const [error, setError] = useState('');
  const [reloading, setReloading] = useState(false);
  useEffect(() => {
    let active = true;
    let checking = false;
    const check = async () => {
      if (checking) return;
      checking = true;
      const next = await readDeployment();
      if (active) setUpdate(next);
      checking = false;
    };
    void check();
    const timer = setInterval(() => { if (document.visibilityState === 'visible') void check(); }, 15_000);
    window.addEventListener('focus', check);
    document.addEventListener('visibilitychange', check);
    return () => { active = false; clearInterval(timer); window.removeEventListener('focus', check); document.removeEventListener('visibilitychange', check); };
  }, []);

  async function reload() {
    if (hasUnsavedChanges() && !window.confirm('Reload TabMarker and discard your unsaved edits? Saved rules will be kept.')) return;
    setReloading(true); setError('');
    try {
      const latest = await readDeployment();
      setUpdate(latest);
      if (latest.kind !== 'ready') throw new Error('The update is not ready. Try again after installation finishes.');
      chrome.runtime.reload();
    } catch (cause) {
      setReloading(false);
      setError(cause instanceof Error ? cause.message : 'Could not reload. Reload TabMarker from chrome://extensions.');
    }
  }

  return <section className={`update-notice ${update.kind === 'ready' || update.kind === 'applying' ? 'update-pending' : ''}`} aria-label="TabMarker update status">
    {update.kind === 'ready' ? <>
      <p className="update-title" role="status">Update installed · v{update.installed}</p>
      <p className="hint">Running v{update.running}. Saved rules stay. Temporary tab labels reset; refresh open websites afterward.</p>
      <button className="primary mt-2 w-full" type="button" disabled={busy || reloading} onClick={() => void reload()}>{reloading ? 'Reloading…' : 'Update installed — Reload TabMarker'}</button>
    </> : update.kind === 'applying' ? <p role="status">Installing an update… Reload will be available when it finishes.</p>
      : <span>TabMarker v{update.running}{update.kind === 'unavailable' ? ' · Update status unavailable' : ''}</span>}
    {error && <p className="hint text-rose-700" role="alert">{error}</p>}
  </section>;
}
