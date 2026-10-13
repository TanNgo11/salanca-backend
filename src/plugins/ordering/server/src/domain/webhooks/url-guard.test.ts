import { describe, expect, it } from 'vitest';

import { OrderingError } from '../errors';
import { checkWebhookUrl, displayUrl, isPrivateAddress } from './url-guard';

const resolves = (addresses: string[]) => async () => addresses;

const reason = async (input: string, options: Parameters<typeof checkWebhookUrl>[1] = {}) => {
  try {
    await checkWebhookUrl(input, options);
    return 'accepted';
  } catch (error) {
    expect(error).toBeInstanceOf(OrderingError);
    return (error as OrderingError).details?.reason;
  }
};

describe('checkWebhookUrl scheme rules', () => {
  it('accepts https and returns resolved addresses', async () => {
    const checked = await checkWebhookUrl('https://hooks.example.com/order?token=abc', {
      lookupAddresses: resolves(['93.184.216.34']),
    });
    expect(checked.hostname).toBe('hooks.example.com');
    expect(checked.addresses).toEqual(['93.184.216.34']);
  });

  it.each(['http://a.example/', 'ftp://a.example/', 'file:///etc/passwd', 'javascript:alert(1)'])(
    'rejects %s as scheme',
    async (input) => {
      expect(await reason(input, { lookupAddresses: resolves(['93.184.216.34']) })).toBe('scheme');
    },
  );

  it('allows http only when allowHttp is set', async () => {
    const checked = await checkWebhookUrl('http://a.example/', {
      allowHttp: true,
      lookupAddresses: resolves(['93.184.216.34']),
    });
    expect(checked.url.protocol).toBe('http:');
  });

  it.each(['not-a-url', 'https://', 'https://user:pw@a.example/'])(
    'rejects %s',
    async (input) => {
      expect(await reason(input)).not.toBe('accepted');
    },
  );
});

describe('checkWebhookUrl private addresses', () => {
  it.each([
    'https://127.0.0.1/',
    'https://127.1/',
    'https://2130706433/', // 127.0.0.1 as a decimal
    'https://0x7f000001/',
    'https://10.1.2.3/',
    'https://172.16.5.5/',
    'https://172.31.255.1/',
    'https://192.168.1.1/',
    'https://169.254.169.254/', // cloud metadata
    'https://100.64.1.1/', // CGNAT
    'https://0.0.0.0/',
    'https://224.0.0.1/',
    'https://255.255.255.255/',
    'https://[::1]/',
    'https://[::ffff:127.0.0.1]/',
    'https://[::ffff:7f00:1]/',
    'https://[fd00::1]/',
    'https://[fe80::1]/',
    'https://[ff02::1]/',
    'https://[64:ff9b::7f00:1]/', // NAT64-wrapped loopback
    'https://[2002:7f00:1::]/', // 6to4 of 127.0.0.1
  ])('rejects %s as private-address', async (input) => {
    expect(await reason(input)).toBe('private-address');
  });

  it.each(['https://localhost/', 'https://api.localhost/', 'https://db.internal/', 'https://printer.local/'])(
    'rejects %s as private-address before DNS',
    async (input) => {
      expect(await reason(input, { lookupAddresses: resolves(['93.184.216.34']) })).toBe(
        'private-address',
      );
    },
  );

  it('rejects DNS answers pointing at private space', async () => {
    expect(
      await reason('https://a.example/', { lookupAddresses: resolves(['93.184.216.34', '10.0.0.9']) }),
    ).toBe('private-address');
    expect(await reason('https://a.example/', { lookupAddresses: resolves(['::1']) })).toBe(
      'private-address',
    );
  });

  it('reports DNS failures as unresolvable', async () => {
    const failing = async () => {
      throw new Error('ENOTFOUND');
    };
    expect(await reason('https://missing.example/', { lookupAddresses: failing })).toBe(
      'unresolvable',
    );
    expect(await reason('https://missing.example/', { lookupAddresses: resolves([]) })).toBe(
      'unresolvable',
    );
  });

  it('accepts a private DNS answer only for allowHosts', async () => {
    const checked = await checkWebhookUrl('https://receiver.test/', {
      allowHosts: ['receiver.test'],
      lookupAddresses: resolves(['127.0.0.1']),
    });
    expect(checked.addresses).toEqual(['127.0.0.1']);
    expect(
      await reason('https://other.test/', {
        allowHosts: ['receiver.test'],
        lookupAddresses: resolves(['127.0.0.1']),
      }),
    ).toBe('private-address');
  });
});

describe('isPrivateAddress', () => {
  it.each(['8.8.8.8', '93.184.216.34', '1.1.1.1'])('allows public %s', (ip) => {
    expect(isPrivateAddress(ip)).toBe(false);
  });
  it.each([
    '127.0.0.1',
    '10.9.9.9',
    '172.16.0.1',
    '192.168.0.1',
    '169.254.1.1',
    '100.64.0.1',
    '0.1.2.3',
    '192.0.2.1',
    '198.51.100.1',
    '203.0.113.1',
    '198.18.0.1',
    '240.0.0.1',
    '::1',
    '::ffff:10.0.0.1',
    'fc00::1',
    'fe80::a1',
    'ff02::2',
    '2001:db8::1',
  ])('blocks %s', (ip) => {
    expect(isPrivateAddress(ip)).toBe(true);
  });
  it('allows public IPv6', () => {
    expect(isPrivateAddress('2606:4700:4700::1111')).toBe(false);
  });
  it('blocks non-IP garbage', () => {
    expect(isPrivateAddress('not-an-ip')).toBe(true);
  });
});

describe('displayUrl', () => {
  it('drops query and fragment', () => {
    expect(displayUrl('https://h.example/wh?token=SECRET#frag')).toBe('https://h.example/wh');
    expect(displayUrl('https://h.example:8443/wh')).toBe('https://h.example:8443/wh');
  });
  it('returns empty string for garbage', () => {
    expect(displayUrl('not a url')).toBe('');
  });
});
