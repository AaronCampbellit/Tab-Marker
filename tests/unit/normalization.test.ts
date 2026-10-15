import { describe, expect, it } from 'vitest';
import { normalizeDomain, normalizePattern, normalizeUrl, patternMatches } from '../../src/core/normalization';

describe('privacy-preserving exact URL normalization', () => {
  it('removes credentials, the complete query, and fragments', () => {
    expect(normalizeUrl('HTTPS://user:secret@EXAMPLE.COM:443/Module/View/?ticket=123&token=secret#customer')).toBe('https://example.com/Module/View/');
  });
  it('canonicalizes IDNs, default ports, dot segments, and trailing host dots', () => {
    expect(normalizeUrl('http://BÜCHER.example.:80/a/../C')).toBe('http://xn--bcher-kva.example/C');
  });
  it('preserves path case, trailing slashes, and nondefault ports', () => {
    expect(normalizeUrl('https://example.com:8443/Module/')).toBe('https://example.com:8443/Module/');
    expect(normalizeUrl('https://example.com/Module')).not.toBe(normalizeUrl('https://example.com/module'));
    expect(normalizeUrl('https://example.com/Module')).not.toBe(normalizeUrl('https://example.com/Module/'));
  });
  it.each(['chrome://settings', 'file:///tmp/page.html', 'data:text/html,hello', 'javascript:alert(1)', 'about:blank', 'invalid', '', 'https://example.com/a\nb', 'https://example.com\\oops'])('rejects unsupported or ambiguous URL %s', value => {
    expect(normalizeUrl(value)).toBeNull();
  });
});

describe('domain normalization', () => {
  it.each([
    [' Example.COM ', 'example.com'],
    ['https://BÜCHER.example/', 'xn--bcher-kva.example'],
    ['http://EXAMPLE.com.', 'example.com'],
    ['localhost', 'localhost'],
    ['[::1]', '[::1]'],
  ])('normalizes %s', (input, expected) => {
    expect(normalizeDomain(input)).toBe(expected);
  });
  it.each(['example.com/path', 'example.com:443', 'https://example.com:443', 'user@host.com', '*.example.com', 'example.com?key=value', 'example.com#fragment', 'ftp://example.com', '', 'https://example.com//'])('rejects non-hostname %s', input => {
    expect(() => normalizeDomain(input)).toThrow();
  });
});

describe('limited, explicit URL patterns', () => {
  it('canonicalizes a pattern without weakening path case or an explicit port', () => {
    expect(normalizePattern(' HTTPS://*.BÜCHER.example:0443/Module/* ')).toBe('https://*.xn--bcher-kva.example:443/Module/*');
    expect(normalizePattern('https://example.com/a/***/b**')).toBe('https://example.com/a/*/b*');
  });
  it('handles adversarial wildcard no-matches without regex backtracking', () => {
    const pattern = `https://example.com/${'*a'.repeat(40)}b`;
    expect(patternMatches(pattern, `https://example.com/${'a'.repeat(1600)}`)).toBe(false);
    expect(patternMatches(pattern, `https://example.com/${'a'.repeat(1600)}b`)).toBe(true);
    expect(patternMatches('https://example.com/*a', 'https://example.com/*ba')).toBe(true);
  });
  it.each([
    ['*://*.example.com/Module/*', 'https://example.com/Module/42?secret=x', true],
    ['*://*.example.com/Module/*', 'http://sub.example.com:8080/Module/42#secret', true],
    ['*://*.example.com/Module/*', 'https://notexample.com/Module/42', false],
    ['*://*.example.com/Module/*', 'https://example.com.attacker.test/Module/42', false],
    ['https://example.com/Module/*', 'http://example.com/Module/42', false],
    ['https://example.com/Module/*', 'https://example.com/module/42', false],
    ['https://example.com/Module/*', 'https://sub.example.com/Module/42', false],
    ['https://example.com:443/*', 'https://example.com/page', true],
    ['*://example.com:80/*', 'http://example.com/page', true],
    ['*://example.com:80/*', 'https://example.com/page', false],
    ['https://example.com/*', 'https://example.com:8443/page', true],
    ['https://*/page.*', 'https://anything.test/page.htm', true],
    ['https://example.com/a(b)/*', 'https://example.com/ab/42', false],
    ['https://[::1]:8443/*', 'https://[::1]:8443/page', true],
  ])('%s against %s = %s', (pattern, url, expected) => {
    expect(patternMatches(pattern, url)).toBe(expected);
  });
  it.each(['ftp://example.com/*', 'https://example.com', 'https://example.com/*#x', 'https://user:pass@example.com/*', 'https://example.com:0/*', 'https://example.com:65536/*', 'https://*.[::1]/*', 'https://ww*..example.com/*', 'https://ww%2a.example.com/*', 'https://example.com/a b'])('rejects unsupported pattern %s', pattern => {
    expect(() => normalizePattern(pattern)).toThrow();
    expect(patternMatches(pattern, 'https://example.com/page')).toBe(false);
  });
});
