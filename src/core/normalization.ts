import { getAutotaskView } from '../integrations/autotask-routing';

/** General URL matching excludes query strings and fragments. */
const FORBIDDEN_URL_CHARACTERS = /[\u0000-\u0020\u007f\\]/;

function canonicalHostname(hostname: string): string {
  return hostname.toLowerCase().replace(/\.$/, '');
}

/** A privacy-preserving exact URL; paths retain their case and trailing slash. */
export function normalizeUrl(input: string): string | null {
  if (typeof input !== 'string') return null;
  const value = input.trim();
  if (!value || FORBIDDEN_URL_CHARACTERS.test(value)) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    url.hostname = canonicalHostname(url.hostname);
    if (!url.hostname) return null;
    url.username = '';
    url.password = '';
    url.search = '';
    url.hash = '';
    return url.href;
  } catch {
    return null;
  }
}

/** Only reviewed Autotask screen identifiers may survive query sanitization. */
export function normalizeMatchingUrl(input: string): string | null {
  const normalized = normalizeUrl(input);
  if (!normalized) return null;
  const view = getAutotaskView(input);
  if (!view) return normalized;
  const url = new URL(normalized);
  url.searchParams.set('view', view.id);
  return url.href;
}

/** Domains are hostnames, never origins: a domain rule includes every port. */
export function normalizeDomain(input: string): string {
  if (typeof input !== 'string') throw new Error('Enter a hostname, such as example.com.');
  const value = input.trim();
  if (!value || FORBIDDEN_URL_CHARACTERS.test(value) || /[?\u0023@*]/.test(value)) {
    throw new Error('A domain must be a hostname without a path, credentials, query, or wildcard.');
  }
  try {
    const url = new URL(value.includes('://') ? value : `https://${value}`);
    if (!['http:', 'https:'].includes(url.protocol) || url.pathname !== '/' || url.port || url.username || url.password) {
      throw new Error('invalid domain');
    }
    // URL strips default ports. Reject explicitly supplied ports as well.
    const authority = value.replace(/^https?:\/\//i, '').replace(/\/$/, '');
    if (!/^(?:\[[^\]]+\]|[^:/]+)$/.test(authority)) throw new Error('invalid domain');
    const hostname = canonicalHostname(url.hostname);
    if (!hostname || hostname.includes('*')) throw new Error('invalid domain');
    return hostname;
  } catch {
    throw new Error('A domain must be a hostname without a path or port, such as example.com.');
  }
}

interface ParsedPattern {
  scheme: 'http' | 'https' | '*';
  host: string;
  port: string;
  path: string;
  query: [string, string][];
}

function serializePattern(pattern: ParsedPattern): string {
  const query = new URLSearchParams(pattern.query).toString();
  return `${pattern.scheme}://${pattern.host}${pattern.port ? `:${pattern.port}` : ''}${pattern.path}${query ? `?${query}` : ''}`;
}

function parsePattern(input: string): ParsedPattern {
  const match = /^(https?|\*):\/\/([^/?#]+)(\/[^?#]*)(?:\?([^#]*))?$/i.exec(input);
  if (!match || input.length > 4096 || FORBIDDEN_URL_CHARACTERS.test(input) || match[2].includes('@')) {
    throw new Error('Use an HTTP(S) URL pattern, such as https://ww*.example.com/path/*?view=inventory-order*. Fragments and credentials are not supported; the limit is 4096 characters.');
  }
  const scheme = match[1].toLowerCase() as ParsedPattern['scheme'];
  const authority = /^(\[[0-9a-f:.]+\]|[^:]+)(?::(\d{1,5}))?$/i.exec(match[2]);
  if (!authority) throw new Error('The pattern hostname or port is invalid.');
  const rawHost = authority[1];
  const rawPort = authority[2] ?? '';
  if (rawPort && (Number(rawPort) < 1 || Number(rawPort) > 65535)) {
    throw new Error('A pattern port must be between 1 and 65535.');
  }
  let host: string;
  if (rawHost.startsWith('*.') && !rawHost.slice(2).includes('*')) {
    const domain = normalizeDomain(rawHost.slice(2));
    if (domain.startsWith('[')) throw new Error('An IPv6 hostname cannot have subdomains.');
    host = `*.${domain}`;
  } else if (rawHost.includes('*')) {
    host = canonicalHostname(rawHost).replace(/\*+/g, '*');
    if (!host.split('.').every(label => /^[a-z0-9_*-]+$/.test(label))) {
      throw new Error('Hostname wildcards require ASCII hostname labels. Use punycode for international hostname labels.');
    }
  } else {
    host = normalizeDomain(rawHost);
  }
  const url = new URL(`${scheme === '*' ? 'https' : scheme}://${host.includes('*') ? 'pattern.invalid' : host}${match[3]}`);
  const query = [...new URLSearchParams(match[4] ?? '').entries()];
  const keys = new Set<string>();
  for (const [key, value] of query) {
    if (!key || key.includes('*') || /[\u0000-\u001f\u007f]/.test(key + value)) {
      throw new Error('Query filters need literal parameter names and values without control characters. Place * in the value, for example view=inventory-order*.');
    }
    if (keys.has(key)) throw new Error('Use each query parameter only once in a pattern.');
    keys.add(key);
  }
  query.sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0);
  const pattern: ParsedPattern = {
    scheme,
    host,
    port: rawPort ? String(Number(rawPort)) : '',
    path: url.pathname.replace(/\*+/g, '*'),
    query: query.map(([key, value]) => [key, value.replace(/\*+/g, '*')]),
  };
  if (serializePattern(pattern).length > 4096) throw new Error('The normalized URL pattern must contain at most 4096 characters.');
  return pattern;
}

/** Small, explicit grammar; intentionally not a regular-expression input. */
export function normalizePattern(input: string): string {
  if (typeof input !== 'string') throw new Error('Enter a URL pattern.');
  return serializePattern(parsePattern(input.trim()));
}

function hostMatches(pattern: string, hostname: string): boolean {
  // Preserve the original *.example.com behavior, including the apex domain.
  if (pattern.startsWith('*.') && !pattern.slice(2).includes('*') && hostname === pattern.slice(2)) return true;
  return pathMatches(pattern, hostname);
}

/** Greedy glob matching avoids the exponential backtracking of repeated .* regexes. */
function pathMatches(pattern: string, path: string): boolean {
  let patternIndex = 0;
  let pathIndex = 0;
  let lastStar = -1;
  let retryFrom = 0;
  while (pathIndex < path.length) {
    if (pattern[patternIndex] === '*') {
      lastStar = patternIndex++;
      retryFrom = pathIndex;
    } else if (pattern[patternIndex] === path[pathIndex]) {
      patternIndex++;
      pathIndex++;
    } else if (lastStar >= 0) {
      patternIndex = lastStar + 1;
      pathIndex = ++retryFrom;
    } else {
      return false;
    }
  }
  while (pattern[patternIndex] === '*') patternIndex++;
  return patternIndex === pattern.length;
}

/** Invalid patterns or non-web URLs never match. Missing ports match any port. */
export function patternMatches(pattern: string, input: string): boolean {
  const normalized = normalizeUrl(input);
  if (!normalized) return false;
  try {
    const parsed = parsePattern(pattern.trim());
    const url = new URL(normalized);
    if (parsed.scheme !== '*' && `${parsed.scheme}:` !== url.protocol) return false;
    if (!hostMatches(parsed.host, url.hostname)) return false;
    if (parsed.port && parsed.port !== (url.port || (url.protocol === 'https:' ? '443' : '80'))) return false;
    if (!pathMatches(parsed.path, url.pathname)) return false;
    const actualQuery = new URL(input).searchParams;
    return parsed.query.every(([key, value]) => {
      const actualValues = actualQuery.getAll(key);
      return actualValues.length === 1 && pathMatches(value, actualValues[0]);
    });
  } catch {
    return false;
  }
}
