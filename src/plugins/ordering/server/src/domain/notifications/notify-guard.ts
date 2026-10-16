import { normalizeVietnamesePhone } from '../../../../shared/contact/phone';

/** Delivery mode for outbound notifications: `live` sends everywhere, `allowlist` only to the list. */
export type NotifyMode = 'live' | 'allowlist';

type AllowlistMatcher = {
  emails: Set<string>;
  domains: Set<string>;
  phones: Set<string>;
};

export type ParsedAllowlist =
  | { ok: true; matcher: AllowlistMatcher }
  | { ok: false; invalid: number[] };

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const DOMAIN = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/;

/**
 * Parses `ORDERING_NOTIFY_ALLOWLIST` entries. Each entry is a full email address (case-insensitive),
 * an `@domain.tld` (any address in that domain), or a Vietnamese phone number normalized to E.164.
 * A blank or unrecognizable entry is reported by position so the caller can fail startup without
 * echoing the value.
 */
export function parseAllowlist(entries: string[]): ParsedAllowlist {
  const matcher: AllowlistMatcher = { emails: new Set(), domains: new Set(), phones: new Set() };
  const invalid: number[] = [];

  entries.forEach((raw, index) => {
    const entry = raw.trim();
    if (entry === '') {
      invalid.push(index);
      return;
    }
    if (entry.startsWith('@')) {
      const domain = entry.slice(1).toLowerCase();
      if (!DOMAIN.test(domain)) invalid.push(index);
      else matcher.domains.add(domain);
      return;
    }
    if (entry.includes('@')) {
      const email = entry.toLowerCase();
      if (!EMAIL.test(email)) invalid.push(index);
      else matcher.emails.add(email);
      return;
    }
    const phone = normalizeVietnamesePhone(entry);
    if (!phone.valid) invalid.push(index);
    else matcher.phones.add(phone.e164);
  });

  return invalid.length > 0 ? { ok: false, invalid } : { ok: true, matcher };
}

/**
 * Builds the allowlist guard. `live` allows everything; `allowlist` allows only entries matching the
 * channel's address kind (email checks the address/domain lists, sms/zalo the phone list, anything
 * else is denied). An unparseable list fails closed — it blocks every recipient.
 */
export function createGuard(input: { mode: NotifyMode; allowlist: string[] }): {
  allows(channel: string, value: string): boolean;
} {
  if (input.mode === 'live') return { allows: () => true };

  const parsed = parseAllowlist(input.allowlist);
  const matcher: AllowlistMatcher = parsed.ok
    ? parsed.matcher
    : { emails: new Set(), domains: new Set(), phones: new Set() };

  return {
    allows(channel, value) {
      if (typeof value !== 'string' || value === '') return false;
      if (channel === 'email') {
        const email = value.toLowerCase();
        if (matcher.emails.has(email)) return true;
        const at = email.lastIndexOf('@');
        return at === -1 ? false : matcher.domains.has(email.slice(at + 1));
      }
      if (channel === 'sms' || channel === 'zalo') {
        const phone = normalizeVietnamesePhone(value);
        return phone.valid && matcher.phones.has(phone.e164);
      }
      return false;
    },
  };
}
