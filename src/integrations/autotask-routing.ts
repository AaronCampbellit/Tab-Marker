/** Static route values supplied for review; never decode or inspect view-data. */
export const AUTOTASK_VIEWS = Object.freeze({
  'quote-search': 'Quote search',
  'generate-invoices': 'Generate invoices',
  'payment-processing-search': 'Payment processing',
});

export function getAutotaskView(input: string): { id: keyof typeof AUTOTASK_VIEWS; label: string } | null {
  try {
    const url = new URL(input);
    const host = url.hostname.toLowerCase().replace(/\.$/, '');
    if (!['http:', 'https:'].includes(url.protocol)
      || !(host === 'autotask.net' || host.endsWith('.autotask.net'))
      || url.pathname !== '/AutotaskOnyx/LandingPage') return null;
    // Ambiguous or differently cased duplicate keys cannot select a screen.
    const keys = [...url.searchParams.keys()].filter(key => key.toLowerCase() === 'view');
    if (keys.length !== 1 || keys[0] !== 'view') return null;
    const id = url.searchParams.get('view')!;
    if (!Object.hasOwn(AUTOTASK_VIEWS, id)) return null;
    const approvedId = id as keyof typeof AUTOTASK_VIEWS;
    return { id: approvedId, label: AUTOTASK_VIEWS[approvedId] };
  } catch {
    return null;
  }
}
