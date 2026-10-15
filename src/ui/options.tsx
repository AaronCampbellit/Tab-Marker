import { StrictMode, useCallback, useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import type { FormEvent } from 'react';
import { request } from '../shared/client';
import { getAutotaskView } from '../integrations/autotask-routing';
import type { Rule, RuleScope } from '../shared/types';
import { AppearanceFields, appearanceFrom, Brand, customizationFrom, Feedback, IconPreview, ScopeHelp, SCOPE_LABELS } from './components';
import type { AppearanceForm } from './components';
import './styles.css';
import { Backups } from './backups';
import { ModuleDiagnostics } from './diagnostics';
import { UpdateNotice, VersionLabel } from './updates';
import { GitHubUpdates } from './github-updates';

interface Editor { rule: Rule; appearance: AppearanceForm; isNew: boolean }

function Options() {
  const [rules, setRules] = useState<Rule[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [search, setSearch] = useState('');
  const [editor, setEditor] = useState<Editor | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [loadError, setLoadError] = useState('');
  const [success, setSuccess] = useState('');
  const [websiteTabs, setWebsiteTabs] = useState<chrome.tabs.Tab[]>([]);
  const [websiteTabId, setWebsiteTabId] = useState(new URLSearchParams(location.search).get('tabId') ?? '');
  const [patternLoading, setPatternLoading] = useState(false);
  const matchEdited = useRef(false);
  const patternRequest = useRef(0);

  useEffect(() => {
    const load = async () => {
      try {
        const tabs = (await chrome.tabs.query({})).filter(tab => tab.id !== undefined && /^https?:/.test(tab.url ?? ''));
        setWebsiteTabs(tabs);
        setWebsiteTabId(current => tabs.some(tab => String(tab.id) === current) ? current : String((tabs.length === 1 ? tabs[0].id : '') ?? ''));
      } catch { /* A URL can still be entered manually if tab access is unavailable. */ }
    };
    void load();
    window.addEventListener('focus', load);
    return () => window.removeEventListener('focus', load);
  }, []);

  const useCurrentUrl = useCallback(async (editorId: string, id: number, force = false) => {
    const sequence = ++patternRequest.current;
    setPatternLoading(true); setError(''); setSuccess('');
    try {
      const result = await request('GET_PATTERN_URL', { tabId: id });
      if (sequence !== patternRequest.current) return;
      if (force) matchEdited.current = true;
      setEditor(current => current?.rule.id === editorId && current.rule.scope === 'pattern' && (force || !matchEdited.current)
        ? { ...current, rule: { ...current.rule, match: result.url } } : current);
    } catch (cause) {
      if (sequence === patternRequest.current) setError(cause instanceof Error ? cause.message : 'Could not read the current URL.');
    } finally {
      if (sequence === patternRequest.current) setPatternLoading(false);
    }
  }, []);

  useEffect(() => {
    if (editor?.isNew && editor.rule.scope === 'pattern' && websiteTabId && !matchEdited.current) void useCurrentUrl(editor.rule.id, Number(websiteTabId));
  }, [editor?.rule.id, editor?.rule.scope, websiteTabId, useCurrentUrl]);

  const refresh = useCallback(async () => {
    try { setRules((await request('GET_STATE', {})).rules); setLoaded(true); setLoadError(''); }
    catch (cause) { setLoadError(cause instanceof Error ? cause.message : 'Could not load rules.'); }
  }, []);
  useEffect(() => {
    void refresh();
    const changed = (_changes: Record<string, chrome.storage.StorageChange>, area: string) => { if (area === 'local') void refresh(); };
    chrome.storage.onChanged.addListener(changed);
    return () => chrome.storage.onChanged.removeListener(changed);
  }, [refresh]);

  useEffect(() => {
    if (!loaded && !loadError) return;
    const id = location.hash.slice(1);
    if (id === 'backups' || id === 'diagnostics' || id === 'updates') requestAnimationFrame(() => document.getElementById(id)?.scrollIntoView({ block: 'start' }));
  }, [loaded, loadError]);

  function startEdit(rule?: Rule) {
    patternRequest.current++;
    setPatternLoading(false);
    matchEdited.current = !!rule;
    const now = Date.now();
    const next: Rule = rule ?? { id: crypto.randomUUID(), enabled: true, scope: 'exact', match: '', title: null, icon: { color: '#c62828', glyph: 'T' }, createdAt: now, updatedAt: now };
    setEditor({ rule: { ...next }, appearance: appearanceFrom(next), isNew: !rule });
    setDeleting(null); setError(''); setSuccess('');
    requestAnimationFrame(() => document.getElementById('rule-editor')?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    if (!editor) return;
    setBusy(true); setError(''); setSuccess('');
    try {
      const customization = customizationFrom(editor.appearance);
      if (!customization.title && !customization.icon) throw new Error('Add a title or custom icon to save a rule.');
      const next = await request('UPSERT_RULE', { rule: { ...editor.rule, match: editor.rule.match.trim(), ...customization, updatedAt: Date.now() } });
      setRules(next.rules); setEditor(null); setSuccess('Rule saved. Open matching tabs update automatically.');
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not save this rule.'); }
    finally { setBusy(false); }
  }

  async function toggle(rule: Rule) {
    setBusy(true); setError(''); setSuccess('');
    try { setRules((await request('TOGGLE_RULE', { id: rule.id, enabled: !rule.enabled })).rules); setSuccess(rule.enabled ? 'Rule disabled. Other matching rules may now apply.' : 'Rule enabled.'); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not update this rule.'); }
    finally { setBusy(false); }
  }

  async function remove(id: string) {
    setBusy(true); setError(''); setSuccess('');
    try { setRules((await request('DELETE_RULE', { id })).rules); setDeleting(null); if (editor?.rule.id === id) setEditor(null); setSuccess('Rule deleted. Other matching rules may now apply.'); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not delete this rule.'); }
    finally { setBusy(false); }
  }

  const query = search.trim().toLowerCase();
  const visible = rules.filter(rule => `${rule.title ?? ''} ${rule.match} ${rule.scope} ${SCOPE_LABELS[rule.scope]} ${rule.icon?.glyph ?? ''}`.toLowerCase().includes(query)).sort((a, b) => b.updatedAt - a.updatedAt || a.id.localeCompare(b.id));
  return <main className="mx-auto max-w-4xl px-5 py-9 sm:px-8 sm:py-12">
    <div className="flex flex-wrap items-start justify-between gap-3"><Brand subtitle="Your tabs. Instantly recognizable."/><nav className="flex gap-4 text-sm"><a className="text-button" href="#backups">Backups</a><a className="text-button" href="#diagnostics">Diagnostics</a><a className="text-button" href="#updates">Updates</a></nav></div>
    <div className="mb-5"><UpdateNotice busy={busy} hasUnsavedChanges={() => editor !== null}/></div>
    <div className="mb-7 flex flex-wrap items-center justify-between gap-4"><div><h2 className="text-3xl font-bold tracking-tight text-slate-900">Your rules</h2><p className="mt-2 text-sm text-slate-500">Persistent titles and icons, kept on this device.</p></div><button type="button" className="primary" disabled={busy} onClick={() => startEdit()}><span aria-hidden="true">＋</span>Add rule</button></div>
    <div className="mb-6 space-y-3"><Feedback error={error || loadError} success={success}/></div>
    {editor && <section id="rule-editor" className="panel mb-7 scroll-mt-5 overflow-hidden" aria-labelledby="editor-heading"><div className="border-b border-slate-200 bg-slate-50 px-5 py-4"><h3 id="editor-heading" className="font-bold text-slate-900">{editor.isNew ? 'Add a rule' : 'Edit rule'}</h3><p className="hint">Choose which address to recognize and how its tab should look.</p></div>
      <form className="space-y-5 p-5" onSubmit={save} aria-label="Rule editor">
        <div className="grid gap-4 sm:grid-cols-[180px_1fr]"><div><label className="label" htmlFor="edit-scope">Rule scope</label><select id="edit-scope" className="field" aria-describedby="edit-scope-help" value={editor.rule.scope} disabled={busy} onChange={event => setEditor({ ...editor, rule: { ...editor.rule, scope: event.target.value as RuleScope } })}>{(['exact', 'pattern', 'domain'] as const).map(scope => <option key={scope} value={scope}>{SCOPE_LABELS[scope]}</option>)}</select></div><div><label className="label" htmlFor="edit-match">{editor.rule.scope === 'domain' ? 'Domain' : editor.rule.scope === 'pattern' ? 'URL pattern' : 'Exact URL'}</label><input id="edit-match" className="field font-mono text-sm" value={editor.rule.match} required spellCheck={false} disabled={busy || patternLoading} placeholder={editor.rule.scope === 'domain' ? 'example.com' : editor.rule.scope === 'pattern' ? 'https://example.com/work/*' : 'https://example.com/work'} onChange={event => { matchEdited.current = true; setEditor({ ...editor, rule: { ...editor.rule, match: event.target.value } }); }}/></div></div>
        {editor.rule.scope === 'pattern' && <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-0 flex-1"><label className="label" htmlFor="pattern-tab">Website tab</label><select id="pattern-tab" className="field" value={websiteTabId} disabled={busy || patternLoading} onChange={event => setWebsiteTabId(event.target.value)}><option value="">Choose a website tab…</option>{websiteTabs.map(tab => <option key={tab.id} value={tab.id}>{tab.title || new URL(tab.url!).hostname}</option>)}</select></div>
          <button className="secondary" type="button" disabled={busy || patternLoading || !websiteTabId} onClick={() => void useCurrentUrl(editor.rule.id, Number(websiteTabId), true)}>{patternLoading ? 'Reading URL…' : 'Use current URL'}</button>
        </div>}
        <ScopeHelp id="edit-scope-help" scope={editor.rule.scope} viewLabel={getAutotaskView(editor.rule.match)?.label}/>
        <p className="hint">{editor.rule.scope === 'domain' ? 'Enter a website name such as example.com, without a path or port.' : editor.rule.scope === 'exact' ? 'Include http:// or https://. For a recognized Autotask screen, paste its full URL.' : 'Include http:// or https://. Review the copied query filters before saving.'} Fragments after # are ignored. Avoid putting private data in rules.</p>
        <div className="max-w-md"><AppearanceFields value={editor.appearance} disabled={busy} onChange={appearance => setEditor({ ...editor, appearance })}/></div>
        <label className="flex items-center gap-2 text-sm text-slate-700"><input type="checkbox" checked={editor.rule.enabled} disabled={busy} onChange={event => setEditor({ ...editor, rule: { ...editor.rule, enabled: event.target.checked } })}/>Rule enabled</label>
        <div className="flex gap-3 border-t border-slate-200 pt-4"><button className="primary" type="submit" disabled={busy || patternLoading}>{busy ? 'Saving…' : 'Save rule'}</button><button className="secondary" type="button" disabled={busy} onClick={() => setEditor(null)}>Cancel</button></div>
      </form>
    </section>}
    <section aria-label="Saved rules"><div className="mb-4 flex flex-wrap items-center justify-between gap-3"><div className="w-full max-w-md"><label className="sr-only" htmlFor="search">Search rules</label><input id="search" type="search" className="field" placeholder="Search titles, addresses, or scopes…" value={search} onChange={event => setSearch(event.target.value)}/></div><p className="text-xs text-slate-500">{visible.length} of {rules.length} {rules.length === 1 ? 'rule' : 'rules'}</p></div>
      {!loaded && !error && !loadError && <p className="py-16 text-center text-sm text-slate-500" role="status">Loading your rules…</p>}
      {loaded && visible.length === 0 && <div className="panel px-6 py-12 text-center"><div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-red-50 text-2xl text-red-500" aria-hidden="true">✦</div><h3 className="text-lg font-bold text-slate-800">{query ? 'No matching rules' : 'Make your tabs easier to find'}</h3><p className="mx-auto mt-2 max-w-sm text-sm leading-relaxed text-slate-500">{query ? 'Try a different title, address, or scope.' : 'Customize a tab using the toolbar button, or add a persistent rule here.'}</p>{!query && <button type="button" className="secondary mt-5" onClick={() => startEdit()}>Add your first rule</button>}</div>}
      <div className="space-y-3">{visible.map(rule => <article key={rule.id} className={`panel p-4 sm:p-5 ${rule.enabled ? '' : 'bg-slate-50'}`} aria-label={`Rule: ${rule.title || rule.match}`}>
        <div className="flex items-start gap-3"><div className={rule.enabled ? '' : 'opacity-40'}><IconPreview icon={rule.icon} size={38}/></div><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><h3 className="break-words font-semibold text-slate-900">{rule.title || 'Original page title'}</h3><span className="badge">{SCOPE_LABELS[rule.scope]}</span>{!rule.enabled && <span className="rounded-full bg-slate-200 px-2 py-1 text-[11px] font-medium text-slate-500">Disabled</span>}</div><p className="mt-2 break-all font-mono text-xs leading-relaxed text-slate-500">{rule.match}</p></div></div>
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 pt-3"><label className="flex items-center gap-2 text-xs text-slate-600"><input type="checkbox" checked={rule.enabled} disabled={busy} onChange={() => void toggle(rule)} aria-label={`Enable rule ${rule.title || rule.match}`}/>{rule.enabled ? 'Enabled' : 'Disabled'}</label><div className="flex gap-4"><button type="button" className="text-button text-xs" disabled={busy} onClick={() => startEdit(rule)} aria-label={`Edit rule ${rule.title || rule.match}`}>Edit</button><button type="button" className="text-button text-xs text-rose-600 hover:text-rose-800" disabled={busy} onClick={() => setDeleting(deleting === rule.id ? null : rule.id)} aria-label={`Delete rule ${rule.title || rule.match}`}>Delete</button></div></div>
        {deleting === rule.id && <div className="mt-3 rounded-xl border border-rose-200 bg-rose-50 p-3"><p className="text-xs leading-relaxed text-rose-800">Delete this rule for all matching tabs? A lower-priority rule may take its place.</p><div className="mt-2 flex gap-4"><button className="text-button text-xs text-rose-700" type="button" disabled={busy} onClick={() => void remove(rule.id)}>Confirm delete rule</button><button className="text-button text-xs text-slate-600" type="button" disabled={busy} onClick={() => setDeleting(null)}>Keep rule</button></div></div>}
      </article>)}</div>
    </section>
    <Backups/>
    <ModuleDiagnostics rules={rules}/>
    <GitHubUpdates busy={busy} hasUnsavedChanges={() => editor !== null}/>
    <details className="mt-7 rounded-xl border border-slate-200 p-4"><summary className="cursor-pointer text-sm font-semibold text-slate-700">How rules are chosen</summary><p className="hint">Temporary tab override → exact URL → URL pattern → domain. An exact Autotask screen rule takes priority over an exact rule for the shared landing page. More specific patterns win; ties use the most recently updated rule, then the rule ID. Disabling or deleting the winning rule can reveal another match.</p><p className="hint">Rules survive navigation, reopened tabs, and Chrome restarts. Temporary tab overrides end when the tab closes or Chrome restarts. Chrome’s protected pages cannot be customized.</p></details>
    <footer className="mt-8 flex flex-wrap justify-between gap-2 border-t border-slate-200 pt-5 text-xs text-slate-500"><span>TabMarker · Local-first, no account required</span><VersionLabel/></footer>
  </main>;
}

createRoot(document.getElementById('root')!).render(<StrictMode><Options/></StrictMode>);
