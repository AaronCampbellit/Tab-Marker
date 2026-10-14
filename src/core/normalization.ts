/** URL matching deliberately excludes query strings and fragments. */
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
}

function parsePattern(input: string): ParsedPattern {
  const match = /^(https?|\*):\/\/([^/]+)(\/.*)$/i.exec(input);
  if (!match || FORBIDDEN_URL_CHARACTERS.test(input) || /[?\u0023@]/.test(input)) {
    throw new Error('Use a URL pattern such as https://*.example.com/path/*; queries and fragments are not supported.');
  }
  const scheme = match[1].toLowerCase() as ParsedPattern['scheme'];
  const authority = /^(\[[0-9a-f:.]+\]|[^:]+)(?::(\d{1,5}))?$/i.exec(match[2]);
  if (!authority) throw new Error('The pattern hostname or port is invalid.');
  const rawHost = authority[1];
  const rawPort = authority[2] ?? '';
  if (rawPort && (Number(rawPort) < 1 || Number(rawPort) > 65535)) {
    throw new Error('A pattern port must be between 1 and 65535.');
  }
  const subdomains = rawHost.startsWith('*.');
  const hostOnly = subdomains ? rawHost.slice(2) : rawHost;
  if (!hostOnly || (hostOnly !== '*' && hostOnly.includes('*')) || (subdomains && hostOnly === '*')) {
    throw new Error('Only * or a leading *. is supported in a pattern hostname.');
  }
  const canonicalHost = hostOnly === '*' ? '*' : normalizeDomain(hostOnly);
  if (subdomains && canonicalHost.startsWith('[')) throw new Error('An IPv6 hostname cannot have subdomains.');
  const url = new URL(`${scheme === '*' ? 'https' : scheme}://${canonicalHost === '*' ? 'pattern.invalid' : canonicalHost}/${match[3].slice(1)}`);
  return {
    scheme,
    host: `${subdomains ? '*.' : ''}${canonicalHost}`,
    port: rawPort ? String(Number(rawPort)) : '',
    path: url.pathname.replace(/\*+/g, '*'),
  };
}

/** Small, explicit grammar; intentionally not a regular-expression input. */
export function normalizePattern(input: string): string {
  if (typeof input !== 'string') throw new Error('Enter a URL pattern.');
  const pattern = parsePattern(input.trim());
  return `${pattern.scheme}://${pattern.host}${pattern.port ? `:${pattern.port}` : ''}${pattern.path}`;
}

function hostMatches(pattern: string, hostname: string): boolean {
  if (pattern === '*') return true;
  if (!pattern.startsWith('*.')) return pattern === hostname;
  const domain = pattern.slice(2);
  return hostname === domain || hostname.endsWith(`.${domain}`);
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
    return pathMatches(parsed.path, url.pathname);
  } catch {
    return false;
  }
}
