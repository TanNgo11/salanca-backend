import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

import { OrderingError } from '../errors';

/**
 * SSRF guard for outbound webhooks (O10). A URL is checked here at registration AND re-checked
 * by the dispatcher immediately before every request: DNS is resolved now, every returned
 * address is verified public, and the caller pins the verified addresses through a custom
 * `lookup` so a rebinding change between check and connect cannot redirect the request.
 *
 * Blocked: non-http(s) schemes, credentials in the URL, loopback/private/link-local/CGNAT/
 * multicast/reserved IPv4, IPv6 loopback/ULA/link-local/multicast/discard/documentation and
 * IPv4-embedded forms (mapped, compatible, NAT64, 6to4, Teredo), and internal-looking names.
 * `allowHosts` exempts the address checks (dev receivers); the scheme rule always applies.
 */
export type CheckedWebhookUrl = {
  url: URL;
  hostname: string;
  /** Every resolved address, each verified public (or allowHosts-exempt). */
  addresses: string[];
};

export type UrlCheckOptions = {
  allowHttp?: boolean;
  allowHosts?: readonly string[];
  /** Injectable DNS resolver (tests); production uses dns.promises.lookup({ all: true }). */
  lookupAddresses?: (hostname: string) => Promise<string[]>;
};

export type UrlRejectReason = 'scheme' | 'invalid' | 'private-address' | 'unresolvable';

const reject = (reason: UrlRejectReason, message: string): never => {
  throw new OrderingError('WEBHOOK_URL_INVALID', message, { details: { reason } });
};

/** Dotted-quad → u32, or null. `net.isIP` accepts it; this is for embedded forms. */
const ipv4ToInt = (ip: string): number | null => {
  const parts = ip.split('.');
  if (parts.length !== 4) return null;
  let out = 0;
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null;
    const n = Number(part);
    if (n > 255) return null;
    out = out * 256 + n;
  }
  return out >>> 0;
};

const V4_BLOCKED: ReadonlyArray<readonly [base: string, bits: number]> = [
  ['0.0.0.0', 8], // "this host"
  ['10.0.0.0', 8],
  ['100.64.0.0', 10], // CGNAT
  ['127.0.0.0', 8], // loopback
  ['169.254.0.0', 16], // link-local
  ['172.16.0.0', 12],
  ['192.0.0.0', 24], // IETF protocol assignments
  ['192.0.2.0', 24], // TEST-NET-1
  ['192.168.0.0', 16],
  ['198.18.0.0', 15], // benchmarking
  ['198.51.100.0', 24], // TEST-NET-2
  ['203.0.113.0', 24], // TEST-NET-3
  ['224.0.0.0', 4], // multicast
  ['240.0.0.0', 4], // reserved + broadcast
];

const isPrivateV4 = (n: number): boolean =>
  V4_BLOCKED.some(([base, bits]) => {
    const mask = (~0 << (32 - bits)) >>> 0;
    return (n & mask) === ((ipv4ToInt(base) ?? 0) & mask);
  });

/** IPv6 → 16 bytes (handles `::`, a trailing embedded IPv4, zone ids) or null. */
const ipv6ToBytes = (input: string): Uint8Array | null => {
  let addr = input.toLowerCase();
  const zone = addr.indexOf('%');
  if (zone >= 0) addr = addr.slice(0, zone);
  if (addr === '') return null;
  let v4: number | null = null;
  const lastColon = addr.lastIndexOf(':');
  const tail = addr.slice(lastColon + 1);
  if (tail.includes('.')) {
    v4 = ipv4ToInt(tail);
    if (v4 === null) return null;
    addr = addr.slice(0, lastColon + 1);
  }
  const halves = addr.split('::');
  if (halves.length > 2) return null;
  const parseSide = (side: string): number[] | null => {
    const out: number[] = [];
    for (const h of side.split(':')) {
      if (h === '') continue; // the colon kept before a stripped IPv4 tail
      if (!/^[0-9a-f]{1,4}$/.test(h)) return null;
      out.push(parseInt(h, 16));
    }
    return out;
  };
  const left = parseSide(halves[0]);
  const right = halves.length === 2 ? parseSide(halves[1]) : [];
  if (left === null || right === null) return null;
  const v4Parts = v4 === null ? 0 : 2;
  if (halves.length === 1 && left.length + v4Parts !== 8) return null;
  if (halves.length === 2 && left.length + right.length + v4Parts > 8) return null;
  const zeros = 8 - left.length - right.length - v4Parts;
  const hextets = [...left, ...new Array(zeros).fill(0), ...right];
  if (v4 !== null) hextets.push((v4 >>> 16) & 0xffff, v4 & 0xffff);
  const bytes = new Uint8Array(16);
  hextets.forEach((h, i) => {
    bytes[i * 2] = h >>> 8;
    bytes[i * 2 + 1] = h & 0xff;
  });
  return bytes;
};

const zeroThrough = (b: Uint8Array, n: number): boolean => {
  for (let i = 0; i < n; i += 1) if (b[i] !== 0) return false;
  return true;
};

const v4TailOf = (b: Uint8Array, offset = 12): number =>
  ((b[offset] << 24) | (b[offset + 1] << 16) | (b[offset + 2] << 8) | b[offset + 3]) >>> 0;

const isPrivateV6 = (b: Uint8Array): boolean => {
  if (zeroThrough(b, 16)) return true; // :: unspecified
  if (zeroThrough(b, 15) && b[15] === 1) return true; // ::1 loopback
  if (zeroThrough(b, 10) && b[10] === 0xff && b[11] === 0xff) return isPrivateV4(v4TailOf(b)); // ::ffff:a.b.c.d
  if (zeroThrough(b, 11)) return isPrivateV4(v4TailOf(b)); // ::a.b.c.d IPv4-compatible
  if (b[0] === 0 && b[1] === 0x64 && b[2] === 0xff && b[3] === 0x9b && zeroThrough(b.subarray(4), 8)) {
    return isPrivateV4(v4TailOf(b)); // 64:ff9b::/96 NAT64 embeds IPv4
  }
  if (b[0] === 0x20 && b[1] === 0x02) return isPrivateV4(v4TailOf(b, 2)); // 2002::/16 6to4
  if (b[0] === 0x20 && b[1] === 0x01 && b[2] === 0 && b[3] === 0) {
    return isPrivateV4(~v4TailOf(b) >>> 0); // 2001::/32 Teredo embeds the v4 inverted
  }
  if (b[0] === 0x01 && zeroThrough(b.subarray(1), 7)) return true; // 100::/64 discard
  if (b[0] === 0x20 && b[1] === 0x01 && b[2] === 0x0d && b[3] === 0xb8) return true; // 2001:db8::/32 doc
  if ((b[0] & 0xfe) === 0xfc) return true; // fc00::/7 ULA
  if (b[0] === 0xfe && (b[1] & 0xc0) === 0x80) return true; // fe80::/10 link-local
  if (b[0] === 0xfe && (b[1] & 0xc0) === 0xc0) return true; // fec0::/10 site-local
  if (b[0] === 0xff) return true; // ff00::/8 multicast
  return false;
};

/** True when the address must never receive an outbound webhook. */
export const isPrivateAddress = (address: string): boolean => {
  const family = isIP(address);
  if (family === 4) return isPrivateV4(ipv4ToInt(address) ?? 0);
  if (family === 6) {
    const bytes = ipv6ToBytes(address);
    return bytes === null || isPrivateV6(bytes);
  }
  return true; // not an IP at all — never an acceptable endpoint address
};

/** Hostname suffixes that name internal networks — refused before DNS is even asked. */
const INTERNAL_SUFFIXES = [
  'localhost',
  '.localhost',
  '.local',
  '.internal',
  '.lan',
  '.home',
  '.corp',
  '.invalid',
];

const isInternalName = (hostname: string): boolean =>
  hostname === 'localhost' || INTERNAL_SUFFIXES.some((suffix) => hostname.endsWith(suffix));

const invalid = (message: string): never => reject('invalid', message);

/**
 * Validates a subscriber URL and resolves it. Returns the normalized URL plus the verified
 * address list for the dispatcher to pin. Throws WEBHOOK_URL_INVALID with details.reason.
 */
export async function checkWebhookUrl(
  raw: unknown,
  options: UrlCheckOptions = {},
): Promise<CheckedWebhookUrl> {
  if (typeof raw !== 'string' || raw.trim() === '') {
    return invalid('url is required');
  }
  const text = raw.trim();
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    return invalid('url is not a valid absolute URL');
  }
  if (url.username !== '' || url.password !== '') {
    reject('scheme', 'url must not carry credentials');
  }
  if (url.protocol === 'http:' && options.allowHttp !== true) {
    reject('scheme', 'only https endpoints are accepted');
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    reject('scheme', 'only https endpoints are accepted');
  }
  const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  const exempt = (options.allowHosts ?? []).some((allowed) => allowed.toLowerCase() === hostname);

  const lookupAddresses =
    options.lookupAddresses ??
    (async (name: string) => {
      const results = await lookup(name, { all: true });
      return results.map((row) => row.address);
    });

  let addresses: string[];
  const literalFamily = isIP(hostname);
  if (literalFamily !== 0) {
    addresses = [hostname];
  } else {
    if (!exempt && isInternalName(hostname)) {
      return reject('private-address', 'internal hostnames are not allowed');
    }
    try {
      addresses = await lookupAddresses(hostname);
    } catch {
      return reject('unresolvable', 'hostname could not be resolved');
    }
    if (addresses.length === 0) {
      return reject('unresolvable', 'hostname could not be resolved');
    }
  }
  if (!exempt) {
    for (const address of addresses) {
      if (isPrivateAddress(address)) {
        reject('private-address', 'endpoint must resolve to a public address');
      }
    }
  }
  return { url, hostname, addresses };
}

/** URL shown to staff and written to logs: origin + path — query and fragment are dropped. */
export const displayUrl = (raw: string): string => {
  try {
    const url = new URL(raw);
    return `${url.origin}${url.pathname}`;
  } catch {
    return '';
  }
};
