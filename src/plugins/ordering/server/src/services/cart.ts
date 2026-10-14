import { randomUUID } from 'node:crypto';

import type { Core } from '@strapi/strapi';

import type { OrderingConfig } from '../config';
import { snapshotDeliveryAddress } from '../domain/contact/address';
import { hashingForConfig } from '../domain/customers/identity';
import { generateBearerToken } from '../domain/customers/otp';
import { OrderingError } from '../domain/errors';
import { sha256Hex } from '../domain/hashing';
import type { SelectedOptionSnapshot } from '../domain/storefront/serialize';
import { normalizeVietnamesePhone } from '../../../shared/contact/phone';
import type { TransactionClient } from '../migrations/runner';
import orderRepository from '../repositories/order';
import type adminUnitsFactory from './admin-units';
import type branchFactory from './branch';
import type notificationTemplateFactory from './notification-template';
import type orderFactory from './order';
import type { CreateOrderResult } from './order';
import type { OrderingRegistry } from './registry';
import type { ServiceContext } from './context';
import { nowOf } from './context';
import { lockCustomer } from './customer-lock';

type CartLine = {
  id: string;
  sellableUid: string;
  variantUid?: string;
  selected: Array<{ groupUid: string; optionUid: string; quantity: number }>;
  quantity: number;
  note?: string;
};

type CartRow = {
  id: number;
  documentId: string;
  tokenHash: string | null;
  customer: { id: number } | null;
  locationRef: string | null;
  receiveMethod: Record<string, unknown> | null;
  pickup: Record<string, unknown> | null;
  contact: { name?: string; phone?: string; email?: string } | null;
  lines: CartLine[] | null;
  status: 'active' | 'converted' | 'expired';
  order: number | { id: number } | null;
  locale: string | null;
  promotionCode: string | null;
  lastActivityAt: string | Date;
  expiresAt: string | Date;
  reminderSentAt: string | Date | null;
};

export type CartIssue = { lineId?: string; code: string; message: string };

/** Customer-entered code, kept as typed (trimmed, upper-case, ≤ 32) so the quote can say why it fails. */
const promotionCodeOf = (value: unknown): string | null =>
  typeof value === 'string' && value.trim() !== '' ? value.trim().toUpperCase().slice(0, 32) : null;

type CartOwner = { customerId: number | null; cartToken: string | undefined };

const QUANTITY_CAP = 99;

/**
 * O11 step 4 — server-side carts. Guest carts are addressed by a bearer token (`X-Cart-Token`;
 * only its SHA-256 lands on the row); signed-in carts ride the session's customer relation. The
 * cart NEVER stores prices: `view` re-quotes the whole cart on every call and turns per-line
 * catalog failures into `issues` instead of 4xx, so a stale line degrades instead of hiding.
 * `checkout` maps the cart onto `createOrder` (which re-prices again inside its transaction) and
 * marks the row `converted`. Writes slide `expiresAt` to `lastActivityAt + carts.expiryDays`.
 */
const cart = ({ strapi }: { strapi: Core.Strapi }) => {
  const plugin = () => strapi.plugin('ordering');
  const config = () => strapi.config.get('plugin::ordering') as OrderingConfig;
  const carts = () => strapi.db.query('plugin::ordering.cart');
  const orders = () => plugin().service('order') as ReturnType<typeof orderFactory>;
  const units = () => plugin().service('admin-units') as ReturnType<typeof adminUnitsFactory>;
  const branches = () => plugin().service('branch') as ReturnType<typeof branchFactory>;
  const templates = () =>
    plugin().service('notification-template') as ReturnType<typeof notificationTemplateFactory>;
  const registry = () => plugin().service('registry') as OrderingRegistry;
  const repo = orderRepository({ strapi });

  const assertEnabled = () => {
    if (!config().carts.enabled) {
      throw new OrderingError('CART_NOT_FOUND', 'carts are not enabled');
    }
  };

  const invalid = (field: string, message: string, details?: Record<string, unknown>) =>
    new OrderingError('VALIDATION_ERROR', message, { details: { field, ...details } });

  const normalizeLine = (input: Record<string, unknown>): CartLine => {
    const sellableUid = input.sellableUid;
    if (typeof sellableUid !== 'string' || sellableUid.trim() === '') {
      throw invalid('sellableUid', 'sellableUid is required');
    }
    const quantity = input.quantity;
    if (
      typeof quantity !== 'number' ||
      !Number.isInteger(quantity) ||
      quantity < 1 ||
      quantity > QUANTITY_CAP
    ) {
      throw invalid('quantity', `quantity must be an integer 1–${QUANTITY_CAP}`);
    }
    const rawSelected = input.selected ?? [];
    if (!Array.isArray(rawSelected)) {
      throw invalid('selected', 'selected must be a list');
    }
    const selected = rawSelected.map((pick, index) => {
      const field = `selected.${index}`;
      if (typeof pick !== 'object' || pick === null) {
        throw invalid(field, 'option must be an object');
      }
      const { groupUid, optionUid } = pick as Record<string, unknown>;
      if (typeof groupUid !== 'string' || typeof optionUid !== 'string') {
        throw invalid(`${field}.optionUid`, 'groupUid and optionUid are required');
      }
      const pickQuantity = (pick as Record<string, unknown>).quantity;
      return {
        groupUid: groupUid.slice(0, 100),
        optionUid: optionUid.slice(0, 100),
        quantity:
          typeof pickQuantity === 'number' && Number.isInteger(pickQuantity) && pickQuantity >= 1
            ? Math.min(pickQuantity, 99)
            : 1,
      };
    });
    const variantUid =
      typeof input.variantUid === 'string' ? input.variantUid.slice(0, 100) : undefined;
    const note =
      typeof input.note === 'string' && input.note.trim() !== ''
        ? input.note.trim().slice(0, 200)
        : undefined;
    return {
      id: randomUUID(),
      sellableUid: sellableUid.trim().slice(0, 100),
      ...(variantUid ? { variantUid } : {}),
      selected,
      quantity,
      ...(note ? { note } : {}),
    };
  };

  const normalizeContact = (input: unknown): CartRow['contact'] => {
    if (typeof input !== 'object' || input === null) return null;
    const raw = input as Record<string, unknown>;
    const phone = typeof raw.phone === 'string' ? raw.phone.trim() : '';
    let e164: string | undefined;
    if (phone !== '') {
      const normalized = normalizeVietnamesePhone(phone);
      if (!normalized.valid) {
        throw invalid('contact.phone', 'contact.phone must be a Vietnamese phone number', {
          reason: normalized.reason,
        });
      }
      e164 = normalized.e164;
    }
    const email = typeof raw.email === 'string' ? raw.email.trim() : undefined;
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      throw invalid('contact.email', 'contact.email is not a valid address');
    }
    const name =
      typeof raw.name === 'string' && raw.name.trim() !== ''
        ? raw.name.trim().slice(0, 120)
        : undefined;
    if (!name && !e164 && !email) return null;
    return { ...(name ? { name } : {}), ...(e164 ? { phone: e164 } : {}), ...(email ? { email } : {}) };
  };

  const normalizeReceiveMethod = (
    input: unknown,
    locationRef: string | null,
  ): Record<string, unknown> => {
    if (typeof input !== 'object' || input === null) {
      throw invalid('receiveMethod', 'receiveMethod must be an object');
    }
    const kind = (input as Record<string, unknown>).kind;
    if (kind === 'pickup') {
      return { kind: 'pickup', locationRef: locationRef ?? '' };
    }
    if (kind === 'delivery') {
      const address = (input as Record<string, unknown>).address;
      const result = snapshotDeliveryAddress(
        (typeof address === 'object' && address !== null ? address : {}) as Parameters<
          typeof snapshotDeliveryAddress
        >[0],
        units().catalog(),
      );
      if (!result.ok) {
        throw new OrderingError('VALIDATION_ERROR', result.message, {
          details: { field: result.field, reason: result.reason },
        });
      }
      return { kind: 'delivery', providerCode: 'self-delivery', address: result.address };
    }
    throw invalid('receiveMethod.kind', 'receiveMethod.kind must be pickup or delivery');
  };

  const normalizePickup = (input: unknown): Record<string, unknown> | null => {
    if (typeof input !== 'object' || input === null) return null;
    const slot = (input as Record<string, unknown>).slot;
    const startsAt =
      typeof slot === 'object' && slot !== null
        ? (slot as Record<string, unknown>).startsAt
        : undefined;
    if (typeof startsAt === 'string' && !Number.isNaN(Date.parse(startsAt))) {
      return { slot: { startsAt: new Date(startsAt).toISOString() } };
    }
    return { asap: true };
  };

  /** Slide window: writes push lastActivity/expires forward by `carts.expiryDays`. */
  const touch = (ctx: ServiceContext) => {
    const now = nowOf(ctx);
    return {
      lastActivityAt: now,
      expiresAt: new Date(now.getTime() + config().carts.expiryDays * 86_400_000),
    };
  };

  const reload = async (rowId: number): Promise<CartRow> =>
    (await carts().findOne({
      where: { id: rowId },
      populate: { customer: true, order: true },
    })) as CartRow;

  const save = async (
    row: CartRow,
    data: Record<string, unknown>,
    ctx: ServiceContext,
  ): Promise<CartRow> => {
    await carts().update({ where: { id: row.id }, data: { ...data, ...touch(ctx) } });
    return reload(row.id);
  };

  /**
   * Read-modify-write of one cart under its row lock: concurrent requests on the same cart
   * (two "add" taps, a line edit racing a merge) each see the previous one's lines instead of
   * overwriting them from a stale snapshot.
   */
  const mutateLocked = async (
    row: CartRow,
    ctx: ServiceContext,
    change: (fresh: CartRow) => Record<string, unknown> | Promise<Record<string, unknown>>,
  ): Promise<CartRow> =>
    strapi.db.transaction(async ({ trx }: { trx: TransactionClient }) => {
      const locked = await trx('plugins_ordering_cart').where({ id: row.id }).forUpdate().first('id');
      if (!locked) throw new OrderingError('CART_NOT_FOUND', 'cart not found');
      const fresh = await reload(row.id);
      if (fresh.status !== 'active') expiredOrMissing(fresh);
      return save(fresh, await change(fresh), ctx);
    });

  const loadByToken = async (token: string): Promise<CartRow | null> =>
    (await carts().findOne({
      where: { tokenHash: hashingForConfig(config()).cartTokenHash(token) },
      populate: { customer: true },
    })) as CartRow | null;

  const loadForCustomer = async (
    customerId: number,
    opts: { includeConverted?: boolean } = {},
  ): Promise<CartRow | null> =>
    (await carts().findOne({
      where: {
        customer: customerId,
        status: opts.includeConverted ? { $in: ['active', 'converted'] } : 'active',
      },
      populate: { customer: true },
      orderBy: { lastActivityAt: 'desc' },
    })) as CartRow | null;

  const linesOf = (row: CartRow): CartLine[] => (Array.isArray(row.lines) ? row.lines : []);

  /** Line identity for merge/dedupe: sellable + variant + option signature. */
  const lineKey = (line: CartLine) =>
    `${line.sellableUid}|${line.variantUid ?? ''}|${[...line.selected]
      .map((pick) => `${pick.groupUid}=${pick.optionUid}x${pick.quantity}`)
      .sort()
      .join(',')}`;

  /** `lineIndex` errors carry `details.lineIndex` — remap to the cart's line id. */
  const issueFor = (error: unknown, lines: CartLine[]): CartIssue | null => {
    if (!(error instanceof OrderingError)) return null;
    const index = (error.details as { lineIndex?: unknown } | undefined)?.lineIndex;
    if (typeof index === 'number' && lines[index]) {
      return { lineId: lines[index].id, code: error.code, message: error.message };
    }
    return { code: error.code, message: error.message };
  };

  const service = {
    /**
     * POST /carts. A guest cart gets a bearer token (shown once, like the order token); a
     * signed-in customer reuses their active cart or starts one — never a token.
     */
    async create(
      input: {
        locationRef?: unknown;
        receiveMethod?: unknown;
        pickup?: unknown;
        locale?: unknown;
        contact?: unknown;
        promotionCode?: unknown;
      },
      owner: { customerId: number | null },
      ctx: ServiceContext,
    ): Promise<{ row: CartRow; cartToken: string | null }> {
      assertEnabled();
      if (owner.customerId) {
        const existing = await loadForCustomer(owner.customerId);
        if (existing) {
          return { row: await service.patch(existing, input, ctx), cartToken: null };
        }
      }
      const now = nowOf(ctx);
      const cartToken = owner.customerId ? null : generateBearerToken();
      const locationRef =
        typeof input.locationRef === 'string' ? input.locationRef.slice(0, 32) : null;
      const row = (await carts().create({
        data: {
          tokenHash: cartToken ? hashingForConfig(config()).cartTokenHash(cartToken) : null,
          customer: owner.customerId ?? null,
          locationRef,
          receiveMethod:
            input.receiveMethod === undefined
              ? null
              : normalizeReceiveMethod(input.receiveMethod, locationRef),
          pickup: input.pickup === undefined ? null : normalizePickup(input.pickup),
          contact: normalizeContact(input.contact),
          locale: typeof input.locale === 'string' ? input.locale.slice(0, 10) : null,
          promotionCode: promotionCodeOf(input.promotionCode),
          lines: [],
          status: 'active',
          lastActivityAt: now,
          expiresAt: new Date(now.getTime() + config().carts.expiryDays * 86_400_000),
        },
      })) as CartRow;
      return { row, cartToken };
    },

    /**
     * `X-Cart-Token` and/or the customer session → the one active cart. Guest carts merge into
     * the customer's cart when both arrive (sign-in merge, "gộp khi đăng nhập"); a token naming
     * a foreign customer's cart is ignored when the session has its own. `allowConverted` (the
     * checkout path) also surfaces `converted` carts so a retried checkout can replay.
     */
    async resolve(
      owner: CartOwner,
      ctx: ServiceContext,
      opts: { allowConverted?: boolean } = {},
    ): Promise<CartRow> {
      assertEnabled();
      const tokenCart = owner.cartToken ? await loadByToken(owner.cartToken) : null;
      const mine = owner.customerId
        ? await loadForCustomer(owner.customerId, { includeConverted: !!opts.allowConverted })
        : null;
      if (tokenCart && owner.customerId) {
        if (tokenCart.status !== 'active') {
          if (
            opts.allowConverted &&
            tokenCart.status === 'converted' &&
            tokenCart.customer?.id === owner.customerId
          ) {
            return tokenCart;
          }
          return mine ?? expiredOrMissing(tokenCart);
        }
        const tokenOwner = tokenCart.customer?.id ?? null;
        if (tokenOwner === owner.customerId) return tokenCart;
        if (tokenOwner === null) return service.merge(owner.customerId, tokenCart, ctx);
        if (mine) return mine;
        throw new OrderingError('CART_NOT_FOUND', 'cart not found');
      }
      if (tokenCart) {
        if (tokenCart.status === 'active') return tokenCart;
        if (opts.allowConverted && tokenCart.status === 'converted') return tokenCart;
        return expiredOrMissing(tokenCart);
      }
      if (mine) return mine;
      throw new OrderingError('CART_NOT_FOUND', 'cart not found');
    },

    /**
     * Guest cart → the customer's cart. No active customer cart: claim the row (its token keeps
     * working). Otherwise lines merge by lineKey (quantity summed, capped at maxLines) and the
     * guest cart is expired — leftovers beyond the cap are dropped.
     */
    async merge(customerId: number, guest: CartRow, ctx: ServiceContext): Promise<CartRow> {
      return strapi.db.transaction(async ({ trx }: { trx: TransactionClient }) => {
        // Serialize merges for a customer even before their target cart exists.
        await trx.raw('SELECT pg_advisory_xact_lock(hashtext(?))', [`ordering-cart-merge:${customerId}`]);
        const target = await loadForCustomer(customerId);
        const ids = [...new Set([guest.id, ...(target ? [target.id] : [])])].sort((a, b) => a - b);
        for (const id of ids) {
          const locked = await trx('plugins_ordering_cart').where({ id }).forUpdate().first('id');
          if (!locked) throw new OrderingError('CART_NOT_FOUND', 'cart not found');
        }
        const source = await reload(guest.id);
        const fresh = target ? await reload(target.id) : null;
        const sourceOwner = source.customer?.id ?? null;
        if (sourceOwner !== null && sourceOwner !== customerId) {
          throw new OrderingError('CART_NOT_FOUND', 'cart not found');
        }
        if (fresh && fresh.status !== 'active') expiredOrMissing(fresh);
        if (source.status !== 'active') return fresh ?? expiredOrMissing(source);
        if (!fresh || fresh.id === source.id) {
          if (sourceOwner === null) {
            await carts().update({ where: { id: source.id }, data: { customer: customerId } });
          }
          return reload(source.id);
        }
        const merged = linesOf(fresh);
        const byKey = new Map(merged.map((line) => [lineKey(line), line]));
        for (const line of linesOf(source)) {
          const existing = byKey.get(lineKey(line));
          if (existing) {
            existing.quantity = Math.min(existing.quantity + line.quantity, QUANTITY_CAP);
          } else {
            if (merged.length >= config().carts.maxLines) break;
            const mergedLine = { ...line, id: randomUUID() };
            merged.push(mergedLine);
            byKey.set(lineKey(mergedLine), mergedLine);
          }
        }
        await carts().update({ where: { id: source.id }, data: { status: 'expired' } });
        return save(fresh, {
          lines: merged,
          ...(!fresh.promotionCode && source.promotionCode ? { promotionCode: source.promotionCode } : {}),
        }, ctx);
      });
    },

    /** PATCH /carts/current — shallow merge of the editable fields. */
    async patch(
      row: CartRow,
      input: {
        locationRef?: unknown;
        receiveMethod?: unknown;
        pickup?: unknown;
        locale?: unknown;
        contact?: unknown;
        promotionCode?: unknown;
      },
      ctx: ServiceContext,
    ): Promise<CartRow> {
      const data: Record<string, unknown> = {};
      if (input.promotionCode !== undefined) data.promotionCode = promotionCodeOf(input.promotionCode);
      if (input.locationRef !== undefined) {
        data.locationRef =
          typeof input.locationRef === 'string' ? input.locationRef.slice(0, 32) : null;
      }
      const locationRef = (data.locationRef as string | null | undefined) ?? row.locationRef;
      if (input.receiveMethod !== undefined) {
        data.receiveMethod =
          input.receiveMethod === null ? null : normalizeReceiveMethod(input.receiveMethod, locationRef);
      }
      if (input.pickup !== undefined) data.pickup = normalizePickup(input.pickup);
      if (input.contact !== undefined) data.contact = normalizeContact(input.contact);
      if (input.locale !== undefined) {
        data.locale = typeof input.locale === 'string' ? input.locale.slice(0, 10) : null;
      }
      return save(row, data, ctx);
    },

    /** POST /carts/current/lines — append or top up an identical line; `CART_LIMIT` past 50. */
    async addLine(
      row: CartRow,
      input: Record<string, unknown>,
      ctx: ServiceContext,
    ): Promise<CartRow> {
      const line = normalizeLine(input);
      return mutateLocked(row, ctx, (fresh) => {
        const lines = linesOf(fresh);
        const existing = lines.find((candidate) => lineKey(candidate) === lineKey(line));
        if (existing) {
          existing.quantity = Math.min(existing.quantity + line.quantity, QUANTITY_CAP);
        } else {
          if (lines.length >= config().carts.maxLines) {
            throw new OrderingError('CART_LIMIT', 'the cart holds at most 50 lines', {
              details: { limit: config().carts.maxLines },
            });
          }
          lines.push(line);
        }
        return { lines };
      });
    },

    /** PATCH /carts/current/lines/:lineId — quantity/selected/note; foreign ids 404. */
    async updateLine(
      row: CartRow,
      lineId: string,
      input: Record<string, unknown>,
      ctx: ServiceContext,
    ): Promise<CartRow> {
      return mutateLocked(row, ctx, (fresh) => {
        const lines = linesOf(fresh);
        const index = lines.findIndex((candidate) => candidate.id === lineId);
        if (index < 0) {
          throw new OrderingError('CART_NOT_FOUND', 'line not found', { details: { lineId } });
        }
        lines[index] = { ...normalizeLine({ ...lines[index], ...input }), id: lineId };
        return { lines };
      });
    },

    /** DELETE /carts/current/lines/:lineId — 404 when the id is not in this cart. */
    async removeLine(row: CartRow, lineId: string, ctx: ServiceContext): Promise<CartRow> {
      return mutateLocked(row, ctx, (fresh) => {
        const lines = linesOf(fresh);
        if (!lines.some((candidate) => candidate.id === lineId)) {
          throw new OrderingError('CART_NOT_FOUND', 'line not found', { details: { lineId } });
        }
        return { lines: lines.filter((candidate) => candidate.id !== lineId) };
      });
    },

    /**
     * The cart payload: stored fields re-quoted live. Per-line catalog failures become `issues`
     * and the line drops out of the quote (retry until clean or empty); cart-level failures
     * (inactive branch, mixed workflows, min-order) mean `quote: null` + a cart-level issue.
     */
    async view(row: CartRow, ctx: ServiceContext) {
      const cartView = {
        id: row.documentId,
        locationRef: row.locationRef,
        receiveMethod: row.receiveMethod,
        pickup: row.pickup,
        contact: row.contact,
        lines: linesOf(row),
        locale: row.locale,
        promotionCode: row.promotionCode ?? null,
        expiresAt: new Date(row.expiresAt).toISOString(),
      };
      if (!row.locationRef || !row.receiveMethod) {
        return { cart: cartView, quote: null, issues: [] as CartIssue[] };
      }
      const issues: CartIssue[] = [];
      const candidates = [...linesOf(row)];
      let quote = null;
      for (;;) {
        try {
          quote = await orders().quote(
            {
              locationRef: row.locationRef,
              ...(row.locale ? { locale: row.locale } : {}),
              lines: candidates.map((line) => ({
                sellableUid: line.sellableUid,
                quantity: line.quantity,
                selected: line.selected,
                ...(line.variantUid ? { variantUid: line.variantUid } : {}),
                ...(line.note ? { note: line.note } : {}),
              })),
              receiveMethod: row.receiveMethod as never,
              // Public cart quotes do not consult a phone's order history (O8).
              contact: { phone: '' },
              consent: { policyVersion: config().consent.policyVersion, channel: 'web-checkout' },
              origin: { kind: 'storefront' },
              ...(row.customer?.id ? { customerId: row.customer.id } : {}),
              ...(row.pickup ? { pickup: row.pickup as never } : {}),
              ...(row.promotionCode ? { promotionCode: row.promotionCode } : {}),
            },
            ctx,
          );
          break;
        } catch (error) {
          const issue = issueFor(error, candidates);
          if (!issue) throw error;
          if (!issue.lineId) {
            issues.push(issue);
            break;
          }
          issues.push(issue);
          candidates.splice(
            candidates.findIndex((line) => line.id === issue.lineId),
            1,
          );
        }
      }
      return { cart: cartView, quote, issues };
    },

    /**
     * POST /carts/current/checkout → createOrder with the cart's live contents (the order
     * re-prices in the cart checkout transaction; no `expectedCartHash` is enforced — reads re-quote
     * continuously). The cart flips to `converted` and stores the order link — also on replay,
     * so a crash between order-create and cart-update self-heals.
     */
    async checkout(
      row: CartRow,
      input: {
        consent: { policyVersion: string; marketingOptIn?: boolean };
        payment?: { providerCode: string; giftCardCode?: string };
        idempotencyKey: string;
        customerId: number | null;
      },
      ctx: ServiceContext,
    ): Promise<CreateOrderResult> {
      return strapi.db.transaction(async ({ trx }) => {
        // Erasure locks the customer before deleting their carts. Use that same order,
        // rather than holding a cart while waiting for the customer's advisory lock.
        const customerId = input.customerId ?? row.customer?.id;
        if (customerId) {
          const identity = (await strapi.db.query('plugin::ordering.customer').findOne({
            where: { id: customerId }, select: ['id', 'phoneHash'],
          })) as { id: number; phoneHash: string | null } | null;
          if (identity) await lockCustomer(trx, identity);
        }
        // Serialize checkout by cart, then read its committed status and live contents.
        const locked = await trx('plugins_ordering_cart').where({ id: row.id }).forUpdate().first('id');
        if (!locked) throw new OrderingError('CART_NOT_FOUND', 'cart not found');
        row = await reload(row.id);
        if (row.status !== 'active' && row.status !== 'converted') expiredOrMissing(row);
        // A converted cart may only replay: the presented key must be the original one —
        // `createOrder` then answers the stored order (or mismatches → IDEMPOTENCY_PAYLOAD_MISMATCH).
        // Any other key would mint a duplicate order, so it reads as a dead cart.
        if (row.status === 'converted') {
          const seen = await strapi.db.query('plugin::ordering.idempotency-key').findOne({
            where: { scope: 'order.create', key: input.idempotencyKey },
            select: ['id', 'responseRef'],
          });
          const orderId = typeof row.order === 'object' ? row.order?.id : row.order;
          if (!seen || seen.responseRef !== `order:${orderId}`) {
            throw new OrderingError('CART_EXPIRED', 'this cart is no longer active');
          }
        }
        if (!row.locationRef || !row.receiveMethod) {
          throw new OrderingError('VALIDATION_ERROR', 'cart needs a branch and a receive method', {
            details: { field: 'locationRef' },
          });
        }
        const contact = row.contact?.phone
          ? row.contact
          : input.customerId
            ? await service.contactForCustomer(input.customerId)
            : null;
        if (!contact?.phone) {
          throw new OrderingError('VALIDATION_ERROR', 'contact.phone is required', {
            details: { field: 'contact.phone' },
          });
        }
        const result = await orders().createOrder(
          {
            idempotencyKey: input.idempotencyKey,
            locationRef: row.locationRef,
            ...(row.locale ? { locale: row.locale } : {}),
            lines: linesOf(row).map((line) => ({
              sellableUid: line.sellableUid,
              quantity: line.quantity,
              selected: line.selected,
              ...(line.variantUid ? { variantUid: line.variantUid } : {}),
              ...(line.note ? { note: line.note } : {}),
            })),
            receiveMethod: row.receiveMethod as never,
            contact: {
              name: contact.name,
              phone: contact.phone as string,
              ...(contact.email ? { email: contact.email } : {}),
            },
            consent: {
              policyVersion: input.consent.policyVersion,
              marketingOptIn: input.consent.marketingOptIn,
              channel: 'web-checkout',
            },
            ...(input.payment ? { payment: input.payment } : {}),
            origin: { kind: 'storefront' },
            ...(input.customerId ? { customerId: input.customerId } : {}),
            ...(row.pickup ? { pickup: row.pickup as never } : {}),
            ...(row.promotionCode ? { promotionCode: row.promotionCode } : {}),
          },
          ctx,
        );
        await carts().update({
          where: { id: row.id },
          data: { status: 'converted', order: result.order.order.id },
        });
        return result;
      });
    },

    /** Customer profile phone/name/email for a signed-in checkout without `cart.contact`. */
    async contactForCustomer(customerId: number): Promise<CartRow['contact']> {
      const row = (await strapi.db.query('plugin::ordering.customer').findOne({
        where: { id: customerId },
      })) as { phone: string | null; name: string | null; email: string | null } | null;
      if (!row) return null;
      return {
        ...(row.name ? { name: row.name } : {}),
        ...(row.phone ? { phone: row.phone } : {}),
        ...(row.email ? { email: row.email } : {}),
      };
    },

    /**
     * POST /me/orders/:code/reorder (O11 step 5): the order's still-sellable lines land in the
     * customer's active cart ("giỏ mới" — existing lines are replaced, not merged). Fully
     * canceled lines and lines the catalog can no longer price fall into `unavailable`
     * ({title, reason, code}); a cart-level quote failure keeps every line — issues surface on
     * the next read anyway. Branch, receive kind and address carry over; the old timing does
     * not (a past slot is meaningless). Foreign codes 404 like `orderByCode`.
     */
    async fromOrder(
      customerId: number,
      code: string,
      ctx: ServiceContext,
    ): Promise<{ row: CartRow; unavailable: Array<{ title: string; reason: string; code: string }> }> {
      assertEnabled();
      const orderRow = (await strapi.db.query('plugin::ordering.order').findOne({
        where: { code: code.trim().toUpperCase(), customer: customerId, status: { $ne: 'draft' } },
        select: ['id'],
      })) as { id: number } | null;
      if (!orderRow) throw new OrderingError('ORDER_NOT_FOUND', 'order not found');
      const aggregate = await repo.loadOrderAggregate(orderRow.id);
      if (!aggregate) throw new OrderingError('ORDER_NOT_FOUND', 'order not found');

      const unavailable: Array<{ title: string; reason: string; code: string }> = [];
      const candidates = aggregate.lines
        .map((line) => ({
          title: line.titleSnapshot,
          line: {
            id: randomUUID(),
            sellableUid: line.sellableUid,
            ...(line.variantUid ? { variantUid: line.variantUid } : {}),
            selected: ((line.selectedOptionsSnapshot as SelectedOptionSnapshot[] | null) ?? []).map(
              (pick) => ({
                groupUid: pick.groupUid,
                optionUid: pick.optionUid,
                quantity: pick.quantity ?? 1,
              }),
            ),
            quantity: line.quantity - line.canceledQuantity,
            ...(line.note ? { note: line.note } : {}),
          } as CartLine,
        }))
        .filter(({ title, line }) => {
          if (line.quantity > 0) return true;
          unavailable.push({ title, reason: 'the line was canceled', code: 'LINE_CANCELED' });
          return false;
        });

      // Availability: quote the set, drop each line the catalog rejects, retry until clean.
      const orderContact = aggregate.order.contactSnapshot as {
        name?: string;
        phone?: string;
        email?: string;
      };
      const candidates2 = candidates.map(({ line }) => line);
      for (;;) {
        try {
          await orders().quote(
            {
              locationRef: aggregate.order.locationRef,
              lines: candidates2.map((line) => ({
                sellableUid: line.sellableUid,
                quantity: line.quantity,
                selected: line.selected,
                ...(line.variantUid ? { variantUid: line.variantUid } : {}),
                ...(line.note ? { note: line.note } : {}),
              })),
              receiveMethod: aggregate.order.receiveMethod as never,
              contact: { phone: '' },
              consent: { policyVersion: config().consent.policyVersion, channel: 'web-checkout' },
              origin: { kind: 'storefront' },
              customerId,
            },
            ctx,
          );
          break;
        } catch (error) {
          const index =
            error instanceof OrderingError
              ? (error.details as { lineIndex?: unknown } | undefined)?.lineIndex
              : undefined;
          if (typeof index === 'number' && candidates2[index]) {
            unavailable.push({
              title: candidates[index].title,
              reason: (error as Error).message,
              code: (error as OrderingError).code,
            });
            candidates2.splice(index, 1);
            candidates.splice(index, 1);
            continue;
          }
          // Cart-level failure (inactive branch, mixed workflows): keep every line.
          break;
        }
      }
      const lines = candidates2.slice(0, config().carts.maxLines);
      for (const dropped of candidates2.slice(config().carts.maxLines)) {
        const entry = candidates.find(({ line }) => line === dropped);
        unavailable.push({
          title: entry?.title ?? dropped.sellableUid,
          reason: 'the cart holds at most 50 lines',
          code: 'CART_LIMIT',
        });
      }

      // Receive method: kind + delivery address carry; timing never does.
      const stored = aggregate.order.receiveMethod as {
        kind?: string;
        address?: Record<string, unknown>;
        providerCode?: string;
      };
      const receiveMethod =
        stored.kind === 'delivery'
          ? {
              kind: 'delivery',
              providerCode: stored.providerCode ?? 'self-delivery',
              ...(stored.address ? { address: stored.address } : {}),
            }
          : { kind: 'pickup', locationRef: aggregate.order.locationRef };

      const existing = await loadForCustomer(customerId);
      const data = {
        lines,
        locationRef: aggregate.order.locationRef,
        receiveMethod,
        pickup: null,
        locale: aggregate.order.placedLocale ?? null,
        reminderSentAt: null,
        ...(existing?.contact
          ? {}
          : {
              contact: {
                ...(orderContact.name ? { name: orderContact.name } : {}),
                ...(orderContact.phone ? { phone: orderContact.phone } : {}),
                ...(orderContact.email ? { email: orderContact.email } : {}),
              },
            }),
      };
      if (existing) {
        return { row: await save(existing, data, ctx), unavailable };
      }
      const now = nowOf(ctx);
      const row = (await carts().create({
        data: {
          ...data,
          tokenHash: null,
          customer: customerId,
          status: 'active',
          lastActivityAt: now,
          expiresAt: new Date(now.getTime() + config().carts.expiryDays * 86_400_000),
        },
      })) as CartRow;
      return { row, unavailable };
    },

    /**
     * `cart-reminder` job body (O11 step 5): active carts that have been idle at least
     * `carts.reminderIdleHours` get ONE `customer.cart-reminder` mail — only when the branch
     * opted in (`cartReminderEnabled`), the customer holds marketing consent and an email is
     * reachable (cart contact first, then the profile). Ineligible carts stay unmarked and are
     * re-evaluated next run; a failed send also retries — `reminderSentAt` is set only on a
     * sent/skipped delivery. Guest carts never qualify: no consent record exists.
     */
    async remindDue(now: Date) {
      if (!config().carts.enabled) return { sent: 0, failed: 0, skipped: 0 };
      const cutoff = new Date(now.getTime() - config().carts.reminderIdleHours * 3_600_000);
      const candidates = (await carts().findMany({
        where: {
          status: 'active',
          reminderSentAt: null,
          lastActivityAt: { $lte: cutoff },
        },
        populate: { customer: true },
        orderBy: { lastActivityAt: 'asc' },
        limit: 200,
      })) as CartRow[];
      let sent = 0;
      let failed = 0;
      let skipped = 0;
      for (const row of candidates) {
        if (!row.customer || linesOf(row).length === 0 || !row.locationRef) continue;
        const customer = (await strapi.db.query('plugin::ordering.customer').findOne({
          where: { id: row.customer.id },
        })) as {
          status: string;
          email: string | null;
          marketingConsent: { granted?: boolean } | null;
        } | null;
        if (!customer || customer.status === 'erased' || customer.marketingConsent?.granted !== true) {
          continue;
        }
        const email = row.contact?.email ?? customer.email;
        if (!email) continue;
        const branch = await branches().findByCode(row.locationRef);
        if (!branch?.isActive || branch.cartReminderEnabled !== true) continue;
        const outcome = await service.sendReminder(row, email, now);
        if (outcome === 'sent') sent += 1;
        else if (outcome === 'failed') failed += 1;
        else skipped += 1;
      }
      return { sent, failed, skipped };
    },

    /**
     * One reminder delivery for `row`: the delivery log dedupes on the deterministic event id,
     * so a job rerun after a crash can't double-send. Returns the outcome that decides whether
     * `reminderSentAt` is stamped.
     */
    async sendReminder(
      row: CartRow,
      email: string,
      now: Date,
    ): Promise<'sent' | 'skipped' | 'failed' | 'already'> {
      const deliveries = () => strapi.db.query('plugin::ordering.notification-delivery');
      const key = {
        eventId: `cart-reminder:${row.id}`,
        template: 'customer.cart-reminder',
        recipientHash: sha256Hex(email.trim().toLowerCase()),
      };
      let delivery = (await deliveries().findOne({ where: key })) as {
        id: number;
        status: string;
        attempts: number;
      } | null;
      if (delivery && (delivery.status === 'sent' || delivery.status === 'skipped')) {
        await carts().update({ where: { id: row.id }, data: { reminderSentAt: now } });
        return 'already';
      }
      if (!delivery) {
        delivery = (await deliveries().create({
          data: {
            ...key,
            channel: 'email',
            recipientRole: 'customer',
            orderId: null,
            messageLocale: row.locale === 'en' ? 'en' : 'vi',
            status: 'pending',
            attempts: 0,
          },
        })) as { id: number; status: string; attempts: number };
      }
      const rowId = delivery.id;
      const attempt = delivery.attempts + 1;
      const mark = (status: string, extra: Record<string, unknown> = {}) =>
        deliveries().update({ where: { id: rowId }, data: { status, attempts: attempt, ...extra } });
      const finish = async (status: 'sent' | 'skipped') => {
        await mark(status, status === 'sent' ? { sentAt: now } : {});
        await carts().update({ where: { id: row.id }, data: { reminderSentAt: now } });
        return status;
      };
      if (!config().notifications.email.enabled) return finish('skipped');
      const locale = row.locale === 'en' ? 'en' : 'vi';
      const branch = await branches().findByCode(row.locationRef ?? '');
      const name = (branch?.name ?? {}) as Record<string, string>;
      // Items + total are best-effort from a live quote; a cart that no longer prices just
      // lists its sellable uids. Titles map 1:1 by sellableUid (variants share the title).
      let total: number | undefined;
      let titleByUid = new Map<string, string>();
      try {
        const { quote } = await service.view(row, { actor: { kind: 'system' }, requestId: randomUUID() });
        const quoted = quote as {
          totals?: { grandTotal?: number };
          lines?: Array<{ sellableUid: string; title?: string }>;
        } | null;
        total = quoted?.totals?.grandTotal;
        titleByUid = new Map(
          (quoted?.lines ?? []).map((line) => [line.sellableUid, line.title ?? line.sellableUid]),
        );
      } catch {
        total = undefined;
      }
      try {
        const rendered = await templates().renderFor('customer.cart-reminder', locale, {
          branch: name[locale] ?? name.vi ?? row.locationRef ?? '',
          items: linesOf(row).map((line) => ({
            title: titleByUid.get(line.sellableUid) ?? line.sellableUid,
            quantity: line.quantity,
          })),
          ...(total !== undefined ? { total } : {}),
        });
        await registry()
          .notificationProvider('email')
          .send({ recipient: { email }, template: 'customer.cart-reminder', data: rendered });
        return finish('sent');
      } catch (error) {
        await mark('failed', {
          lastError: String((error as Error)?.message ?? error).slice(0, 500),
        });
        return 'failed';
      }
    },

    /**
     * `cart-expiry` job body: active carts past `expiresAt` flip to `expired`; `expired` and
     * `converted` rows are hard-deleted `carts.expiredDeleteDays` after expiry (bounded batches).
     */
    async expireDue(now: Date) {
      const knex = strapi.db.connection;
      let expired = 0;
      let deleted = 0;
      for (;;) {
        const ids = (await knex('plugins_ordering_cart')
          .where('status', 'active')
          .where('expires_at', '<', now)
          .orderBy('id')
          .limit(500)
          .select('id')) as Array<{ id: number }>;
        if (ids.length === 0) break;
        expired += await knex('plugins_ordering_cart')
          .whereIn(
            'id',
            ids.map((r) => r.id),
          )
          .update({ status: 'expired' });
      }
      const cutoff = new Date(now.getTime() - config().carts.expiredDeleteDays * 86_400_000);
      for (;;) {
        const ids = (await knex('plugins_ordering_cart')
          .whereIn('status', ['expired', 'converted'])
          .where('expires_at', '<', cutoff)
          .orderBy('id')
          .limit(500)
          .select('id')) as Array<{ id: number }>;
        if (ids.length === 0) break;
        deleted += await knex('plugins_ordering_cart')
          .whereIn(
            'id',
            ids.map((r) => r.id),
          )
          .delete();
      }
      return { expired, deleted };
    },
  };
  return service;
};

/** Shared status handler: dead carts read as 410, missing rows as 404 (never "foreign"). */
const expiredOrMissing = (row: CartRow): never => {
  if (row.status === 'expired' || row.status === 'converted') {
    throw new OrderingError('CART_EXPIRED', 'this cart is no longer active');
  }
  throw new OrderingError('CART_NOT_FOUND', 'cart not found');
};

export default cart;
