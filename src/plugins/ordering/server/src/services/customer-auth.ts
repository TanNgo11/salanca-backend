import type { Core } from '@strapi/strapi';

import type { OrderingConfig } from '../config';
import { o11Hashing } from '../domain/customers/identity';
import {
  generateBearerToken,
  generateChallengeId,
  generateOtpCode,
  isOtpCodeShape,
  normalizeEmailTarget,
  otpCodeMatches,
  verdictFor,
} from '../domain/customers/otp';
import { OrderingError } from '../domain/errors';
import { sha256Hex } from '../domain/hashing';
import { decryptSecret, encryptSecret, parseEncryptionKey } from '../domain/token-cipher';
import type notificationTemplateFactory from './notification-template';
import { nowOf, type ServiceContext } from './context';
import type { OrderingRegistry } from './registry';

type CustomerRow = {
  id: number;
  documentId: string;
  phone: string | null;
  email: string | null;
  emailVerifiedAt: string | null;
  name: string | null;
  status: string;
  marketingConsent: unknown;
  createdAt: string;
};

type OtpRow = {
  id: number;
  challengeId: string;
  channel: string;
  targetSealed: string | null;
  codeHash: string;
  purpose: string;
  attempts: number;
  expiresAt: string | Date;
  consumedAt: string | Date | null;
  customer?: { id: number } | number | null;
};

type SessionRow = {
  id: number;
  lastSeenAt: string | Date;
  expiresAt: string | Date;
  revokedAt: string | Date | null;
  customer?: CustomerRow | null;
};

/** Public allowlisted customer shape (self view — the customer sees their own data). */
export type CustomerView = {
  id: string;
  name: string | null;
  email: string | null;
  phone: string | null;
  status: string;
  marketingConsent: unknown;
  createdAt: string;
};

/** How long a session write may lag before `resolveSession` slides `lastSeenAt`/`expiresAt`. */
const SLIDE_AFTER_MS = 60_000;

/**
 * O11 step 2 — OTP sign-in (email only; sms/zalo land in O13) and bearer sessions.
 * Never reveals whether an email maps to a profile: requests always answer `{challengeId}`
 * and an over-limit target gets a phantom challenge that simply never verifies. Hashes, not
 * secrets, reach the tables (code → HMAC, token → sha256, target → HMAC + sealed copy for
 * binding).
 */
const customerAuth = ({ strapi }: { strapi: Core.Strapi }) => {
  const plugin = () => strapi.plugin('ordering');
  const config = () => strapi.config.get('plugin::ordering') as OrderingConfig;
  const hashing = () => o11Hashing(config().encryptionKey);
  const otps = () => strapi.db.query('plugin::ordering.customer-otp');
  const sessions = () => strapi.db.query('plugin::ordering.customer-session');
  const customers = () => strapi.db.query('plugin::ordering.customer');
  const deliveries = () => strapi.db.query('plugin::ordering.notification-delivery');
  const templates = () =>
    plugin().service('notification-template') as ReturnType<typeof notificationTemplateFactory>;
  const registry = () => plugin().service('registry') as OrderingRegistry;

  const viewOf = (row: CustomerRow): CustomerView => ({
    id: row.documentId,
    name: row.name,
    email: row.email,
    phone: row.phone,
    status: row.status,
    marketingConsent: row.marketingConsent ?? null,
    createdAt: row.createdAt,
  });

  /** Sealed when a real key exists; `raw:` only in dev without ORDERING_ENCRYPTION_KEY. */
  const sealTarget = (plaintext: string): string => {
    const key = parseEncryptionKey(config().encryptionKey ?? '');
    return key.valid ? encryptSecret(plaintext, key.key) : `raw:${plaintext}`;
  };

  const openTarget = (sealed: string | null | undefined): string | null => {
    if (!sealed) return null;
    if (sealed.startsWith('raw:')) return sealed.slice(4);
    const key = parseEncryptionKey(config().encryptionKey ?? '');
    if (!key.valid) return null;
    try {
      return decryptSecret(sealed, key.key);
    } catch {
      return null;
    }
  };

  const findByEmail = async (email: string): Promise<CustomerRow | null> =>
    (await customers().findOne({
      where: { email, status: { $ne: 'erased' } },
    })) as CustomerRow | null;

  /** Sends the code through the editable `customer.otp` template; mail failures never surface. */
  const sendOtpMail = async (input: {
    challengeId: string;
    email: string;
    code: string;
    minutes: number;
  }) => {
    const recipientHash = sha256Hex(input.email);
    const data = {
      eventId: `otp:${input.challengeId}`,
      template: 'customer.otp',
      recipientHash,
      channel: 'email',
      recipientRole: 'customer',
      orderId: null,
      messageLocale: 'vi',
      status: 'pending',
      attempts: 0,
    };
    const row = (await deliveries().create({ data })) as { id: number };
    const mark = (status: string, extra: Record<string, unknown> = {}) =>
      deliveries().update({ where: { id: row.id }, data: { status, ...extra } });
    if (!config().notifications.email.enabled) {
      await mark('skipped');
      return;
    }
    try {
      const rendered = await templates().renderFor('customer.otp', 'vi', {
        otp: input.code,
        minutes: input.minutes,
      });
      await registry()
        .notificationProvider('email')
        .send({ recipient: { email: input.email }, template: 'customer.otp', data: rendered });
      await mark('sent', { sentAt: new Date(), attempts: 1 });
    } catch (error) {
      // The challenge stays usable on retry; delivery rows carry status only, never the target.
      await mark('failed', {
        attempts: 1,
        lastError: String((error as Error)?.message ?? error).slice(0, 500),
      });
      strapi.log.warn('[ordering] customer.otp mail failed (challenge stays valid)');
    }
  };

  const service = {
    /**
     * POST /auth/otp. Always `{challengeId}` — over-limit targets get a phantom id and no mail
     * (the per-IP cap lives in the `auth` rate-limit bucket; the per-target cap is counted on
     * `customer-otp` rows so it survives restarts and multi-instance deployment).
     */
    async requestOtp(
      input: { channel?: unknown; target?: unknown },
      ctx: ServiceContext,
    ): Promise<{ challengeId: string }> {
      const customers = config().customers;
      const channel = typeof input.channel === 'string' ? input.channel : '';
      if (!customers.enabled || channel !== 'email' || !customers.otpChannels.includes(channel)) {
        throw new OrderingError('VALIDATION_ERROR', 'unsupported OTP channel', {
          details: { channel: channel || null },
        });
      }
      const email = normalizeEmailTarget(input.target);
      if (!email) {
        throw new OrderingError('VALIDATION_ERROR', 'target must be an email address', {
          details: { channel },
        });
      }
      const now = nowOf(ctx);
      const targetHash = hashing().otpTargetHash(email);
      const windowStart = new Date(now.getTime() - customers.otp.sendWindowMinutes * 60_000);
      const recent = (await otps().count({
        where: { targetHash, createdAt: { $gt: windowStart } },
      })) as number;
      if (recent >= customers.otp.sendMax) {
        // Phantom challenge: identical response shape, no mail, verifies nowhere.
        return { challengeId: generateChallengeId() };
      }

      const challengeId = generateChallengeId();
      const code = generateOtpCode();
      const existing = await findByEmail(email);
      await otps().create({
        data: {
          challengeId,
          channel,
          targetHash,
          targetSealed: sealTarget(email),
          codeHash: hashing().otpCodeHash(code, challengeId),
          purpose: 'login',
          ...(existing ? { customer: existing.id } : {}),
          attempts: 0,
          expiresAt: new Date(now.getTime() + customers.otp.codeMinutes * 60_000),
        },
      });
      await sendOtpMail({ challengeId, email, code, minutes: customers.otp.codeMinutes });
      return { challengeId };
    },

    /**
     * POST /auth/verify. Errors never say which part failed beyond the contract's codes:
     * OTP_INVALID carries `details.attemptsLeft`, OTP_EXPIRED a dead challenge.
     */
    async verifyOtp(
      input: { challengeId?: unknown; code?: unknown; userAgent?: string },
      ctx: ServiceContext,
    ): Promise<{ token: string; customer: CustomerView }> {
      const challengeId = typeof input.challengeId === 'string' ? input.challengeId : '';
      const row = (await otps().findOne({
        where: { challengeId },
        populate: { customer: true },
      })) as OtpRow | null;
      const invalid = (attemptsLeft?: number) =>
        new OrderingError('OTP_INVALID', 'the code is not valid', {
          details: attemptsLeft === undefined ? {} : { attemptsLeft },
        });
      if (!row) throw invalid();
      const now = nowOf(ctx);
      const codeOk =
        isOtpCodeShape(input.code) &&
        otpCodeMatches(hashing(), input.code, challengeId, row.codeHash);
      const verdict = verdictFor(
        {
          attempts: row.attempts,
          expiresAt: new Date(row.expiresAt),
          consumedAt: row.consumedAt ? new Date(row.consumedAt) : null,
        },
        codeOk,
        { now, maxAttempts: config().customers.otp.maxAttempts },
      );
      if (!verdict.ok) {
        if (verdict.reason === 'expired') {
          throw new OrderingError('OTP_EXPIRED', 'the code has expired');
        }
        if (verdict.reason === 'mismatch') {
          await otps().update({ where: { id: row.id }, data: { attempts: row.attempts + 1 } });
          throw invalid(verdict.attemptsLeft);
        }
        throw invalid();
      }
      await otps().update({ where: { id: row.id }, data: { consumedAt: now } });

      // Resolve the profile: a challenge bound at request time wins; else bind/create by the
      // sealed email. `erased` profiles can never sign back in.
      const linked = row.customer;
      let customer: CustomerRow | null =
        linked && typeof linked === 'object'
          ? ((await customers().findOne({ where: { id: linked.id } })) as CustomerRow | null)
          : linked
            ? ((await customers().findOne({ where: { id: linked } })) as CustomerRow | null)
            : null;
      if (!customer) {
        const email = openTarget(row.targetSealed);
        if (email && row.channel === 'email') {
          customer = await findByEmail(email);
          if (!customer) {
            customer = (await customers().create({
              data: { email, emailVerifiedAt: now, status: 'active' },
            })) as CustomerRow;
            await otps().update({ where: { id: row.id }, data: { customer: customer.id } });
          }
        }
      }
      if (!customer || customer.status === 'erased') throw invalid();
      if (row.channel === 'email' && !customer.emailVerifiedAt) {
        await customers().update({ where: { id: customer.id }, data: { emailVerifiedAt: now } });
        customer = { ...customer, emailVerifiedAt: now.toISOString() };
      }
      if (customer.status === 'unverified') {
        await customers().update({ where: { id: customer.id }, data: { status: 'active' } });
        customer = { ...customer, status: 'active' };
      }

      const token = await service.issueSession(customer, ctx, input.userAgent);
      return { token, customer: viewOf(customer) };
    },

    /** Creates a session row for `customer`, revoking the oldest past `maxSessions`. */
    async issueSession(
      customer: CustomerRow,
      ctx: ServiceContext,
      userAgent?: string,
    ): Promise<string> {
      const now = nowOf(ctx);
      const sessionDays = config().customers.sessionDays;
      const maxSessions = config().customers.maxSessions;
      const live = (await sessions().findMany({
        where: { customer: customer.id, revokedAt: null, expiresAt: { $gt: now } },
        orderBy: { lastSeenAt: 'asc' },
      })) as SessionRow[];
      for (const stale of live.slice(0, Math.max(0, live.length - maxSessions + 1))) {
        await sessions().update({ where: { id: stale.id }, data: { revokedAt: now } });
      }
      const token = generateBearerToken();
      await sessions().create({
        data: {
          customer: customer.id,
          tokenHash: hashing().sessionTokenHash(token),
          lastSeenAt: now,
          expiresAt: new Date(now.getTime() + sessionDays * 86_400_000),
          userAgent: userAgent ? userAgent.slice(0, 255) : null,
        },
      });
      return token;
    },

    /**
     * `X-Customer-Token` → {customer, session} or null. Slides the 30-day expiry on use
     * (throttled to one write per minute per session) and refuses revoked/erased rows.
     */
    async resolveSession(
      token: string | undefined,
      ctx: ServiceContext,
    ): Promise<{ customer: CustomerRow; session: SessionRow } | null> {
      if (!token || token.length > 128) return null;
      const session = (await sessions().findOne({
        where: { tokenHash: hashing().sessionTokenHash(token) },
        populate: { customer: true },
      })) as SessionRow | null;
      if (!session || session.revokedAt) return null;
      const now = nowOf(ctx);
      const customer = session.customer ?? null;
      if (new Date(session.expiresAt).getTime() <= now.getTime() || !customer) return null;
      if (customer.status === 'erased') return null;
      if (now.getTime() - new Date(session.lastSeenAt).getTime() > SLIDE_AFTER_MS) {
        const expiresAt = new Date(now.getTime() + config().customers.sessionDays * 86_400_000);
        await sessions().update({
          where: { id: session.id },
          data: { lastSeenAt: now, expiresAt },
        });
        session.lastSeenAt = now;
        session.expiresAt = expiresAt;
      }
      return { customer, session };
    },

    /** POST /auth/logout — revokes the presented session; absent/foreign tokens are a no-op. */
    async logoutByToken(token: string | undefined, ctx: ServiceContext): Promise<void> {
      const resolved = await service.resolveSession(token, ctx);
      if (!resolved) return;
      await sessions().update({
        where: { id: resolved.session.id },
        data: { revokedAt: nowOf(ctx) },
      });
    },

    /** Logs the customer out everywhere (erasure, staff block). */
    async revokeAllSessions(customerId: number, ctx: ServiceContext): Promise<void> {
      const now = nowOf(ctx);
      const live = (await sessions().findMany({
        where: { customer: customerId, revokedAt: null },
        select: ['id'],
      })) as { id: number }[];
      for (const session of live) {
        await sessions().update({ where: { id: session.id }, data: { revokedAt: now } });
      }
    },
  };
  return service;
};

export default customerAuth;
