import type { Core } from '@strapi/strapi';

import { maskPhone as maskNationalPhone, normalizeVietnamesePhone } from '../../../shared/contact/phone';
import type { OrderingConfig } from '../config';
import { o11Hashing } from '../domain/customers/identity';
import { OrderingError } from '../domain/errors';
import { scopeWhere } from '../domain/scope';
import type changeLogFactory from './change-log';
import type scopeFactory from './scope';
import type { ServiceContext } from './context';

const CUSTOMER = 'plugins_ordering_customer';
const ORDER = 'plugins_ordering_order';
const ORDER_LINK = 'plugins_ordering_order_customer_lnk';

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
  staffNote: string | null;
  createdAt: string;
};

/**
 * Staff customer book (O11 step 7, screens C1–C3). Phones/emails leave the service masked;
 * the only way to see a full number is `revealPhone`, which writes `customer.reveal-phone`
 * to the append-only change log. A customer is visible to scoped staff only through an
 * order at one of their branches — otherwise every route answers 404 like orders do.
 */
const adminCustomers = ({ strapi }: { strapi: Core.Strapi }) => {
  const knex = () => strapi.db.connection;
  const customers = () => strapi.db.query('plugin::ordering.customer');
  const orders = () => strapi.db.query('plugin::ordering.order');
  const addresses = () => strapi.db.query('plugin::ordering.customer-address');
  const requests = () => strapi.db.query('plugin::ordering.data-request');
  const config = () => strapi.config.get('plugin::ordering') as OrderingConfig;
  const hashing = () =>
    o11Hashing((config() as { encryptionKey?: string } | undefined)?.encryptionKey);
  const changeLog = () =>
    strapi.plugin('ordering').service('change-log') as ReturnType<typeof changeLogFactory>;
  const scope = () =>
    strapi.plugin('ordering').service('scope') as ReturnType<typeof scopeFactory>;

  /** E.164 storage → the `090•••4567` national mask the screens specify. */
  const maskPhone = (phone: string | null | undefined): string | null => {
    const national = normalizeVietnamesePhone(phone ?? '');
    return national.valid ? maskNationalPhone(national.national) : null;
  };

  const maskEmail = (email: string | null | undefined): string | null => {
    if (typeof email !== 'string' || !email.includes('@')) return null;
    const [local, domain] = email.split('@');
    return `${local.slice(0, 1)}***@${domain}`;
  };

  /**
   * `[]` = no restriction; a refs list = the staff's branches; throws SCOPE_REQUIRED for a
   * staff actor with no usable scope — same contract as the order inbox (`orderWhere`).
   */
  const scopedRefs = async (ctx: ServiceContext): Promise<string[] | null> => {
    const staffScope = await scope().loadScope(ctx);
    const where = scopeWhere(staffScope);
    if (where === null) {
      throw new OrderingError('SCOPE_REQUIRED', 'staff member has no location scope');
    }
    const refs = (where as { locationRef?: { $in?: unknown } }).locationRef?.$in;
    return Array.isArray(refs) ? (refs as string[]) : null;
  };

  /** Customers visible to a scoped caller: any order at one of their branches. */
  const inScopeCustomers = (refs: string[]) =>
    knex()(ORDER_LINK)
      .join(ORDER, `${ORDER}.id`, `${ORDER_LINK}.order_id`)
      .whereIn(`${ORDER}.location_ref`, refs)
      .distinct(`${ORDER_LINK}.customer_id`);

  const loadCustomer = async (documentId: string, ctx: ServiceContext): Promise<CustomerRow> => {
    const customer = (await customers().findOne({
      where: { documentId },
    })) as CustomerRow | null;
    if (!customer) throw new OrderingError('CUSTOMER_NOT_FOUND', 'customer not found');
    const refs = await scopedRefs(ctx);
    if (refs !== null) {
      const inScope = (await orders().findOne({
        where: { customer: customer.id, locationRef: { $in: refs } },
        select: ['id'],
      })) as { id: number } | null;
      if (!inScope) throw new OrderingError('CUSTOMER_NOT_FOUND', 'customer not found');
    }
    return customer;
  };

  const escapeLike = (value: string) => value.replace(/[\\%_]/g, (char) => `\\${char}`);

  // `strapi.db.connection` returns jsonb columns as strings — parse before reading.
  const grantedConsent = (value: unknown): boolean => {
    const consent = (typeof value === 'string' ? JSON.parse(value) : value) as
      | { granted?: unknown }
      | null;
    return consent?.granted === true;
  };

  const viewOfRow = (row: Record<string, unknown>) => ({
    id: row.document_id,
    name: row.name ?? null,
    phoneMasked: maskPhone(row.phone as string | null),
    emailMasked: maskEmail(row.email as string | null),
    status: row.status,
    orderCount: Number(row.order_count ?? 0),
    totalSpent: Number(row.total_spent ?? 0),
    lastOrderAt: row.last_order_at ?? null,
    marketing: grantedConsent(row.marketing_consent),
    createdAt: row.created_at,
  });

  const service = {
    /**
     * GET /customers?q=&status=&marketing=&page= — the staff directory. A phone-shaped `q`
     * matches by HMAC (the lookup never scans raw numbers); anything else ilikes name/email.
     */
    async list(
      input: {
        q?: string;
        status?: string;
        marketing?: string;
        page?: number;
        pageSize?: number;
      },
      ctx: ServiceContext,
    ) {
      const refs = await scopedRefs(ctx);
      const page = input.page ?? 1;
      const pageSize = Math.min(input.pageSize ?? 20, 100);
      const q = (input.q ?? '').trim();

      const builder = knex()(CUSTOMER).whereNot(`${CUSTOMER}.status`, 'erased');
      if (refs !== null) builder.whereIn(`${CUSTOMER}.id`, inScopeCustomers(refs));
      if (q) {
        const phone = normalizeVietnamesePhone(q);
        if (phone.valid) {
          builder.where(`${CUSTOMER}.phone_hash`, hashing().phoneHash(phone.e164));
        } else {
          const like = `%${escapeLike(q)}%`;
          builder.where((inner) =>
            inner
              .whereRaw(`${CUSTOMER}.name ILIKE ? ESCAPE '\\'`, [like])
              .orWhereRaw(`${CUSTOMER}.email ILIKE ? ESCAPE '\\'`, [like]),
          );
        }
      }
      if (input.status === 'verified' || input.status === 'unverified') {
        builder.where(`${CUSTOMER}.status`, input.status === 'verified' ? 'active' : 'unverified');
      }
      if (input.marketing === 'yes') {
        builder.whereRaw(`${CUSTOMER}.marketing_consent->>'granted' = 'true'`);
      }

      const totalRow = (await builder
        .clone()
        .count(`${CUSTOMER}.id as count`)
        .first()) as { count: string | number } | undefined;
      const rows = (await builder
        .clone()
        .orderBy(`${CUSTOMER}.id`, 'desc')
        .offset((page - 1) * pageSize)
        .limit(pageSize)) as Array<Record<string, unknown>>;
      return { items: rows.map(viewOfRow), page, pageSize, total: Number(totalRow?.count ?? 0) };
    },

    /**
     * GET /customers/:id — the C2 profile: masked identity, stats, recent orders, the
     * address book, the consent trail, and this customer's data-request history.
     */
    async detail(documentId: string, ctx: ServiceContext) {
      const customer = await loadCustomer(documentId, ctx);
      const [orderRows, addressRows, requestRows] = await Promise.all([
        orders().findMany({
          where: { customer: customer.id },
          select: ['id', 'code', 'status', 'paymentStatus', 'totalAmount', 'placedAt', 'locationRef'],
          orderBy: { placedAt: 'desc' },
          limit: 20,
        }),
        addresses().findMany({
          where: { customer: customer.id },
          orderBy: [{ isDefault: 'desc' }, { id: 'asc' }],
        }),
        requests().findMany({
          where: { customer: customer.id },
          orderBy: { requestedAt: 'desc' },
          limit: 20,
        }),
      ]);
      const totalSpent = Number(customer.totalSpent ?? 0);
      return {
        customer: {
          id: customer.documentId,
          name: customer.name,
          status: customer.status,
          phoneMasked: maskPhone(customer.phone),
          emailMasked: maskEmail(customer.email),
          emailVerifiedAt: customer.emailVerifiedAt,
          createdAt: customer.createdAt,
          orderCount: customer.orderCount,
          totalSpent,
          averageOrder: customer.orderCount > 0 ? Math.round(totalSpent / customer.orderCount) : 0,
          lastOrderAt: customer.lastOrderAt,
          marketingConsent: customer.marketingConsent,
          staffNote: customer.staffNote,
        },
        orders: (orderRows as Array<Record<string, unknown>>).map((row) => ({
          id: row.id,
          code: row.code,
          status: row.status,
          paymentStatus: row.paymentStatus,
          total: Number(row.totalAmount ?? 0),
          placedAt: row.placedAt,
          locationRef: row.locationRef,
        })),
        addresses: (addressRows as Array<Record<string, unknown>>).map((row) => ({
          label: row.label ?? null,
          recipientName: row.recipientName ?? null,
          phoneMasked: maskPhone(row.phone as string | null),
          line1: row.line1,
          wardName: row.wardName ?? null,
          provinceName: row.provinceName ?? null,
          isDefault: row.isDefault === true,
        })),
        requests: (requestRows as Array<Record<string, unknown>>).map((row) => ({
          id: row.documentId,
          kind: row.kind,
          source: row.source,
          status: row.status,
          requestedAt: row.requestedAt,
          doneAt: row.doneAt,
          handledBy: row.handledBy,
          note: row.note,
        })),
      };
    },

    /** PUT /customers/:id — staff edits name + the internal note; the diff is masked-logged. */
    async update(
      documentId: string,
      input: { name?: unknown; staffNote?: unknown },
      ctx: ServiceContext,
    ) {
      const customer = await loadCustomer(documentId, ctx);
      if (customer.status === 'erased') {
        throw new OrderingError('CUSTOMER_NOT_FOUND', 'customer not found');
      }
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
      if (input.staffNote !== undefined) {
        const note = typeof input.staffNote === 'string' ? input.staffNote.trim() : '';
        if (note.length > 2000) {
          throw new OrderingError('VALIDATION_ERROR', 'staff note is too long', {
            details: { field: 'staffNote', max: 2000 },
          });
        }
        data.staffNote = note || null;
      }
      const row = (await customers().update({ where: { id: customer.id }, data })) as CustomerRow;
      await changeLog().record(
        {
          action: 'customer.update',
          entityType: 'customer',
          entityId: customer.id,
          before: {
            name: customer.name,
            staffNote: customer.staffNote,
          },
          after: { name: row.name, staffNote: row.staffNote },
        },
        ctx,
      );
      return service.detail(documentId, ctx);
    },

    /**
     * POST /customers/:id/reveal-phone — the deliberate, logged "Hiện số" action (C2). The
     * response carries the plaintext once; the append-only log records who looked.
     */
    async revealPhone(documentId: string, ctx: ServiceContext) {
      const customer = await loadCustomer(documentId, ctx);
      await changeLog().record(
        {
          action: 'customer.reveal-phone',
          entityType: 'customer',
          entityId: customer.id,
        },
        ctx,
      );
      return { phone: customer.phone };
    },
  };
  return service;
};

export default adminCustomers;
