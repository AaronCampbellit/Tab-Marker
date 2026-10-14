import type { Diagnostics } from '../shared/types';

/** Only reviewed, static signatures belong here. Never discover selectors from page text. */
export interface AutotaskModuleAdapter {
  readonly id: string;
  readonly pathPatterns?: readonly RegExp[];
  readonly domSignals?: readonly {
    readonly id: string;
    readonly selector: string;
  }[];
}

/** No Autotask module routes or DOM identifiers have been verified yet. */
export const APPROVED_AUTOTASK_ADAPTERS: readonly AutotaskModuleAdapter[] = Object.freeze([]);

type ApprovedIdentification = Pick<Diagnostics, 'approvedModuleId' | 'approvedSignals'>;
type PageDiagnostics = Omit<Diagnostics, 'matchingScope' | 'nativeTabMenu'>;

const ROUTING_KEYS = ['module', 'view', 'page', 'action'] as const;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isAutotaskHostname(hostname: string): boolean {
  const normalized = hostname.toLowerCase().replace(/\.$/, '');
  return normalized === 'autotask.net' || normalized.endsWith('.autotask.net');
}

/**
 * Exposes approved identifiers and boolean presence only, never element values,
 * attributes, text, URL captures, or discovered DOM names. Multiple matches are
 * deliberately unresolved until signatures can distinguish them.
 */
export function inspectApprovedAutotaskModules(url: URL, document: Document): ApprovedIdentification {
  const approvedSignals: Record<string, boolean> = {};
  const matchingModules: string[] = [];
  if (!isAutotaskHostname(url.hostname)) return { approvedModuleId: null, approvedSignals };

  for (const adapter of APPROVED_AUTOTASK_ADAPTERS) {
    const pathPatterns = adapter.pathPatterns ?? [];
    const domSignals = adapter.domSignals ?? [];
    const routeMatches = pathPatterns.map((pattern, index) => {
      // Clone to avoid lastIndex state in accidental global/sticky expressions.
      const matched = new RegExp(pattern.source, pattern.flags).test(url.pathname);
      approvedSignals[`${adapter.id}:path:${index}`] = matched;
      return matched;
    });
    const domMatches = domSignals.map((signal) => {
      let matched = false;
      try {
        matched = document.querySelector(signal.selector) !== null;
      } catch {
        // A bad future selector must not leak selector text through an error.
      }
      approvedSignals[`${adapter.id}:dom:${signal.id}`] = matched;
      return matched;
    });
    const hasSignature = pathPatterns.length > 0 || domSignals.length > 0;
    const pathMatches = pathPatterns.length === 0 || routeMatches.some(Boolean);
    if (hasSignature && pathMatches && domMatches.every(Boolean)) matchingModules.push(adapter.id);
  }

  return {
    approvedModuleId: matchingModules.length === 1 ? matchingModules[0] : null,
    approvedSignals,
  };
}

function classifyPathSegment(segment: string): Diagnostics['pathSegmentKinds'][number] {
  let decoded = segment;
  try {
    decoded = decodeURIComponent(segment);
  } catch {
    // Invalid encoding is still classified without returning the input.
  }
  if (UUID.test(decoded)) return 'uuid';
  if (/^\d+$/.test(decoded)) return 'number';
  if (decoded.length >= 24) return 'opaque';
  return 'text';
}

/**
 * Called only for an explicit diagnostic request. This function does not store,
 * log, or transmit data. Its result is intentionally too coarse to infer routes;
 * live application access is needed to approve useful module signatures.
 */
export function getPageDiagnostics(url: string, document: Document): PageDiagnostics {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error('Diagnostics require a valid HTTP or HTTPS page.');
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('Diagnostics require a valid HTTP or HTTPS page.');
  }

  const queryKeys = new Set<string>();
  let unknownKeysPresent = false;
  for (const key of parsed.searchParams.keys()) {
    const normalized = key.toLowerCase();
    if (ROUTING_KEYS.some((allowed) => allowed === normalized)) queryKeys.add(normalized);
    else unknownKeysPresent = true;
  }
  const queryKeyCategories: string[] = ROUTING_KEYS.filter((key) => queryKeys.has(key));
  if (unknownKeysPresent) queryKeyCategories.push('other-keys-present');

  const siteKind = isAutotaskHostname(parsed.hostname) ? 'autotask' : 'ordinary';
  return {
    formatVersion: 1,
    siteKind,
    protocol: parsed.protocol,
    pathSegmentKinds: parsed.pathname.split('/').filter(Boolean).slice(0, 20).map(classifyPathSegment),
    queryKeyCategories,
    hasFragment: parsed.hash.length > 0,
    ...inspectApprovedAutotaskModules(parsed, document),
    note: siteKind === 'autotask'
      ? 'No Autotask module signatures have been verified. This coarse summary cannot identify module routes. Live application access is required to review static route and optional DOM-presence signatures.'
      : 'Coarse local diagnostics only. URL values and page contents are excluded; module identification is available only for approved Autotask signatures.',
  };
}
