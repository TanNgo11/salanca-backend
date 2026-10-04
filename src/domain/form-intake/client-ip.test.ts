import { describe, expect, it } from 'vitest';

import { INTAKE_SECRET_HEADER, resolveClientIp, VISITOR_IP_HEADER } from './client-ip';

const SECRET = 'shared-secret-value';
const ctxWith = (headers: Record<string, string>) => ({
  request: { ip: '10.0.0.9', headers },
});

describe('resolveClientIp', () => {
  it('uses the socket IP when no shared secret is configured', () => {
    const ctx = ctxWith({ [INTAKE_SECRET_HEADER]: SECRET, [VISITOR_IP_HEADER]: '203.0.113.7' });
    expect(resolveClientIp(ctx, {})).toBe('10.0.0.9');
  });

  it('ignores the visitor IP when the secret is wrong', () => {
    const ctx = ctxWith({ [INTAKE_SECRET_HEADER]: 'nope', [VISITOR_IP_HEADER]: '203.0.113.7' });
    expect(resolveClientIp(ctx, { FORM_INTAKE_SHARED_SECRET: SECRET })).toBe('10.0.0.9');
  });

  it('ignores a malformed visitor IP even with the right secret', () => {
    const ctx = ctxWith({ [INTAKE_SECRET_HEADER]: SECRET, [VISITOR_IP_HEADER]: 'not-an-ip' });
    expect(resolveClientIp(ctx, { FORM_INTAKE_SHARED_SECRET: SECRET })).toBe('10.0.0.9');
  });

  it('uses the visitor IP when secret and IP are valid', () => {
    const ctx = ctxWith({ [INTAKE_SECRET_HEADER]: SECRET, [VISITOR_IP_HEADER]: '2001:db8::1' });
    expect(resolveClientIp(ctx, { FORM_INTAKE_SHARED_SECRET: SECRET })).toBe('2001:db8::1');
  });

  it('falls back to unknown when nothing is available', () => {
    expect(resolveClientIp({}, {})).toBe('unknown');
  });
});
