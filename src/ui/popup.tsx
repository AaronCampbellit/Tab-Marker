import { StrictMode, useCallback, useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import type { FormEvent } from 'react';
import { request } from '../shared/client';
import { normalizeUrl } from '../core/normalization';
import { getAutotaskView } from '../integrations/autotask-routing';
import type { AppState, Diagnostics, RuleScope } from '../shared/types';
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
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [diagnostics, setDiagnostics] = useState<Diagnostics | null>(null);
  const dirty = useRef(false);
  const initialized = useRef<number | null>(null);
  const tabId = tabIdFromLocation();

  const acceptState = useCallback((next: AppState, reset = false) => {
    setState(next);
    const tab = next.tab;
    if (tab && (reset || !dirty.current || initialized.current !== tab.id)) {
      initialized.current = tab.id;
      dirty.current = false;
      setAppearance(appearanceFrom(tab.customization));
      const rule = next.rules.find(item => item.id === tab.matchedRuleId);
      setScope(tab.temporary ? 'tab' : rule?.scope ?? (getAutotaskView(tab.url) ? 'exact' : 'tab'));
      setPattern(rule?.scope === 'pattern' ? rule.match : `${normalizeUrl(tab.url) ?? tab.url}*`);
    }
  }, []);

  const refresh = useCallback(async () => {
    try { acceptState(await request('GET_STATE', { tabId })); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not load this tab.'); }
  }, [acceptState, tabId]);

  useEffect(() => {
    void refresh();
    const changed = (_changes: Record<string, chrome.storage.StorageChange>, area: string) => { if (area === 'local' || area === 'session') void refresh(); };
    chrome.storage.onChanged.addListener(changed);
    return () => chrome.storage.onChanged.removeListener(changed);
  }, [refresh]);

  async function save(event: FormEvent) {
    event.preventDefault();
    if (!state?.tab) return;
    setBusy(true); setError(''); setSuccess('');
    try {
      const customization = customizationFrom(appearance);
      if (!customization.title && !customization.icon) throw new Error('Add a title or custom icon to save a customization.');
      acceptState(await request('SAVE_CUSTOMIZATION', { tabId: state.tab.id, scope, ...(scope === 'pattern' ? { match: pattern.trim() } : {}), ...customization }), true);
      setDiagnostics(null);
      setSuccess(scope === 'tab' ? 'Applied to this tab. This override ends when the tab closes.' : 'Rule saved. It will apply whenever this address matches.');
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not save the customization.'); }
    finally { setBusy(false); }
  }

  async function remove() {
    if (!state?.tab) return;
    setBusy(true); setError(''); setSuccess('');
    try {
      const persistent = !state.tab.temporary;
      const next = await request('REMOVE_APPLIED', { tabId: state.tab.id });
      acceptState(next, true); setDiagnostics(null);
      setSuccess(`${persistent ? 'Matching rule deleted.' : 'Temporary override removed.'} ${next.tab?.customization ? 'Another matching rule now applies.' : 'Original page metadata restored.'}`);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not remove the customization.'); }
    finally { setBusy(false); }
  }

  async function inspect() {
    if (!state?.tab) return;
    setBusy(true); setError(''); setSuccess('');
    try { setDiagnostics(await request('GET_DIAGNOSTICS', { tabId: state.tab.id })); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Diagnostics are unavailable.'); }
    finally { setBusy(false); }
  }

  async function copyDiagnostics() {
    try { await navigator.clipboard.writeText(JSON.stringify(diagnostics, null, 2)); setSuccess('Safe diagnostic summary copied.'); }
    catch { setError('Could not copy. You can select the diagnostic text and copy it manually.'); }
  }

  const tab = state?.tab;
  const autotaskView = tab ? getAutotaskView(tab.url) : null;
  const blocked = !tab || !!tab.unsupportedReason;
  return <main className="popup-shell p-5">
    <Brand compact subtitle="A little clarity in every tab."/>
    <div className="popup-heading mb-4 flex items-center justify-between gap-2"><h2 className="text-base font-bold text-slate-900">Customize this tab</h2><a className="text-button inline-flex items-center gap-1 text-xs" href={chrome.runtime.getURL('options.html')} target="_blank" rel="noreferrer">Manage rules<svg width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M6 3H3v10h10v-3M8 2h6v6M14 2 7 9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg></a></div>
    <div className="popup-content space-y-4">
      {!state && !error && <p className="py-8 text-center text-sm text-slate-500" role="status">Loading tab…</p>}
      {state && blocked && <div className="panel p-4"><p className="text-sm font-semibold text-slate-800">This page cannot be customized</p><p className="mt-2 text-sm leading-relaxed text-slate-600">{tab?.unsupportedReason ?? 'Select a regular website tab, then open TabMarker again.'}</p><p className="hint">Chrome protects its internal pages, the Chrome Web Store, and some built-in viewers. Try an ordinary HTTP or HTTPS page.</p><button className="primary mt-4 w-full" type="button" disabled>Save customization</button></div>}
      {state && !blocked && tab && <>
        <div className="flex min-w-0 items-center gap-2 rounded-xl bg-indigo-50 px-3 py-2.5"><span className={`h-1.5 w-1.5 shrink-0 rounded-full ${tab.customization ? 'bg-indigo-500' : 'bg-slate-400'}`} aria-hidden="true"/><p className="min-w-0 truncate text-xs text-indigo-900" title={tab.url}>{tab.customization ? `${tab.temporary ? 'Temporary override' : 'Persistent rule'} active` : 'No customization applied'}</p></div>
        <form id="customize-form" onSubmit={save} className="space-y-5">
          <AppearanceFields value={appearance} disabled={busy} onChange={value => { dirty.current = true; setAppearance(value); setSuccess(''); }}/>
          <div><label className="label" htmlFor="scope">Rule scope</label><select id="scope" className="field" value={scope} disabled={busy} onChange={event => { dirty.current = true; setScope(event.target.value as RuleScope | 'tab'); setSuccess(''); }}>{Object.entries(SCOPE_LABELS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select>
            <p className="hint">{scope === 'tab' ? 'Follows this tab through navigation. Ends when you close the tab or restart Chrome.' : scope === 'exact' ? autotaskView ? `Matches this Autotask screen: ${autotaskView.label} (view=${autotaskView.id}). Other query parameters and fragments are ignored.` : 'Matches this exact hostname and path. Query parameters and fragments are ignored.' : scope === 'domain' ? 'Applies to every path on this hostname and its subdomains, using HTTP or HTTPS.' : 'Use * for any characters in the hostname or path. Query parameters and fragments are ignored.'}</p>
          </div>
          {scope === 'pattern' && <div><label className="label" htmlFor="pattern">URL pattern</label><input id="pattern" className="field font-mono text-xs" type="text" required value={pattern} disabled={busy} onChange={event => { dirty.current = true; setPattern(event.target.value); }} placeholder="https://example.com/work/*" spellCheck={false}/></div>}
          {scope !== 'tab' && <p className="rounded-xl border border-slate-200 bg-white p-3 text-xs leading-relaxed text-slate-500">Saved locally in Chrome. Address rules store hostname and path, plus the recognized Autotask view for exact rules. Encoded view-data, other query values and page contents are never saved. Avoid paths containing customer information.</p>}
        </form>
        {tab.customization && <div className="border-t border-slate-200 pt-3"><button type="button" className="text-button text-rose-600 hover:text-rose-800" disabled={busy} onClick={() => void remove()}>Remove applied customization</button><p className="hint">{tab.temporary ? 'Removes this tab’s temporary override.' : 'Deletes the active persistent rule for every matching tab.'} A lower-priority rule may then apply.</p></div>}
        <details className="border-t border-slate-200 pt-3"><summary className="cursor-pointer text-xs font-semibold text-slate-500">Module diagnostics</summary><p className="hint mt-3">Generate a safe summary with no raw URLs, page titles, query values, customer content, or authentication tokens. Nothing is saved or sent.</p><button className="secondary mt-3 w-full text-xs" disabled={busy} type="button" onClick={() => void inspect()}>Generate safe diagnostic summary</button>{diagnostics && <><pre className="mt-3 max-h-48 overflow-auto rounded-xl bg-slate-900 p-3 text-[10px] leading-relaxed text-slate-100" tabIndex={0} aria-label="Safe diagnostic summary">{JSON.stringify(diagnostics, null, 2)}</pre><button className="text-button mt-2 text-xs" type="button" onClick={() => void copyDiagnostics()}>Copy safe diagnostic summary</button></>}</details>
      </>}
    </div>
    <footer className="mt-4 space-y-3 border-t border-slate-200 pt-3"><Feedback error={error} success={success}/>{state && !blocked && <button type="submit" form="customize-form" className="primary w-full" disabled={busy}>{busy ? 'Working…' : 'Save customization'}</button>}<p className="text-[10px] text-slate-400">Local-first · No account · No tracking</p></footer>
  </main>;
}

if (tabIdFromLocation() !== undefined) document.documentElement.classList.add('editor-window');
createRoot(document.getElementById('root')!).render(<StrictMode><Popup/></StrictMode>);
