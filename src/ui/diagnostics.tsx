import { useCallback, useEffect, useState } from 'react';
import { request } from '../shared/client';
import type { Diagnostics, Rule } from '../shared/types';
import { Feedback, SCOPE_LABELS } from './components';

export function ModuleDiagnostics({ rules }: { rules: Rule[] }) {
  const initialId = new URLSearchParams(location.search).get('tabId');
  const [tabId, setTabId] = useState(initialId && /^\d+$/.test(initialId) ? initialId : '');
  const [tabs, setTabs] = useState<chrome.tabs.Tab[]>([]);
  const [report, setReport] = useState<Diagnostics | null>(null);
  const [capturedAt, setCapturedAt] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const loadTabs = useCallback(async () => {
    const open = (await chrome.tabs.query({})).filter(tab => tab.id !== undefined && /^https?:/.test(tab.url ?? ''));
    setTabs(open);
  }, []);
  useEffect(() => {
    void loadTabs();
    const focus = () => void loadTabs();
    window.addEventListener('focus', focus);
    return () => window.removeEventListener('focus', focus);
  }, [loadTabs]);
  async function inspect() {
    if (!tabId) return;
    setBusy(true); setError(''); setSuccess(''); setReport(null);
    try { setReport(await request('GET_DIAGNOSTICS', { tabId: Number(tabId) })); setCapturedAt(Date.now()); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not inspect this tab.'); }
    finally { setBusy(false); }
  }
  async function copy() {
    try { await navigator.clipboard.writeText(JSON.stringify(report, null, 2)); setSuccess('Safe diagnostic summary copied.'); }
    catch { setError('Could not copy the summary. Select it in Technical details and copy manually.'); }
  }
  const application = report?.application;
  return <section id="diagnostics" className="panel mt-7 scroll-mt-5 p-5" aria-labelledby="diagnostics-heading">
    <h2 id="diagnostics-heading" className="text-lg font-bold text-slate-900">Module diagnostics</h2><p className="hint">Check a tab’s recognized screen, rule priority and applied metadata. This local report excludes raw URLs, page contents and unreviewed query values.</p>
    <div className="mt-4 flex flex-wrap items-end gap-3"><div className="min-w-0 flex-1"><label className="label" htmlFor="diagnostic-tab">Tab to inspect</label><select id="diagnostic-tab" className="field" value={tabId} onChange={event => { setTabId(event.target.value); setReport(null); setError(''); }}><option value="">Choose a website tab…</option>{tabId && !tabs.some(tab => String(tab.id) === tabId) && <option value={tabId}>Selected tab</option>}{tabs.map(tab => <option key={tab.id} value={tab.id}>{tab.title || new URL(tab.url!).hostname}</option>)}</select></div><button className="secondary" type="button" disabled={busy || !tabId} onClick={() => void inspect()}>{busy ? 'Inspecting…' : 'Inspect tab'}</button></div>
    <div className="mt-4 space-y-3"><Feedback error={error} success={success}/></div>
    {report && <div className="mt-4 space-y-4" aria-label="Diagnostic results">
      <div className="rounded-xl bg-slate-50 p-4"><p className="text-sm font-semibold text-slate-900">{report.recognizedView?.label ?? (report.siteKind === 'autotask' ? 'Autotask · unrecognized screen' : 'Standard website')}</p><p className="hint">{report.note}</p></div>
      <dl className="grid gap-3 text-sm sm:grid-cols-3"><div className="rounded-xl border border-slate-200 p-3"><dt className="text-xs text-slate-500">Content script</dt><dd className="mt-1 font-semibold text-slate-800">Connected</dd></div><div className="rounded-xl border border-slate-200 p-3"><dt className="text-xs text-slate-500">Tab title</dt><dd className="mt-1 font-semibold text-slate-800">{application?.titleRequested ? application.titleApplied ? 'Applied' : 'Mismatch detected' : 'Page controlled'}</dd></div><div className="rounded-xl border border-slate-200 p-3"><dt className="text-xs text-slate-500">Favicon links</dt><dd className="mt-1 font-semibold text-slate-800">{application?.iconRequested ? application.iconLinksApplied ? 'Applied to page' : 'Mismatch detected' : 'Page controlled'}</dd></div></dl>
      <div><h3 className="text-sm font-semibold text-slate-800">Rule selection</h3><p className="hint">{report.recommendation}</p>{report.matchingScope === 'tab' && <p className="badge mt-2">Temporary override wins</p>}<ol className="mt-2 space-y-2">{report.matchingRules?.map((match, index) => { const rule = rules.find(rule => rule.id === match.id); return <li key={match.id} className="rounded-lg border border-slate-200 p-3"><div className="flex items-center gap-2 text-sm"><span className="text-slate-400">{index + 1}.</span><span className="font-semibold text-slate-800">{rule?.title || 'Original page title'}</span><span className="text-xs text-slate-500">{SCOPE_LABELS[match.scope]}</span>{match.selected && <span className="badge">Active</span>}</div><p className="hint break-all font-mono">{rule?.match ?? match.id}</p></li>; })}</ol>{!report.matchingRules?.length && <p className="hint">No matching enabled saved rules.</p>}</div>
      <p className="hint">Favicon checks confirm page link attributes. Chrome’s displayed icon can still be affected by the site’s Content Security Policy or browser cache. Only the top document is inspected.</p>
      <div className="flex flex-wrap items-center justify-between gap-2"><p className="text-xs text-slate-500">Captured {capturedAt ? new Date(capturedAt).toLocaleTimeString() : ''} · v{report.extensionVersion}</p><button className="text-button text-xs" type="button" onClick={() => void copy()}>Copy safe diagnostic summary</button></div>
      <details><summary className="cursor-pointer text-xs font-semibold text-slate-600">Technical details</summary><pre className="mt-3 max-h-64 overflow-auto rounded-xl bg-slate-900 p-3 text-xs text-slate-100" tabIndex={0} aria-label="Safe diagnostic summary">{JSON.stringify(report, null, 2)}</pre></details>
    </div>}
  </section>;
}
