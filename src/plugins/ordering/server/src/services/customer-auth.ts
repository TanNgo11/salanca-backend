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
import { SKIP_REASON } from '../domain/notifications/skip-reasons';
import { decryptSecret, encryptSecret, parseEncryptionKey } from '../domain/token-cipher';
import { normalizeVietnamesePhone } from '../../../shared/contact/phone';
import type notificationChannelFactory from './notification-channel';
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
  targetHash: string;
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
 * O11 step 2 — OTP sign-in and bearer sessions; O13 step 6 adds the `sms`/`zalo` channels.
 * Never reveals whether a target maps to a profile: requests always answer `{challengeId}`
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
  const channelRules = () =>
    plugin().service('notification-channel') as ReturnType<typeof notificationChannelFactory>;
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

  const findByPhone = async (e164: string): Promise<CustomerRow | null> =>
    (await customers().findOne({
      where: { phoneHash: hashing().phoneHash(e164), status: { $ne: 'erased' } },
    })) as CustomerRow | null;

  /** OTP delivery channel — `email` renders the editable template; `sms`/`zalo` are O13. */
  type OtpChannel = 'email' | 'sms' | 'zalo';

  /**
   * Sends the code on `channel`; failures mark the delivery row but never surface (the
   * challenge stays usable on retry). `zalo` needs a channel-rule ZNS mapping for
   * `customer.otp` — without one the row is `skipped`, matching an unconfigured provider.
   */
  const sendOtp = async (input: {
    challengeId: string;
    channel: OtpChannel;
    target: string;
    code: string;
    minutes: number;
  }) => {
    const recipientHash = sha256Hex(`${input.channel}:${input.target}`);
    const row = (await deliveries().create({
      data: {
        eventId: `otp:${input.challengeId}`,
        template: 'customer.otp',
        recipientHash,
        channel: input.channel,
        recipientRole: 'customer',
        orderId: null,
        messageLocale: 'vi',
        status: 'pending',
        attempts: 0,
      },
    })) as { id: number };
    const mark = (status: string, extra: Record<string, unknown> = {}) =>
      deliveries().update({ where: { id: row.id }, data: { status, ...extra } });
    const unavailable =
      input.channel === 'email'
        ? !config().notifications.email.enabled
        : !registry().hasNotificationProvider(input.channel);
    const rule = input.channel === 'zalo' ? await channelRules().ruleFor('customer.otp') : null;
    if (unavailable || (input.channel === 'zalo' && !rule?.zns?.templateId)) {
      await mark('skipped', { lastError: unavailable ? 'provider-not-configured' : 'zns-template-missing' });
      return;
    }
    // R1a: an allowlist block is recorded and skipped; the response never reveals the target's
    // allowlisted state (requestOtp still answers `{challengeId}`).
    if (!registry().isNotificationAllowed(input.channel, input.target)) {
      await mark('skipped', { lastError: SKIP_REASON.notAllowlisted });
      return;
    }
    // OTP over SMS/Zalo spends the same paid-message budget as notifications.
    if (input.channel !== 'email' && !(await channelRules().reservePaidSend())) {
      await mark('skipped', { lastError: 'daily-limit' });
      return;
    }
    try {
      const rendered = await templates().renderFor('customer.otp', 'vi', {
        otp: input.code,
        minutes: input.minutes,
      });
      const data: Record<string, unknown> = {
        otp: input.code,
        minutes: input.minutes,
        ...rendered,
        trackingId: `nd-${row.id}`,
      };
      if (input.channel === 'sms') data.smsText = rendered.text;
      if (input.channel === 'zalo' && rule?.zns) {
        data.znsTemplateId = rule.zns.templateId;
        data.znsParams = Object.fromEntries(
          Object.entries(rule.zns.params).map(([key, varName]) => [
            key,
            ({ otp: input.code, minutes: input.minutes } as Record<string, unknown>)[varName] ?? '',
          ]),
        );
      }
      const result = await registry()
        .notificationProvider(input.channel)
        .send({
          recipient:
            input.channel === 'email' ? { email: input.target } : { phone: input.target },
          template: 'customer.otp',
          data,
        });
      const providerMessageId =
        result && typeof result === 'object'
          ? ((result as { providerMessageId?: string }).providerMessageId ?? null)
          : null;
      await mark('sent', {
        sentAt: new Date(),
        attempts: 1,
        providerMessageId,
        costEstimate:
          input.channel === 'email' ? null : (config().notifications.costEstimates[input.channel] ?? null),
      });
    } catch (error) {
      // The challenge stays usable on retry; delivery rows carry status only, never the target.
      await mark('failed', {
        attempts: 1,
        lastError: String((error as Error)?.message ?? error).slice(0, 500),
      });
      strapi.log.warn(`[ordering] customer.otp ${input.channel} send failed (challenge stays valid)`);
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
      const allowed: OtpChannel[] = ['email', 'sms', 'zalo'];
      if (
        !customers.enabled ||
        !allowed.includes(channel as OtpChannel) ||
        !customers.otpChannels.includes(channel)
      ) {
        throw new OrderingError('VALIDATION_ERROR', 'unsupported OTP channel', {
          details: { channel: channel || null },
        });
      }
      // O13: `sms`/`zalo` reach the customer by phone (E.164); `email` by email.
      const isEmail = channel === 'email';
      const phone = isEmail ? null : normalizeVietnamesePhone(input.target);
      const email = isEmail ? normalizeEmailTarget(input.target) : null;
      const target = email ?? (phone && phone.valid ? phone.e164 : null);
      if (!target) {
        throw new OrderingError(
          'VALIDATION_ERROR',
          isEmail ? 'target must be an email address' : 'target must be a Vietnamese phone number',
          { details: { channel } },
        );
      }
      const now = nowOf(ctx);
      const targetHash = hashing().otpTargetHash(target);
      const windowStart = new Date(now.getTime() - customers.otp.sendWindowMinutes * 60_000);
      let delivery: Promise<void> | undefined;
      const reply = await strapi.db.transaction(async ({ trx, onCommit }) => {
        await trx.raw('SELECT pg_advisory_xact_lock(hashtext(?))', [`ordering-otp:${targetHash}`]);
        const recent = (await otps().count({
          where: { targetHash, createdAt: { $gt: windowStart } },
        })) as number;
        if (recent >= customers.otp.sendMax) {
          // Phantom challenge: identical response shape, no mail, verifies nowhere.
          return { challengeId: generateChallengeId() };
        }

        const challengeId = generateChallengeId();
        const code = generateOtpCode();
        // O13: `sms`/`zalo` targets are E.164 phones; `email` is an address.
        const existing = email ? await findByEmail(email) : await findByPhone(target);
        await otps().create({
          data: {
            challengeId,
            channel,
            targetHash,
            targetSealed: sealTarget(target),
            codeHash: hashing().otpCodeHash(code, challengeId),
            purpose: 'login',
            ...(existing ? { customer: existing.id } : {}),
            attempts: 0,
            expiresAt: new Date(now.getTime() + customers.otp.codeMinutes * 60_000),
          },
        });
        onCommit(() => {
          delivery = sendOtp({
            challengeId,
            channel: channel as OtpChannel,
            target,
            code,
            minutes: customers.otp.codeMinutes,
          }).catch(() => { strapi.log.warn('[ordering] customer.otp delivery failed after commit'); });
        });
        return { challengeId };
      });
      // Root calls wait for delivery. A nested caller returns before its outer commit;
      // the registered callback sends only after that commit, never after rollback.
      if (delivery) await delivery;
      return reply;
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
      // Lock before reading the challenge. Returning validation failures commits the attempt
      // counter; throwing inside the transaction would roll it back.
      const outcome = await strapi.db.transaction(async ({ trx }) => {
        // Different challenges for one mailbox must resolve/create a single profile.
        // Take the target lock before the challenge lock, matching OTP issuance.
        const identity = (await otps().findOne({
          where: { challengeId },
          select: ['targetHash'],
        })) as Pick<OtpRow, 'targetHash'> | null;
        if (identity) {
          await trx.raw('SELECT pg_advisory_xact_lock(hashtext(?))', [
            `ordering-otp:${identity.targetHash}`,
          ]);
        }
        await trx('plugins_ordering_customer_otp')
          .where({ challenge_id: challengeId })
          .forUpdate()
          .first('id');
        const row = (await otps().findOne({
          where: { challengeId },
          populate: { customer: true },
        })) as OtpRow | null;
        const invalid = (attemptsLeft?: number) =>
          new OrderingError('OTP_INVALID', 'the code is not valid', {
            details: attemptsLeft === undefined ? {} : { attemptsLeft },
          });
        if (!row) return { error: invalid() };
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
            return { error: new OrderingError('OTP_EXPIRED', 'the code has expired') };
          }
          if (verdict.reason === 'mismatch') {
            await otps().update({ where: { id: row.id }, data: { attempts: row.attempts + 1 } });
            return { error: invalid(verdict.attemptsLeft) };
          }
          return { error: invalid() };
        }
        await otps().update({ where: { id: row.id }, data: { consumedAt: now } });

        // Resolve the profile: a challenge bound at request time wins; else bind/create by the
        // sealed target — email challenges by address, O13 sms/zalo challenges by E.164 phone.
        // `erased` profiles can never sign back in.
        const linked = row.customer;
        let customer: CustomerRow | null =
          linked && typeof linked === 'object'
            ? ((await customers().findOne({ where: { id: linked.id } })) as CustomerRow | null)
            : linked
              ? ((await customers().findOne({ where: { id: linked } })) as CustomerRow | null)
              : null;
        if (!customer) {
          const target = openTarget(row.targetSealed);
          if (target && row.channel === 'email') {
            customer = await findByEmail(target);
            if (!customer) {
              customer = (await customers().create({
                data: { email: target, emailVerifiedAt: now, status: 'active' },
              })) as CustomerRow;
              await otps().update({ where: { id: row.id }, data: { customer: customer.id } });
            }
          }
          if (target && (row.channel === 'sms' || row.channel === 'zalo')) {
            customer = await findByPhone(target);
            if (!customer) {
              customer = (await customers().create({
                data: {
                  phone: target,
                  phoneHash: hashing().phoneHash(target),
                  status: 'active',
                },
              })) as CustomerRow;
              await otps().update({ where: { id: row.id }, data: { customer: customer.id } });
            }
          }
        }
        if (!customer || customer.status === 'erased') return { error: invalid() };
        if (row.channel === 'email' && !customer.emailVerifiedAt) {
          await customers().update({ where: { id: customer.id }, data: { emailVerifiedAt: now } });
          customer = { ...customer, emailVerifiedAt: now.toISOString() };
        }
        if (customer.status === 'unverified') {
          await customers().update({ where: { id: customer.id }, data: { status: 'active' } });
          customer = { ...customer, status: 'active' };
        }

        const token = await service.issueSession(customer, ctx, input.userAgent);
        return { value: { token, customer: viewOf(customer) } };
      });
      if (outcome.error) throw outcome.error;
      return outcome.value;
    },

    /** Creates a session row for `customer`, revoking the oldest past `maxSessions`. */
    async issueSession(
      customer: CustomerRow,
      ctx: ServiceContext,
      userAgent?: string,
    ): Promise<string> {
      return strapi.db.transaction(async ({ trx }) => {
        // Advisory lock also covers callers that already own an outer transaction.
        await trx.raw('SELECT pg_advisory_xact_lock(hashtext(?))', [
          `ordering-customer-session:${customer.id}`,
        ]);
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
      });
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
