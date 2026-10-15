import { StrictMode, useCallback, useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import type { FormEvent } from 'react';
import { request } from '../shared/client';
import { getAutotaskView } from '../integrations/autotask-routing';
import type { AppState, BackupOverview, RequestMap, RuleScope } from '../shared/types';
import { AppearanceFields, appearanceFrom, Brand, customizationFrom, Feedback, SCOPE_LABELS } from './components';
import type { AppearanceForm } from './components';
import './styles.css';

function tabIdFromLocation(): number | undefined {
  const value = new URLSearchParams(location.search).get('tabId');
  return value && /^\d+$/.test(value) ? Number(value) : undefined;
}

function Popup() {
  const [state, setState] = useState<AppState | null>(null);
  const [appearance, setAppearance] = useState<AppearanceForm>(appearanceFrom(null));
  const [scope, setScope] = useState<RuleScope | 'tab'>('tab');
  const [pattern, setPattern] = useState('');
  const [patternLoading, setPatternLoading] = useState(false);
  const patternSeeded = useRef(false);
  const patternRequest = useRef(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [backups, setBackups] = useState<BackupOverview | null>(null);
  const [patternPreview, setPatternPreview] = useState<RequestMap['PREVIEW_PATTERN']['output'] | null>(null);
  const [patternError, setPatternError] = useState('');
  const dirty = useRef(false);
  const initialized = useRef<number | null>(null);
  const tabId = tabIdFromLocation();

  const acceptState = useCallback((next: AppState, reset = false) => {
    setState(next);
    const tab = next.tab;
    const changedTab = tab && initialized.current !== tab.id;
    if (tab && (reset || !dirty.current || initialized.current !== tab.id)) {
      initialized.current = tab.id;
      dirty.current = false;
      setAppearance(appearanceFrom(tab.customization));
      const rule = next.rules.find(item => item.id === tab.matchedRuleId);
      setScope(tab.temporary ? 'tab' : rule?.scope ?? (getAutotaskView(tab.url) ? 'exact' : 'tab'));
      if (reset || changedTab) {
        patternRequest.current++;
        setPatternLoading(false);
        patternSeeded.current = rule?.scope === 'pattern';
        setPattern(rule?.scope === 'pattern' ? rule.match : '');
      }
    }
  }, []);

  const useCurrentUrl = useCallback(async (id: number) => {
    const sequence = ++patternRequest.current;
    setPatternLoading(true); setError(''); setSuccess('');
    try {
      const next = await request('GET_PATTERN_URL', { tabId: id });
      if (sequence !== patternRequest.current || initialized.current !== id) return;
      patternSeeded.current = true;
      dirty.current = true;
      setPattern(next.url);
    } catch (cause) {
      if (sequence === patternRequest.current) setError(cause instanceof Error ? cause.message : 'Could not read the current URL.');
    } finally {
      if (sequence === patternRequest.current) setPatternLoading(false);
    }
  }, []);

  useEffect(() => {
    if (scope === 'pattern' && state?.tab && !patternSeeded.current) void useCurrentUrl(state.tab.id);
  }, [scope, state?.tab?.id, useCurrentUrl]);

  const refresh = useCallback(async () => {
    try { acceptState(await request('GET_STATE', { tabId })); setBackups(await request('GET_BACKUPS', {})); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not load this tab.'); }
  }, [acceptState, tabId]);

  useEffect(() => {
    void refresh();
    const changed = (_changes: Record<string, chrome.storage.StorageChange>, area: string) => { if (area === 'local' || area === 'session') void refresh(); };
    chrome.storage.onChanged.addListener(changed);
    return () => chrome.storage.onChanged.removeListener(changed);
  }, [refresh]);

  const previewTabId = state?.tab?.id;
  useEffect(() => {
    setPatternPreview(null);
    setPatternError('');
    if (scope !== 'pattern' || previewTabId === undefined || !pattern.trim()) return;
    let sequence = 0;
    let cancelled = false;
    const preview = async () => {
      const current = ++sequence;
      try {
        const result = await request('PREVIEW_PATTERN', { tabId: previewTabId, pattern: pattern.trim() });
        if (!cancelled && current === sequence) { setPatternPreview(result); setPatternError(''); }
      } catch (cause) {
        if (!cancelled && current === sequence) {
          setPatternPreview(null);
          setPatternError(cause instanceof Error ? cause.message : 'Could not preview this pattern.');
        }
      }
    };
    const timer = setTimeout(() => void preview(), 250);
    const updated = (id: number, change: { url?: string }) => {
      if (id === previewTabId && change.url) void preview();
    };
    chrome.tabs.onUpdated.addListener(updated);
    return () => { cancelled = true; clearTimeout(timer); chrome.tabs.onUpdated.removeListener(updated); };
  }, [scope, pattern, previewTabId]);

  async function save(event: FormEvent) {
    event.preventDefault();
    if (!state?.tab) return;
    setBusy(true); setError(''); setSuccess('');
    try {
      const customization = customizationFrom(appearance);
      if (!customization.title && !customization.icon) throw new Error('Add a title or custom icon to save a customization.');
      const next = await request('SAVE_CUSTOMIZATION', { tabId: state.tab.id, scope, ...(scope === 'pattern' ? { match: pattern.trim() } : {}), ...customization });
      acceptState(next, true);
      const exactWins = scope === 'pattern' && next.rules.some(rule => rule.id === next.tab?.matchedRuleId && rule.scope === 'exact');
      setSuccess(scope === 'tab' ? 'Applied until this tab closes.' : exactWins ? 'Pattern saved. An exact URL rule takes priority.' : 'Rule saved.');
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not save the customization.'); }
    finally { setBusy(false); }
  }

  async function remove() {
    if (!state?.tab) return;
    setBusy(true); setError(''); setSuccess('');
    try {
      const persistent = !state.tab.temporary;
      const next = await request('REMOVE_APPLIED', { tabId: state.tab.id });
      acceptState(next, true);
      setSuccess(`${persistent ? 'Matching rule deleted.' : 'Temporary override removed.'} ${next.tab?.customization ? 'Another matching rule now applies.' : 'Original page metadata restored.'}`);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not remove the customization.'); }
    finally { setBusy(false); }
  }

  useEffect(() => {
    if (tabId === undefined) {
      // Chrome rounds its preferred popup height down. Round our document up
      // so fractional text metrics cannot create a one-pixel scrollbar.
      const main = document.querySelector('main')!;
      const observer = new ResizeObserver(() => { document.documentElement.style.height = `${Math.ceil(main.getBoundingClientRect().height)}px`; });
      observer.observe(main);
      return () => { observer.disconnect(); document.documentElement.style.removeProperty('height'); };
    }
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    const resize = () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        void chrome.windows.getCurrent().then(current => {
          if (!cancelled && current.type === 'popup' && current.id !== undefined) {
            const height = Math.min(680, Math.max(280, Math.ceil(document.querySelector('main')!.getBoundingClientRect().height + window.outerHeight - window.innerHeight)));
            if (Math.abs((current.height ?? 0) - height) > 2) void chrome.windows.update(current.id, { height }).catch(() => undefined);
          }
        }).catch(() => undefined);
      }, 80);
    };
    const observer = new ResizeObserver(resize);
    observer.observe(document.getElementById('root')!);
    return () => { cancelled = true; clearTimeout(timer); observer.disconnect(); };
  }, [tabId]);

  const tab = state?.tab;
  const autotaskView = tab ? getAutotaskView(tab.url) : null;
  const blocked = !tab || !!tab.unsupportedReason;
  const settingsURL = `${chrome.runtime.getURL('options.html')}?tabId=${tab?.id ?? ''}`;
  const backupText = backups?.file.state === 'synced' ? 'Backup up to date' : backups?.file.state === 'off' ? 'Set up backup' : backups ? 'Backup needs attention' : 'Backups';
  return <main className="popup-shell">
    <div className="popup-top"><Brand compact subtitle={tab?.customization ? `${tab.temporary ? 'Temporary override' : 'Persistent rule'} active` : 'Customize this tab'}/><a className="text-button text-xs" href={settingsURL} target="_blank" rel="noreferrer">Manage rules ↗</a></div>
    <div className="popup-content">
      {!state && !error && <p className="py-5 text-center text-sm text-slate-500" role="status">Loading tab…</p>}
      {state && blocked && <div className="panel p-4"><p className="text-sm font-semibold text-slate-800">This page cannot be customized</p><p className="hint">{tab?.unsupportedReason ?? 'Select a regular website tab, then open TabMarker again.'}</p><button className="primary mt-4 w-full" type="button" disabled>Save customization</button></div>}
      {state && !blocked && tab && <form id="customize-form" onSubmit={save}>
        <AppearanceFields compact value={appearance} disabled={busy} onChange={value => { dirty.current = true; setAppearance(value); setSuccess(''); }}/>
        <div><label className="label" htmlFor="scope">Rule scope</label><select id="scope" className="field" value={scope} disabled={busy} onChange={event => { dirty.current = true; setScope(event.target.value as RuleScope | 'tab'); setSuccess(''); }}>{Object.entries(SCOPE_LABELS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select>
          <p className="hint">{scope === 'tab' ? 'Temporary. Ends when the tab closes or Chrome restarts.' : scope === 'exact' ? autotaskView ? `Matches this Autotask screen: ${autotaskView.label} (view=${autotaskView.id}).` : 'Matches hostname and path; ignores query parameters.' : scope === 'domain' ? 'All pages on this domain and its subdomains.' : 'Use * in host, path or query values.'}</p>
        </div>
        {scope === 'pattern' && <div>
          <div className="flex items-center justify-between gap-2"><label className="label" htmlFor="pattern">URL pattern</label><button className="text-button text-xs" type="button" disabled={busy || patternLoading} onClick={() => void useCurrentUrl(tab.id)}>{patternLoading ? 'Reading URL…' : 'Use current URL'}</button></div>
          <input id="pattern" className="field font-mono text-xs" type="text" required maxLength={4096} value={pattern} disabled={busy || patternLoading} onChange={event => { dirty.current = true; patternSeeded.current = true; setPattern(event.target.value); setError(''); setSuccess(''); }} placeholder="https://ww*.autotask.net/*?view=inventory-order*" spellCheck={false}/>
          {patternError && <p className="hint text-rose-700" role="alert">{patternError}</p>}
          {patternPreview && <p className="hint" role="status">{patternPreview.matches ? 'This pattern matches the current tab.' : 'This pattern does not match the current tab.'}{patternPreview.matches && patternPreview.exactRuleTakesPriority ? ' An exact URL rule currently takes priority.' : ''}</p>}
        </div>}
      </form>}
    </div>
    <footer><Feedback error={error} success={success}/>{state && !blocked && <div className="flex gap-2"><button type="submit" form="customize-form" className="primary min-w-0 flex-1" disabled={busy || patternLoading || (scope === 'pattern' && !!patternError)}>{busy ? 'Working…' : 'Save customization'}</button>{tab?.customization && <button type="button" className="secondary text-xs" aria-label="Remove applied customization" disabled={busy} onClick={() => void remove()} title={tab.temporary ? 'Removes this tab override.' : 'Deletes the active saved rule for all matching tabs.'}>{tab.temporary ? 'Reset tab' : 'Delete rule'}</button>}</div>}
      <div className="popup-links"><a href={`${settingsURL}#diagnostics`} target="_blank" rel="noreferrer">Module diagnostics</a><a href={`${settingsURL}#backups`} target="_blank" rel="noreferrer" className={backups && backups.file.state !== 'synced' ? 'text-red-700' : ''}>{backupText}</a></div>
    </footer>
  </main>;
}

if (tabIdFromLocation() !== undefined) document.documentElement.classList.add('editor-window');
createRoot(document.getElementById('root')!).render(<StrictMode><Popup/></StrictMode>);
