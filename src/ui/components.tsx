import { useId } from 'react';
import type { Customization, IconSpec, RuleScope } from '../shared/types';

export const SCOPE_LABELS: Record<RuleScope | 'tab', string> = {
  tab: 'This tab only', exact: 'Exact URL', pattern: 'URL pattern', domain: 'Entire domain',
};

const SCOPE_HELP = {
  tab: {
    summary: 'Temporary. Labels this open tab as you browse. Ends when you close the tab, restart Chrome, or reload TabMarker.',
    example: 'Use for a one-off label. Reopening the page in a new tab will not carry it over.',
  },
  exact: {
    summary: 'Saved for future visits. Labels one website address and page path. Usually ignores everything after ? or #.',
    example: 'Example: example.com/work matches that page; example.com/other is a different page.',
  },
  pattern: {
    summary: 'Saved for future visits. Labels a group of pages. Use * to match any text in the website name, path, or query values after ?.',
    example: 'Example: https://example.com/work/* matches pages under /work/. Only query filters included in your pattern are checked.',
  },
  domain: {
    summary: 'Saved for future visits. Labels every page on this website and its subdomains, using either HTTP or HTTPS.',
    example: 'Example: example.com covers /work, /other, and support.example.com. Use when the whole website should share a label.',
  },
} satisfies Record<RuleScope | 'tab', { summary: string; example: string }>;

export function ScopeHelp({ scope, id, viewLabel }: { scope: RuleScope | 'tab'; id: string; viewLabel?: string }) {
  const help = SCOPE_HELP[scope];
  return <div id={id} aria-live="polite">
    <p className="hint">{help.summary}</p>
    <p className="hint">{scope === 'exact' && viewLabel ? `This recognized Autotask screen is matched separately: ${viewLabel}.` : help.example}</p>
  </div>;
}

export interface AppearanceForm {
  title: string;
  keepIcon: boolean;
  color: string;
  glyph: string;
}

export function appearanceFrom(value: Customization | null): AppearanceForm {
  return {
    title: value?.title ?? '',
    keepIcon: value !== null && value.icon === null,
    color: value?.icon?.color ?? '#c62828',
    glyph: value?.icon?.glyph ?? 'T',
  };
}

export function customizationFrom(value: AppearanceForm): Customization {
  return { title: value.title.trim() || null, icon: value.keepIcon ? null : { color: value.color, glyph: value.glyph.trim() } };
}

export function Brand({ subtitle, compact = false }: { subtitle: string; compact?: boolean }) {
  return <header className={`flex items-center gap-3 ${compact ? 'brand-compact' : 'mb-8'}`}>
    <div className="brand-mark flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-red-600 text-white shadow-xs" aria-hidden="true">
      <svg width="25" height="25" viewBox="0 0 24 24" fill="none"><path d="M8 5h11v13M5 8h11v12H5z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/><path d="M8 12h5M10.5 12v5" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round"/></svg>
    </div>
    <div><h1 className="text-xl font-bold tracking-tight text-slate-900">TabMarker</h1><p className="mt-0.5 text-xs text-slate-500">{subtitle}</p></div>
  </header>;
}

export function IconPreview({ icon, size = 30 }: { icon: IconSpec | null; size?: number }) {
  const foreground = icon && (Number.parseInt(icon.color.slice(1, 3), 16) * 299 + Number.parseInt(icon.color.slice(3, 5), 16) * 587 + Number.parseInt(icon.color.slice(5, 7), 16) * 114) / 1000 >= 150 ? '#111827' : '#ffffff';
  return icon ? <svg width={size} height={size} viewBox="0 0 64 64" role="img" aria-label={`Custom icon: ${icon.glyph}`} className="shrink-0 rounded-lg">
    <rect width="64" height="64" rx="13" fill={icon.color}/><text x="32" y="34" dominantBaseline="middle" textAnchor="middle" fontFamily="Arial, sans-serif" fontSize="44" fontWeight="700" fill={foreground}>{icon.glyph || '?'}</text>
  </svg> : <span aria-label="Original page icon" style={{ width: size, height: size }} className="inline-flex shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-400"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true"><circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.5"/><path d="M3 12h18M12 3c5 5 5 13 0 18-5-5-5-13 0-18Z" stroke="currentColor" strokeWidth="1.5"/></svg></span>;
}

export function AppearanceFields({ value, onChange, disabled = false, compact = false }: { value: AppearanceForm; onChange: (value: AppearanceForm) => void; disabled?: boolean; compact?: boolean }) {
  const id = useId();
  function change(patch: Partial<AppearanceForm>) { onChange({ ...value, ...patch }); }
  if (compact) return <div className="appearance-compact">
    <div><label className="label" htmlFor={`${id}-title`}>Tab title <span className="label-note" aria-hidden="true">optional</span></label><input id={`${id}-title`} className="field" value={value.title} maxLength={120} disabled={disabled} placeholder="Keep page title" aria-label="Tab title" onChange={e => change({ title: e.target.value })} title="Leave blank to keep the page title. Up to 120 characters."/></div>
    <div className="icon-editor"><div className="flex items-center justify-between gap-2"><span className="label mb-0">Tab icon</span><label className="flex items-center gap-2 text-xs text-slate-600"><input type="checkbox" checked={value.keepIcon} disabled={disabled} onChange={e => change({ keepIcon: e.target.checked })}/>Keep page icon</label></div>
      {!value.keepIcon && <div className="mt-2 flex items-end gap-3"><div><label className="label" htmlFor={`${id}-color`}>Icon color</label><input id={`${id}-color`} className="field h-[38px] w-14" type="color" value={value.color} disabled={disabled} onChange={e => change({ color: e.target.value })}/></div><div className="min-w-0 flex-1"><label className="label" htmlFor={`${id}-glyph`}>Icon symbol</label><input id={`${id}-glyph`} className="field" value={value.glyph} maxLength={8} disabled={disabled} onChange={e => change({ glyph: e.target.value })} placeholder="T" required title="One letter, number or symbol"/></div><div className="pb-1" aria-label="Tab preview"><IconPreview icon={{ color: value.color, glyph: value.glyph }} size={30}/></div></div>}
    </div>
  </div>;
  return <div className="space-y-4">
    <div><label className="label" htmlFor={`${id}-title`}>Tab title</label><input id={`${id}-title`} className="field" value={value.title} maxLength={120} disabled={disabled} placeholder="e.g. Service desk" onChange={e => change({ title: e.target.value })} aria-describedby={`${id}-title-hint`}/><p id={`${id}-title-hint`} className="hint">Leave blank to keep the page title. Up to 120 characters.</p></div>
    <div>
      <div className="mb-3 flex items-center justify-between gap-2"><span className="text-sm font-semibold text-slate-700">Favicon</span><label className="flex items-center gap-2 text-xs text-slate-600"><input type="checkbox" checked={value.keepIcon} disabled={disabled} onChange={e => change({ keepIcon: e.target.checked })}/>Keep page icon</label></div>
      {!value.keepIcon && <div className="grid grid-cols-[1fr_1fr] gap-3"><div><label className="label" htmlFor={`${id}-color`}>Icon color</label><div className="flex gap-2"><input id={`${id}-color`} className="field h-[42px] w-14 shrink-0" type="color" value={value.color} disabled={disabled} onChange={e => change({ color: e.target.value })}/><span className="flex items-center font-mono text-xs text-slate-500" aria-hidden="true">{value.color.toUpperCase()}</span></div></div><div><label className="label" htmlFor={`${id}-glyph`}>Icon symbol</label><input id={`${id}-glyph`} className="field" value={value.glyph} maxLength={8} disabled={disabled} onChange={e => change({ glyph: e.target.value })} placeholder="T" required aria-describedby={`${id}-glyph-hint`}/></div><p id={`${id}-glyph-hint`} className="col-span-2 text-xs text-slate-500">Use a letter, number, or symbol. Emoji appearance depends on your system.</p></div>}
    </div>
    <div className="flex min-w-0 items-center gap-3 rounded-xl border border-slate-200 bg-slate-50 p-3" aria-label="Tab preview"><IconPreview icon={value.keepIcon ? null : { color: value.color, glyph: value.glyph }}/><div className="min-w-0"><p className="truncate text-sm font-semibold text-slate-800">{value.title.trim() || 'Original page title'}</p><p className="mt-0.5 text-[11px] text-slate-500">Tab preview</p></div></div>
  </div>;
}

export function Feedback({ error, success }: { error: string; success: string }) {
  return <>{error && <p role="alert" className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm leading-relaxed text-rose-800">{error}</p>}{success && <p role="status" className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm leading-relaxed text-emerald-800">{success}</p>}</>;
}
