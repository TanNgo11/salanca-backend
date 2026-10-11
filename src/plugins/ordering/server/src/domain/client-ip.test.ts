import { describe, expect, it } from 'vitest';

import { resolveClientIp } from './client-ip';

const config = {
  sharedSecret: 'web-secret',
  secretHeader: 'X-Salanca-Intake-Secret',
  ipHeader: 'X-Salanca-Visitor-Ip',
};

const ctx = (headers: Record<string, string>) => ({
  request: { ip: '10.0.0.1', headers },
});

describe('resolveClientIp', () => {
  it('uses the socket IP when no trust config or secret is set', () => {
    expect(resolveClientIp(ctx({ 'x-salanca-visitor-ip': '1.2.3.4' }))).toBe('10.0.0.1');
    expect(
      resolveClientIp(ctx({ 'x-salanca-visitor-ip': '1.2.3.4' }), { ...config, sharedSecret: '' }),
    ).toBe('10.0.0.1');
  });

  it('ignores the forwarded IP when the secret is missing or wrong', () => {
    expect(resolveClientIp(ctx({ 'x-salanca-visitor-ip': '1.2.3.4' }), config)).toBe('10.0.0.1');
    expect(
      resolveClientIp(
        ctx({ 'x-salanca-intake-secret': 'nope', 'x-salanca-visitor-ip': '1.2.3.4' }),
        config,
      ),
    ).toBe('10.0.0.1');
  });

  it('ignores a junk forwarded value even with the right secret', () => {
    expect(
      resolveClientIp(
        ctx({ 'x-salanca-intake-secret': 'web-secret', 'x-salanca-visitor-ip': 'not-an-ip' }),
        config,
      ),
    ).toBe('10.0.0.1');
  });

  it('trusts the forwarded IPv4/IPv6 with the right secret', () => {
    expect(
      resolveClientIp(
        ctx({ 'x-salanca-intake-secret': 'web-secret', 'x-salanca-visitor-ip': '1.2.3.4' }),
        config,
      ),
    ).toBe('1.2.3.4');
    expect(
      resolveClientIp(
        ctx({ 'x-salanca-intake-secret': 'web-secret', 'x-salanca-visitor-ip': '2001:db8::1' }),
        config,
      ),
    ).toBe('2001:db8::1');
  });

  it('falls back to ctx.ip and then "unknown"', () => {
    expect(resolveClientIp({ ip: '10.0.0.9' })).toBe('10.0.0.9');
    expect(resolveClientIp({})).toBe('unknown');
  });
});
