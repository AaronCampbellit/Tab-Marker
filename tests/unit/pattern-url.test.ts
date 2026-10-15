import { describe, expect, it } from 'vitest';
import { normalizeUrl, patternMatches, urlForPattern } from '../../src/core/normalization';

describe('current URL as an unsaved pattern draft', () => {
  it('keeps unrecognized Autotask views and query filters without adding a wildcard', () => {
    const address = 'https://ww12.autotask.net/AutotaskOnyx/LandingPage?view=inventory-order-search&mode=grid';
    const draft = urlForPattern(address)!;
    expect(draft).toBe(address);
    expect(patternMatches(draft, address)).toBe(true);
    expect(patternMatches(draft, address.replace('inventory-order-search', 'inventory-receipts'))).toBe(false);
    expect(normalizeUrl(address)).not.toContain('?');
  });

  it('keeps encoded query values but removes credentials and unsupported fragments', () => {
    const draft = urlForPattern('https://user:password@Example.com/work?label=hello%20world&next=%2Fwork%3Fmode%3Dgrid#section');
    expect(draft).toBe('https://example.com/work?label=hello%20world&next=%2Fwork%3Fmode%3Dgrid');
    expect(patternMatches(draft!, 'https://example.com/work?next=%2Fwork%3Fmode%3Dgrid&label=hello+world')).toBe(true);
  });

  it.each(['chrome://extensions', 'file:///C:/private.txt', 'javascript:alert(1)', 'not a URL'])('rejects a non-website URL: %s', address => {
    expect(urlForPattern(address)).toBeNull();
  });
});
