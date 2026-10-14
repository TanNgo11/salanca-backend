import type { Core } from '@strapi/strapi';

import type { OrderingConfig } from '../config';
import { snapshotDeliveryAddress } from '../domain/contact/address';
import { o11Hashing } from '../domain/customers/identity';
import { OrderingError } from '../domain/errors';
import { lookupOrderView } from '../domain/storefront/serialize';
import orderRepository from '../repositories/order';
import type adminUnitsFactory from './admin-units';
import type timelineFactory from './timeline';
import type { ServiceContext } from './context';
import { nowOf } from './context';
import { lockCustomer } from './customer-lock';
import type { OutboxEvent } from '../contracts';
import { currentPolicyVersion } from './ordering-settings';

type CustomerRow = {
  id: number;
  documentId: string;
  phone: string | null;
  email: string | null;
  emailVerifiedAt: string | null;
  name: string | null;
  status: string;
  marketingConsent: Record<string, unknown> | null;
  orderCount: number;
  totalSpent: string | number;
  lastOrderAt: string | null;
  createdAt: string;
};

type AddressRow = {
  id: number;
  documentId: string;
  label: string | null;
  recipientName: string;
  phone: string;
  line1: string;
  wardCode: string;
  wardName: string | null;
  provinceCode: string | null;
  provinceName: string | null;
  note: string | null;
  isDefault: boolean;
};

const MAX_ADDRESSES = 10;

/** Self-view profile (the customer sees their own row, allowlisted). */
export const profileView = (row: CustomerRow) => ({
  id: row.documentId,
  name: row.name,
  email: row.email,
  phone: row.phone,
  status: row.status,
  marketingConsent: row.marketingConsent ?? null,
  orderCount: row.orderCount,
  totalSpent: Number(row.totalSpent),
  lastOrderAt: row.lastOrderAt,
  createdAt: row.createdAt,
});

const addressView = (row: AddressRow) => ({
  id: row.documentId,
  label: row.label,
  recipientName: row.recipientName,
  phone: row.phone,
  line1: row.line1,
  communeCode: row.wardCode,
  communeName: row.wardName,
  provinceCode: row.provinceCode,
  provinceName: row.provinceName,
  note: row.note,
  isDefault: row.isDefault,
});

export type AddressInput = {
  label?: unknown;
  recipientName?: unknown;
  phone?: unknown;
  line1?: unknown;
  communeCode?: unknown;
  note?: unknown;
  isDefault?: unknown;
};

/**
 * O11 step 3 — customer-facing profile, address book, order history and the order-linking +
 * stats hooks. Everything is scoped to `customerId` (resolved from `X-Customer-Token` by the
 * controller): a foreign documentId/code reads as missing, never as forbidden.
 */
const customer = ({ strapi }: { strapi: Core.Strapi }) => {
  const plugin = () => strapi.plugin('ordering');
  const config = () => strapi.config.get('plugin::ordering') as OrderingConfig;
  const hashing = () => o11Hashing(config().encryptionKey);
  const customers = () => strapi.db.query('plugin::ordering.customer');
  const addresses = () => strapi.db.query('plugin::ordering.customer-address');
  const orders = () => strapi.db.query('plugin::ordering.order');
  const units = () =>
    plugin().service('admin-units') as ReturnType<typeof adminUnitsFactory>;
  const timeline = () =>
    plugin().service('timeline') as ReturnType<typeof timelineFactory>;

  const rowFor = async (customerId: number): Promise<CustomerRow> => {
    const row = (await customers().findOne({ where: { id: customerId } })) as CustomerRow | null;
    if (!row || row.status === 'erased') {
      throw new OrderingError('CUSTOMER_NOT_FOUND', 'customer not found');
    }
    return row;
  };

  const addressRowFor = async (customerId: number, documentId: string): Promise<AddressRow> => {
    const row = (await addresses().findOne({
      where: { documentId, customer: customerId },
    })) as AddressRow | null;
    if (!row) throw new OrderingError('ADDRESS_NOT_FOUND', 'address not found');
    return row;
  };

  /** Validates the O5 address shape against the admin-units catalog; throws VALIDATION_ERROR. */
  const buildAddressData = (input: AddressInput, customerId: number) => {
    const result = snapshotDeliveryAddress(
      {
        recipientName: typeof input.recipientName === 'string' ? input.recipientName : undefined,
        phone: typeof input.phone === 'string' ? input.phone : undefined,
        line1: typeof input.line1 === 'string' ? input.line1 : undefined,
        communeCode: typeof input.communeCode === 'string' ? input.communeCode : undefined,
        note: typeof input.note === 'string' ? input.note : undefined,
      },
      units().catalog(),
    );
    if (!result.ok) {
      throw new OrderingError('VALIDATION_ERROR', result.message, {
        details: { field: result.field, reason: result.reason },
      });
    }
    const snapshot = result.address;
    return {
      customer: customerId,
      label: typeof input.label === 'string' ? input.label.trim().slice(0, 40) || null : null,
      recipientName: snapshot.recipientName ?? null,
      phone: snapshot.phone ?? null,
      line1: snapshot.line1,
      wardCode: snapshot.wardCode,
      wardName: snapshot.wardName ?? null,
      provinceCode: snapshot.provinceCode ?? null,
      provinceName: snapshot.provinceName ?? null,
      note: snapshot.note ?? null,
      isDefault: input.isDefault === true,
    };
  };

  const clearOtherDefaults = async (customerId: number, keepId?: number) => {
    const defaults = (await addresses().findMany({
      where: { customer: customerId, isDefault: true },
      select: ['id'],
    })) as { id: number }[];
    for (const row of defaults) {
      if (row.id !== keepId) {
        await addresses().update({ where: { id: row.id }, data: { isDefault: false } });
      }
    }
  };

  const service = {
    profile: async (customerId: number) => profileView(await rowFor(customerId)),

    /**
     * PUT /me. `email` is accepted only unchanged — switching it needs a verified OTP to the
     * new mailbox (the purpose-bound challenge lands with the O13 channel work).
     * `marketingConsent {granted}` is stamped at/source/policyVersion; previous values roll
     * into `history` inside the same JSON so C2 can show the consent trail.
     */
    async updateProfile(
      customerId: number,
      input: { name?: unknown; email?: unknown; marketingConsent?: unknown },
      ctx: ServiceContext,
    ) {
      const row = await rowFor(customerId);
      const data: Record<string, unknown> = {};
      if (input.name !== undefined) {
        const name = typeof input.name === 'string' ? input.name.trim() : '';
        if (name.length > 120) {
          throw new OrderingError('VALIDATION_ERROR', 'name is too long', {
            details: { field: 'name', max: 120 },
          });
        }
        data.name = name || null;
      }
      if (input.email !== undefined && input.email !== row.email) {
        throw new OrderingError('VALIDATION_ERROR', 'changing email requires OTP verification', {
          details: { field: 'email' },
        });
      }
      if (input.marketingConsent !== undefined) {
        const granted =
          typeof input.marketingConsent === 'object' && input.marketingConsent !== null
            ? (input.marketingConsent as { granted?: unknown }).granted === true
            : input.marketingConsent === true;
        const previous = row.marketingConsent;
        const entry = {
          granted,
          at: nowOf(ctx).toISOString(),
          source: 'self',
          policyVersion: await currentPolicyVersion(strapi),
        };
        const history = [
          entry,
          ...(previous?.granted !== undefined
            ? [{ granted: previous.granted, at: previous.at, source: previous.source, policyVersion: previous.policyVersion }]
            : []),
          ...((previous?.history as unknown[] | undefined) ?? []),
        ].slice(0, 50);
        data.marketingConsent = { ...entry, history };
      }
      const updated = (await customers().update({
        where: { id: row.id },
        data,
      })) as CustomerRow;
      return profileView({ ...row, ...updated });
    },

    listAddresses: async (customerId: number) =>
      ((await addresses().findMany({
        where: { customer: customerId },
        orderBy: [{ isDefault: 'desc' }, { id: 'asc' }],
      })) as AddressRow[]).map(addressView),

    async createAddress(customerId: number, input: AddressInput) {
      await rowFor(customerId);
      const count = (await addresses().count({ where: { customer: customerId } })) as number;
      if (count >= MAX_ADDRESSES) {
        throw new OrderingError('VALIDATION_ERROR', 'the address book holds at most 10 entries', {
          details: { limit: MAX_ADDRESSES },
        });
      }
      const data = buildAddressData(input, customerId);
      if (count === 0) data.isDefault = true; // the first address becomes the default.
      const row = (await addresses().create({ data })) as AddressRow;
      if (row.isDefault) await clearOtherDefaults(customerId, row.id);
      return addressView(row);
    },

    async updateAddress(customerId: number, documentId: string, input: AddressInput) {
      const existing = await addressRowFor(customerId, documentId);
      const data = buildAddressData(input, customerId);
      if (input.isDefault === undefined) data.isDefault = existing.isDefault;
      const row = (await addresses().update({
        where: { id: existing.id },
        data,
      })) as AddressRow;
      if (row.isDefault) await clearOtherDefaults(customerId, row.id);
      return addressView(row);
    },

    async deleteAddress(customerId: number, documentId: string) {
      const existing = await addressRowFor(customerId, documentId);
      await addresses().delete({ where: { id: existing.id } });
      if (existing.isDefault) {
        const oldest = (await addresses().findMany({
          where: { customer: customerId },
          orderBy: { id: 'asc' },
          limit: 1,
        })) as AddressRow[];
        if (oldest[0]) {
          await addresses().update({ where: { id: oldest[0].id }, data: { isDefault: true } });
        }
      }
    },

    /**
     * GET /me/orders — own non-draft orders, newest first, rendered with the same status-only
     * `lookupOrderView` the code+phone lookup serves.
     */
    async myOrders(customerId: number, page: number, pageSize: number) {
      const where = { customer: customerId, status: { $ne: 'draft' } };
      const [rows, total] = await Promise.all([
        orders().findMany({
          where,
          select: ['id'],
          orderBy: { placedAt: 'desc' },
          offset: (page - 1) * pageSize,
          limit: pageSize,
        }) as Promise<{ id: number }[]>,
        orders().count({ where }),
      ]);
      const items = [];
      for (const row of rows) {
        const aggregate = await orderRepository({ strapi }).loadOrderAggregate(row.id);
        if (!aggregate) continue;
        const events = (await timeline().listPublic(row.id)) as Parameters<
          typeof lookupOrderView
        >[1];
        items.push(lookupOrderView(aggregate, events));
      }
      return { items, page, pageSize, total };
    },

    /** Own order by code → the same reduced view; anything else is a 404 (never "foreign"). */
    async orderByCode(customerId: number, code: string) {
      const row = (await orders().findOne({
        where: { code: code.trim().toUpperCase(), customer: customerId, status: { $ne: 'draft' } },
        select: ['id'],
      })) as { id: number } | null;
      if (!row) throw new OrderingError('ORDER_NOT_FOUND', 'order not found');
      const aggregate = await orderRepository({ strapi }).loadOrderAggregate(row.id);
      if (!aggregate) throw new OrderingError('ORDER_NOT_FOUND', 'order not found');
      const events = (await timeline().listPublic(row.id)) as Parameters<
        typeof lookupOrderView
      >[1];
      return lookupOrderView(aggregate, events);
    },

    /**
     * Order ↔ customer resolution for `createOrder` (plan step 3: "phiên hoặc theo SĐT" — the
     * session wins, the contact phone is the fallback; new phones get unverified profiles).
     * Erased profiles never match: a guest
     * order placed after erasure simply stays unlinked.
     */
    async linkForOrder(input: {
      sessionCustomerId?: number | null;
      phoneE164: string;
    }): Promise<number | null> {
      if (!config().customers.enabled) return null;
      return strapi.db.transaction(async ({ trx }) => {
        if (input.sessionCustomerId) {
          const identity = (await customers().findOne({
            where: { id: input.sessionCustomerId }, select: ['id', 'phoneHash'],
          })) as { id: number; phoneHash: string | null } | null;
          if (identity) {
            await lockCustomer(trx, identity);
            const current = (await customers().findOne({
              where: { id: identity.id }, select: ['id', 'status'],
            })) as { id: number; status: string } | null;
            return current && current.status !== 'erased' ? current.id : null;
          }
        }
        const phoneHash = hashing().phoneHash(input.phoneE164);
        // The advisory lock also covers the first order, before a customer row exists.
        await trx.raw('SELECT pg_advisory_xact_lock(hashtext(?))', [`ordering-customer:${phoneHash}`]);
        const existing = (await customers().findOne({
          where: { phoneHash },
          select: ['id', 'status'],
        })) as { id: number; status: string } | null;
        // Preserve erasure tombstones; an unauthenticated checkout must not resurrect them.
        if (existing) {
          await lockCustomer(trx, { id: existing.id, phoneHash });
          return existing.status === 'erased' ? null : existing.id;
        }
        const created = (await customers().create({
          data: { phone: input.phoneE164, phoneHash, status: 'unverified' },
        })) as { id: number };
        return created.id;
      });
    },

    /**
     * Outbox consumer for `order.transitioned`: a newly completed order refreshes the linked
     * customer's orderCount/totalSpent/lastOrderAt (same math as migration 0007's backfill).
     * Idempotent — the fields are recomputed, not incremented.
     */
    async onOrderTransitioned(event: OutboxEvent) {
      const payload = event.payload as { orderId?: unknown; to?: unknown };
      if (payload.to !== 'completed' || typeof payload.orderId !== 'number') return;
      const row = (await orders().findOne({
        where: { id: payload.orderId },
        select: ['id'],
        populate: { customer: true },
      })) as { id: number; customer?: { id: number } | null } | null;
      if (row?.customer?.id) await service.refreshStats(row.customer.id);
    },

    /** Recomputes the stats columns from linked completed orders (migration 0007 math). */
    async refreshStats(customerId: number) {
      const linked = (await orders().findMany({
        where: { customer: customerId, status: 'completed' },
        select: ['totalAmount', 'placedAt'],
        orderBy: { placedAt: 'desc' },
      })) as { totalAmount: number; placedAt: string }[];
      await customers().update({
        where: { id: customerId },
        data: {
          orderCount: linked.length,
          totalSpent: linked.reduce((sum, order) => sum + order.totalAmount, 0),
          lastOrderAt: linked[0]?.placedAt ?? null,
        },
      });
    },
  };
  return service;
};

export default customer;
