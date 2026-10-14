import { describe, expect, it } from 'vitest';
import {
  APPROVED_AUTOTASK_ADAPTERS,
  getPageDiagnostics,
  inspectApprovedAutotaskModules,
} from '../../src/integrations/autotask';

// No DOM content needs to be read until a static adapter has been reviewed.
const unreadableDocument = new Proxy({} as Document, {
  get() { throw new Error('Diagnostics must not read unapproved DOM content'); },
});

describe('privacy-preserving page diagnostics', () => {
  it('returns only coarse categories despite sensitive data in every input area', () => {
    const result = getPageDiagnostics(
      'https://customer:password@ww1.autotask.net/Acme%20Customer/Jane%20Doe/123/550e8400-e29b-41d4-a716-446655440000/secretToken01234567890123456789?module=CustomerRecords&view=AuthenticationToken&page=Confidential&action=EditCustomer&ssn=555123456&CustomerUniqueKey=Contact#PrivateTicketDetails',
      unreadableDocument,
    );
    expect(result).toEqual({
      formatVersion: 1,
      siteKind: 'autotask',
      protocol: 'https:',
      pathSegmentKinds: ['text', 'text', 'number', 'uuid', 'opaque'],
      queryKeyCategories: ['module', 'view', 'page', 'action', 'other-keys-present'],
      hasFragment: true,
      approvedModuleId: null,
      approvedSignals: {},
      note: expect.any(String),
    });
    const serialized = JSON.stringify(result);
    for (const privateValue of [
      'customer', 'password', 'ww1.autotask.net', 'Acme', 'Jane', '123',
      '550e8400', 'secretToken', 'CustomerRecords', 'AuthenticationToken',
      'Confidential', 'EditCustomer', 'ssn', '555123456', 'CustomerUniqueKey',
      'PrivateTicketDetails',
    ]) expect(serialized).not.toContain(privateValue);
    expect(result.note).toContain('cannot identify module routes');
  });

  it.each([
    ['https://autotask.net/', 'autotask'],
    ['https://WW1.AUTOTASK.NET/', 'autotask'],
    ['https://ww1.autotask.net./', 'autotask'],
    ['https://autotask.net.example.com/', 'ordinary'],
    ['https://notautotask.net/', 'ordinary'],
    ['http://example.com/', 'ordinary'],
  ] as const)('classifies %s without exposing its hostname', (url, siteKind) => {
    expect(getPageDiagnostics(url, unreadableDocument).siteKind).toBe(siteKind);
  });

  it('limits paths to twenty decoded segment categories without returning malformed data', () => {
    const path = ['%31%32%33', '%zz', 'x'.repeat(24), ...Array.from({ length: 30 }, (_, i) => `Customer${i}`)].join('/');
    const result = getPageDiagnostics(`https://example.com/${path}`, unreadableDocument);
    expect(result.pathSegmentKinds).toHaveLength(20);
    expect(result.pathSegmentKinds.slice(0, 3)).toEqual(['number', 'text', 'opaque']);
    expect(JSON.stringify(result)).not.toContain('Customer');
    expect(JSON.stringify(result)).not.toContain('%zz');
  });

  it('reports known key presence once in a deterministic order and hides unknown names', () => {
    const result = getPageDiagnostics('https://example.com/?VIEW=SecretA&module=SecretB&view=SecretC&privateTokenName=SecretD', unreadableDocument);
    expect(result.queryKeyCategories).toEqual(['module', 'view', 'other-keys-present']);
    expect(JSON.stringify(result)).not.toContain('Secret');
    expect(JSON.stringify(result)).not.toContain('privateTokenName');
  });

  it('returns no invented module IDs or DOM signals', () => {
    expect(APPROVED_AUTOTASK_ADAPTERS).toEqual([]);
    expect(Object.isFrozen(APPROVED_AUTOTASK_ADAPTERS)).toBe(true);
    expect(inspectApprovedAutotaskModules(new URL('https://ww1.autotask.net/UnverifiedModule'), unreadableDocument))
      .toEqual({ approvedModuleId: null, approvedSignals: {} });
  });

  it.each(['chrome://settings/', 'chrome-extension://id/options.html', 'file:///private/customer.txt', 'data:text/html,Secret', 'not a URL Secret'])('rejects unsupported input with a fixed safe error', (url) => {
    expect(() => getPageDiagnostics(url, unreadableDocument)).toThrow('Diagnostics require a valid HTTP or HTTPS page.');
  });

  it('excludes title, document text, arbitrary attributes, and DOM element identifiers', () => {
    const document = {
      title: 'Private Customer Title',
      body: { textContent: 'Private ticket, authentication token, and contact name' },
      querySelector: () => ({ id: 'SecretCustomerIdentifier', textContent: 'PrivateCustomer' }),
    } as unknown as Document;
    const result = getPageDiagnostics('https://ww1.autotask.net/', document);
    expect(result.approvedModuleId).toBeNull();
    expect(result.approvedSignals).toEqual({});
    expect(JSON.stringify(result)).not.toMatch(/Private|Secret|CustomerIdentifier/);
  });
});
