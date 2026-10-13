import type { Core } from '@strapi/strapi';

import { normalizeVietnamesePhone } from '../../../shared/contact/phone';
import type { OrderingConfig } from '../config';
import { o11Hashing } from '../domain/customers/identity';
import { OrderingError } from '../domain/errors';
import type orderRepositoryFactory from '../repositories/order';
import orderRepository from '../repositories/order';
import type changeLogFactory from './change-log';
import type customerAuthFactory from './customer-auth';
import type outboxFactory from './outbox';
import type scopeFactory from './scope';
import type { ServiceContext } from './context';
import { actorRefOf, nowOf } from './context';
import { lockCustomer } from './customer-lock';

/** Orders that still move — erasure waits for them (the `data-request-waiting` job retries). */
const OPEN_STATUSES = ['open', 'draft'] as const;
const CLOSED_STATUSES = ['completed', 'canceled'] as const;
const ANONYMIZED_NAME = 'Khách đã xóa';
/** A delivery address keeps only the geo codes/names regional reports need. */
const ADDRESS_KEYS = ['wardCode', 'communeCode', 'provinceCode', 'wardName', 'provinceName'];
/**
 * Public timeline payloads are masked at write, but a defensive scrub on erasure drops any
 * contact-shaped key anyway — the ledger must never re-grow a customer field.
 */
const PII_PAYLOAD_KEYS = new Set([
  'contact',
  'address',
  'recipientName',
  'line1',
  'phone',
  'email',
  'customer',
  'customerNote',
  'note',
]);

type CustomerRow = {
  id: number;
  documentId: string;
  phone: string | null;
  phoneHash: string | null;
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

type DataRequestRow = {
  id: number;
  documentId: string;
  customer: number | { id: number; phone?: string | null } | null;
  phoneHash: string;
  kind: 'export' | 'erase';
  source: 'customer' | 'staff';
  status: 'received' | 'waiting' | 'done' | 'rejected';
  requestedAt: string;
  doneAt: string | null;
  handledBy: string | null;
  note: string | null;
  result: Record<string, unknown> | null;
};

type OrderHead = {
  id: number;
  code: string;
  status: string;
  customerRef: string | null;
  contactSnapshot: Record<string, unknown>;
  consentSnapshot: Record<string, unknown>;
  customerNote: string | null;
  receiveMethod: Record<string, unknown>;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * Personal-data requests (O11 step 6, Decree 13/2023). Export is a read-only JSON dump of one
 * profile; erasure anonymizes closed orders (the ledger keeps money/lines/branch/time) and
 * deletes the profile, addresses, carts, sessions and OTP rows once no order is still open.
 * Everything is idempotent: `process` is re-runnable, and the `data-request-waiting` job picks
 * requests whose blocking orders closed in the meantime.
 */
const dataRights = ({ strapi }: { strapi: Core.Strapi }) => {
  const requests = () => strapi.db.query('plugin::ordering.data-request');
  const customers = () => strapi.db.query('plugin::ordering.customer');
  const orders = () => strapi.db.query('plugin::ordering.order');
  const fulfillments = () => strapi.db.query('plugin::ordering.fulfillment');
  const events = () => strapi.db.query('plugin::ordering.order-event');
  const ratings = () => strapi.db.query('plugin::ordering.order-rating');
  const carts = () => strapi.db.query('plugin::ordering.cart');
  const sessions = () => strapi.db.query('plugin::ordering.customer-session');
  const otps = () => strapi.db.query('plugin::ordering.customer-otp');
  const addresses = () => strapi.db.query('plugin::ordering.customer-address');
  const config = () => strapi.config.get('plugin::ordering') as OrderingConfig;
  const hashing = () =>
    o11Hashing((config() as { encryptionKey?: string } | undefined)?.encryptionKey);
  const changeLog = () =>
    strapi.plugin('ordering').service('change-log') as ReturnType<typeof changeLogFactory>;
  const customerAuth = () =>
    strapi.plugin('ordering').service('customer-auth') as ReturnType<typeof customerAuthFactory>;
  const outbox = () =>
    strapi.plugin('ordering').service('outbox') as ReturnType<typeof outboxFactory>;
  const scope = () =>
    strapi.plugin('ordering').service('scope') as ReturnType<typeof scopeFactory>;
  const repo = () => orderRepository({ strapi }) as ReturnType<typeof orderRepositoryFactory>;

  const maskPhone = (phone: string | null | undefined): string | null =>
    typeof phone === 'string' && phone.length > 6
      ? `${phone.slice(0, 3)}****${phone.slice(-3)}`
      : null;

  /** Address → geo-only; keeps `wardCode/provinceCode` + catalog names for regional reports. */
  const reduceAddress = (address: unknown): unknown => {
    if (!isRecord(address)) return address;
    const reduced: Record<string, unknown> = {};
    for (const key of ADDRESS_KEYS) {
      if (address[key] !== undefined && address[key] !== null) reduced[key] = address[key];
    }
    return reduced;
  };

  const reduceReceiveMethod = (receiveMethod: unknown): unknown => {
    if (!isRecord(receiveMethod) || !('address' in receiveMethod)) return receiveMethod;
    return { ...receiveMethod, address: reduceAddress(receiveMethod.address) };
  };

  const scrubPublicPayload = (payload: unknown): unknown => {
    if (!isRecord(payload)) return payload;
    const clean: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(payload)) {
      if (PII_PAYLOAD_KEYS.has(key)) continue;
      clean[key] = isRecord(value) ? scrubPublicPayload(value) : value;
    }
    return clean;
  };

  const viewOfRequest = (row: DataRequestRow) => {
    const customer =
      row.customer && typeof row.customer === 'object'
        ? { documentId: (row.customer as { documentId?: string }).documentId ?? null,
            phoneMasked: maskPhone((row.customer as { phone?: string | null }).phone) }
        : null;
    return {
      id: row.documentId,
      kind: row.kind,
      source: row.source,
      status: row.status,
      requestedAt: row.requestedAt,
      doneAt: row.doneAt,
      handledBy: row.handledBy,
      note: row.note,
      result: row.result,
      customer,
    };
  };

  /** Anonymizes one closed order. Re-running writes the same values — safe under the job. */
  const anonymizeOrder = async (order: OrderHead, phoneHash: string | null) => {
    // Unlink and all dependent scrubs commit together so retries cannot miss a rating.
    await strapi.db.transaction(async () => {
      await orders().update({
        where: { id: order.id },
        data: {
          contactSnapshot: {
            name: ANONYMIZED_NAME,
            phone: null,
            ...(phoneHash ? { phoneHash } : {}),
          },
          customerNote: null,
          customerRef: null,
          receiveMethod: reduceReceiveMethod(order.receiveMethod),
          customer: null,
        },
      });
      const rows = (await fulfillments().findMany({
        where: { order: order.id },
        select: ['id', 'addressSnapshot'],
      })) as Array<{ id: number; addressSnapshot: Record<string, unknown> | null }>;
      for (const row of rows) {
        if (!row.addressSnapshot) continue;
        await fulfillments().update({
          where: { id: row.id },
          data: { addressSnapshot: reduceAddress(row.addressSnapshot) },
        });
      }
      const publicEvents = (await events().findMany({
        where: { order: order.id, isPublic: true },
        select: ['id', 'payload'],
      })) as Array<{ id: number; payload: unknown }>;
      for (const event of publicEvents) {
        const scrubbed = scrubPublicPayload(event.payload);
        if (JSON.stringify(scrubbed) !== JSON.stringify(event.payload)) {
          await events().update({ where: { id: event.id }, data: { payload: scrubbed } });
        }
      }
      // O8 rating free text can identify the customer even when the order is anonymous.
      // Keep stars/tags for reports; clear both the customer comment and internal note.
      await ratings().updateMany({
        where: { orderId: order.id },
        data: { comment: null, staffNote: null, staffNoteBy: null },
      });
      // Intentionally retain promotion-redemption.customerKey: the keyed, phone-derived
      // pseudonym preserves per-customer use limits and the discount ledger after erasure.
    });
  };

  /**
   * The erasure engine behind `POST /data-requests/:id/process`, `/me/erase` and the
   * `data-request-waiting` job. Returns the updated request; `waiting` means open orders
   * still block the final delete, closed ones are already anonymized.
   */
  const process = async (requestId: number, ctx: ServiceContext): Promise<DataRequestRow> => {
    const request = (await requests().findOne({
      where: { id: requestId },
      populate: { customer: { select: ['id', 'documentId', 'phone', 'phoneHash', 'status'] } },
    })) as DataRequestRow | null;
    if (!request) throw new OrderingError('DATA_REQUEST_NOT_FOUND', 'data request not found');
    if (request.status === 'done' || request.status === 'rejected') return request;
    const now = nowOf(ctx);
    const handledBy = request.handledBy ?? (ctx.actor.kind === 'staff' ? actorRefOf(ctx) : null);

    const linked =
      request.customer && typeof request.customer === 'object' ? request.customer.id : null;
    const customer = linked
      ? ((await customers().findOne({ where: { id: linked } })) as CustomerRow | null)
      : null;

    if (request.kind === 'export' || !customer || customer.status === 'erased') {
      // Nothing personal to erase (export requests just record consent on the ledger; the
      // payload itself is answered by `exportForStaff` — never stored on the request row).
      return (await requests().update({
        where: { id: request.id },
        data: {
          status: 'done',
          doneAt: now,
          handledBy,
          result: { ordersAnonymized: 0, alreadyErased: !customer || customer.status === 'erased' },
        },
      })) as DataRequestRow;
    }

    // Progressive anonymization: every run anonymizes the customer's closed orders, so a
    // long-waiting request still shrinks the PII surface instead of waiting for all-clear.
    // Anonymized orders unlink (`customer: null`), so prior runs' counts carry over.
    let anonymized = Number(request.result?.ordersAnonymized ?? 0);
    let cursor = 0;
    for (;;) {
      const page = (await orders().findMany({
        where: { customer: customer.id, status: { $in: [...CLOSED_STATUSES] }, id: { $gt: cursor } },
        orderBy: { id: 'asc' },
        limit: 200,
      })) as OrderHead[];
      if (page.length === 0) break;
      for (const order of page) {
        await anonymizeOrder(order, customer.phoneHash);
        anonymized += 1;
      }
      cursor = page[page.length - 1].id;
    }

    const openCount = await orders().count({
      where: { customer: customer.id, status: { $in: [...OPEN_STATUSES] } },
    });
    if (openCount > 0) {
      return (await requests().update({
        where: { id: request.id },
        data: {
          status: 'waiting',
          handledBy,
          result: { ordersWaiting: openCount, ordersAnonymized: anonymized },
        },
      })) as DataRequestRow;
    }

    // Finalize: delete everything keyed to the profile, then the profile itself goes tombstone.
    const result = await strapi.db.transaction(async ({ trx }) => {
      await lockCustomer(trx, customer);
      // Linking an order takes the same lock until order creation commits. The earlier
      // count is only a fast path; this locked count decides whether erasure can finish.
      const current = (await customers().findOne({ where: { id: customer.id } })) as CustomerRow | null;
      const pending = await orders().count({
        where: { customer: customer.id, status: { $in: [...OPEN_STATUSES] } },
      });
      if (pending > 0) {
        const done = (await requests().update({ where: { id: request.id }, data: {
          status: 'waiting', handledBy,
          result: { ordersWaiting: pending, ordersAnonymized: anonymized },
        } })) as DataRequestRow;
        return { done };
      }
      if (!current || current.status === 'erased') {
        const done = (await requests().update({ where: { id: request.id }, data: {
          status: 'done', doneAt: now, handledBy,
          result: { ordersAnonymized: anonymized, alreadyErased: true },
        } })) as DataRequestRow;
        return { done };
      }
      // Other cart mutations can already hold a cart row. Do not wait while holding
      // the customer lock: a mutation may be about to link an order to this customer.
      const ownedCarts = (await carts().findMany({
        where: { customer: customer.id }, select: ['id'],
      })) as Array<{ id: number }>;
      if (ownedCarts.length > 0) {
        const lockedCarts = await trx('plugins_ordering_cart')
          .whereIn('id', ownedCarts.map((row) => row.id)).forUpdate().skipLocked().select('id');
        if (lockedCarts.length !== ownedCarts.length) {
          const done = (await requests().update({ where: { id: request.id }, data: {
            status: 'waiting', handledBy,
            result: { ordersWaiting: 0, cartsWaiting: ownedCarts.length - lockedCarts.length, ordersAnonymized: anonymized },
          } })) as DataRequestRow;
          return { done };
        }
      }
      // A new order can also close between the progressive pass and this lock.
      // No new link can commit now, so scrub the remaining closed rows before done.
      for (;;) {
        const remaining = (await orders().findMany({
          where: { customer: customer.id, status: { $in: [...CLOSED_STATUSES] } },
          orderBy: { id: 'asc' }, limit: 200,
        })) as OrderHead[];
        if (remaining.length === 0) break;
        for (const order of remaining) {
          await anonymizeOrder(order, current.phoneHash);
          anonymized += 1;
        }
      }
      const deleted = {
        sessions: (await sessions().deleteMany({ where: { customer: customer.id } })).count ?? 0,
        otps: (await otps().deleteMany({ where: { customer: customer.id } })).count ?? 0,
        addresses: (await addresses().deleteMany({ where: { customer: customer.id } })).count ?? 0,
        carts: (await carts().deleteMany({ where: { customer: customer.id } })).count ?? 0,
        groupMembers:
          (await strapi.db.query('plugin::ordering.customer-group-member').deleteMany({
            where: { customerId: customer.id },
          })).count ?? 0,
      };
      await customers().update({
        where: { id: customer.id },
        data: {
          phone: null,
          email: null,
          emailVerifiedAt: null,
          name: null,
          status: 'erased',
          erasedAt: now,
          marketingConsent: null,
          staffNote: null,
        },
      });
      await outbox().enqueue(
        {
          type: 'customer.erased',
          aggregateType: 'customer',
          aggregateId: String(customer.id),
          // `customerHash` — the irreversible HMAC only; named so maskPayload keeps it (a
          // `phone*` key would be redacted, defeating the forget-me signal downstream).
          payload: { customerId: customer.id, customerHash: customer.phoneHash ?? null },
          uniqueKey: `customer.erased:${customer.id}`,
        },
        ctx,
      );
      const done = (await requests().update({
        where: { id: request.id },
        data: {
          status: 'done',
          doneAt: now,
          handledBy,
          result: { ordersAnonymized: anonymized, deleted },
        },
      })) as DataRequestRow;
      return { done, deleted };
    });
    if (result.done.status === 'waiting') return result.done;
    if (ctx.actor.kind === 'staff') {
      await changeLog().record(
        {
          action: 'data-request.process',
          entityType: 'data-request',
          entityId: request.id,
          after: { status: 'done', ordersAnonymized: anonymized },
        },
        ctx,
      );
    }
    return result.done;
  };

  /** `locationRefs` limits the orders (staff export by a branch-scoped caller); null = all. */
  const exportForCustomer = async (customer: CustomerRow, locationRefs: string[] | null = null) => {
    const addressRows = (await addresses().findMany({
      where: { customer: customer.id },
      orderBy: { id: 'asc' },
    })) as Array<Record<string, unknown>>;
    const orderRows = (await orders().findMany({
      where: { customer: customer.id, ...(locationRefs === null ? {} : { locationRef: { $in: locationRefs } }) },
      orderBy: { placedAt: 'asc' },
    })) as OrderHead[];
    const exported = [];
    for (const row of orderRows) {
      const aggregate = await repo().loadOrderAggregate(row.id);
      if (!aggregate) continue;
      const { order, lines } = aggregate;
      const consent = { ...(order.consentSnapshot ?? {}) } as Record<string, unknown>;
      delete consent.actorRef; // staff reference — someone else's data
      exported.push({
        code: order.code,
        status: order.status,
        paymentStatus: order.paymentStatus,
        fulfillmentStatus: order.fulfillmentStatus,
        totals: {
          subtotal: order.subtotalAmount,
          adjustment: order.adjustmentAmount,
          fulfillment: order.fulfillmentAmount,
          tax: order.taxAmount,
          total: order.totalAmount,
          currency: order.currency,
        },
        placedAt: order.placedAt,
        businessDate: order.businessDate,
        locationRef: order.locationRef,
        branchName: (order.branchSnapshot as { name?: unknown } | null)?.name ?? null,
        receiveMethod: order.receiveMethod,
        contact: order.contactSnapshot,
        customerNote: order.customerNote,
        consent,
        lines: lines.map((line) => ({
          title: line.titleSnapshot,
          sellableUid: line.sellableUid,
          variantUid: line.variantUid,
          options: line.selectedOptionsSnapshot ?? [],
          quantity: line.quantity,
          canceledQuantity: line.canceledQuantity,
          unitAmount: line.unitAmount,
          lineTotalAmount: line.lineTotalAmount,
          note: line.note,
        })),
      });
    }
    return {
      generatedAt: new Date().toISOString(),
      profile: {
        phone: customer.phone,
        email: customer.email,
        emailVerifiedAt: customer.emailVerifiedAt,
        name: customer.name,
        status: customer.status,
        marketingConsent: customer.marketingConsent,
        orderCount: customer.orderCount,
        totalSpent: customer.totalSpent,
        lastOrderAt: customer.lastOrderAt,
        createdAt: customer.createdAt,
      },
      addresses: addressRows.map((row) => ({
        label: row.label ?? null,
        recipientName: row.recipientName,
        phone: row.phone,
        line1: row.line1,
        wardCode: row.wardCode,
        wardName: row.wardName ?? null,
        provinceCode: row.provinceCode ?? null,
        provinceName: row.provinceName ?? null,
        isDefault: row.isDefault === true,
      })),
      orders: exported,
    };
  };

  const loadCustomer = async (customerId: number): Promise<CustomerRow> => {
    const customer = (await customers().findOne({
      where: { id: customerId },
    })) as CustomerRow | null;
    if (!customer) throw new OrderingError('CUSTOMER_NOT_FOUND', 'customer not found');
    return customer;
  };

  /**
   * Scoped visibility shared by staff customer lookups: a customer is visible only through
   * an order at a scoped branch — hidden customers answer 404, never confirming they exist.
   */
  const assertCustomerInScope = async (customer: CustomerRow, ctx: ServiceContext) => {
    const staffScope = await scope().loadScope(ctx);
    if (staffScope && !staffScope.allLocations) {
      const inScope = (await orders().findOne({
        where: {
          customer: customer.id,
          locationRef: { $in: staffScope.locationRefs },
        },
        select: ['id'],
      })) as { id: number } | null;
      if (!inScope) throw new OrderingError('CUSTOMER_NOT_FOUND', 'customer not found');
    }
    if (staffScope === null && ctx.actor.kind === 'staff') {
      throw new OrderingError('CUSTOMER_NOT_FOUND', 'customer not found');
    }
  };

  // A request without a currently visible customer is available only to all-location
  // staff. This also fails closed after erasure has detached the customer's orders.
  const requestScopeWhere = async (ctx: ServiceContext): Promise<Record<string, unknown>> => {
    const staffScope = await scope().loadScope(ctx);
    if (!staffScope) throw new OrderingError('SCOPE_REQUIRED', 'staff member has no location scope');
    if (staffScope.allLocations) return {};
    return { customer: { orders: { locationRef: { $in: staffScope.locationRefs } } } };
  };

  return {
    /** GET /me/data-export — the session's own profile + addresses + orders, staff refs out. */
    async exportForSelf(customerId: number) {
      return exportForCustomer(await loadCustomer(customerId));
    },

    /**
     * POST /me/erase {confirm:true}: records the request, revokes every session immediately
     * (the response is the last thing that token authenticates), then tries to erase at
     * once — open orders push it to `waiting` for the job to finish.
     */
    async requestSelfErase(customerId: number, ctx: ServiceContext) {
      const customer = await loadCustomer(customerId);
      if (customer.status === 'erased') {
        throw new OrderingError('VALIDATION_ERROR', 'customer is already erased');
      }
      const now = nowOf(ctx);
      const request = (await requests().create({
        data: {
          customer: customer.id,
          // Email-only profiles have no phoneHash — a deterministic id-derived key keeps the
          // ledger row searchable for this customer without inventing a phone.
          phoneHash: customer.phoneHash ?? hashing().phoneHash(`id:${customer.id}`),
          kind: 'erase',
          source: 'customer',
          status: 'received',
          requestedAt: now,
        },
      })) as DataRequestRow;
      await customerAuth().revokeAllSessions(customerId, ctx);
      const processed = await process(request.id as number, ctx);
      const row = (await requests().findOne({
        where: { id: processed.id },
        populate: { customer: { select: ['id', 'documentId', 'phone'] } },
      })) as DataRequestRow;
      return viewOfRequest(row);
    },

    /**
     * GET /customers/:id/export (staff, `customer.manage`): the same payload the customer
     * sees. Scoped — `assertCustomerInScope` below.
     */
    async exportForStaff(documentId: string, ctx: ServiceContext) {
      const customer = (await customers().findOne({
        where: { documentId },
      })) as CustomerRow | null;
      if (!customer) throw new OrderingError('CUSTOMER_NOT_FOUND', 'customer not found');
      await assertCustomerInScope(customer, ctx);
      const staffScope = await scope().loadScope(ctx);
      const data = await exportForCustomer(
        customer,
        staffScope && !staffScope.allLocations ? [...staffScope.locationRefs] : null,
      );
      await changeLog().record(
        {
          action: 'customer.export',
          entityType: 'customer',
          entityId: customer.id,
        },
        ctx,
      );
      return data;
    },

    /** GET /data-requests — the staff work queue, filterable by status. */
    async listRequests(
      input: { status?: string; page?: number; pageSize?: number },
      ctx: ServiceContext,
    ) {
      const where = await requestScopeWhere(ctx);
      if (input.status && ['received', 'waiting', 'done', 'rejected'].includes(input.status)) {
        where.status = input.status;
      }
      const page = input.page ?? 1;
      const pageSize = Math.min(input.pageSize ?? 20, 100);
      const [rows, total] = await Promise.all([
        requests().findMany({
          where,
          populate: { customer: { select: ['id', 'documentId', 'phone'] } },
          orderBy: { requestedAt: 'desc' },
          offset: (page - 1) * pageSize,
          limit: pageSize,
        }) as Promise<DataRequestRow[]>,
        requests().count({ where }),
      ]);
      return {
        items: rows.map(viewOfRequest),
        page,
        pageSize,
        total,
        deadlineHours: config().dataRights.deadlineHours,
      };
    },

    /**
     * POST /data-requests {phone | customerId, kind, note} — staff creates a request on the
     * customer's behalf. `customerId` serves C2's button where the phone stays masked; the
     * phone never persists either way — `phoneHash` links the ledger row to the profile.
     */
    async createStaffRequest(
      input: { phone?: unknown; customerId?: unknown; kind?: unknown; note?: unknown },
      ctx: ServiceContext,
    ) {
      if (input.kind !== 'export' && input.kind !== 'erase') {
        throw new OrderingError('VALIDATION_ERROR', 'kind must be export or erase', {
          details: { field: 'kind' },
        });
      }
      const kind = input.kind;
      const byCustomer = typeof input.customerId === 'string' && input.customerId.trim() !== '';
      let phoneHash: string;
      let customer: { id: number } | null = null;
      if (byCustomer) {
        const row = (await customers().findOne({
          where: { documentId: String(input.customerId).trim(), status: { $ne: 'erased' } },
          select: ['id', 'phoneHash'],
        })) as { id: number; phoneHash: string | null } | null;
        if (!row) throw new OrderingError('CUSTOMER_NOT_FOUND', 'customer not found');
        await assertCustomerInScope(row as CustomerRow, ctx);
        customer = row;
        // Email-only profiles carry no phoneHash — same id-derived stand-in as /me/erase.
        phoneHash = row.phoneHash ?? hashing().phoneHash(`id:${row.id}`);
      } else {
        const normalized = normalizeVietnamesePhone(
          typeof input.phone === 'string' ? input.phone : '',
        );
        if (!normalized.valid) {
          throw new OrderingError('VALIDATION_ERROR', 'a Vietnamese phone number is required', {
            details: { field: 'phone' },
          });
        }
        phoneHash = hashing().phoneHash(normalized.e164);
        customer = (await customers().findOne({
          where: { phoneHash, status: { $ne: 'erased' } },
          select: ['id'],
        })) as { id: number } | null;
        if (customer) {
          await assertCustomerInScope(customer as CustomerRow, ctx);
        } else {
          const staffScope = await scope().loadScope(ctx);
          if (!staffScope?.allLocations) {
            throw new OrderingError('CUSTOMER_NOT_FOUND', 'customer not found');
          }
        }
      }
      const request = (await requests().create({
        data: {
          ...(customer ? { customer: customer.id } : {}),
          phoneHash,
          kind,
          source: 'staff',
          status: 'received',
          requestedAt: nowOf(ctx),
          handledBy: actorRefOf(ctx),
          note: typeof input.note === 'string' && input.note.trim() !== '' ? input.note.trim() : null,
        },
      })) as DataRequestRow;
      await changeLog().record(
        {
          action: 'data-request.create',
          entityType: 'data-request',
          entityId: request.id,
          after: { kind },
        },
        ctx,
      );
      const processed = await process(request.id as number, ctx);
      const row = (await requests().findOne({
        where: { id: processed.id },
        populate: { customer: { select: ['id', 'documentId', 'phone'] } },
      })) as DataRequestRow;
      return viewOfRequest(row);
    },

    /** POST /data-requests/:id/process — manual trigger; the job covers it anyway. */
    async processByStaff(documentId: string, ctx: ServiceContext) {
      const target = (await requests().findOne({
        where: { documentId, ...(await requestScopeWhere(ctx)) },
        select: ['id'],
      })) as { id: number } | null;
      if (!target) throw new OrderingError('DATA_REQUEST_NOT_FOUND', 'data request not found');
      const processed = await process(target.id, ctx);
      const row = (await requests().findOne({
        where: { id: processed.id },
        populate: { customer: { select: ['id', 'documentId', 'phone'] } },
      })) as DataRequestRow;
      if (ctx.actor.kind === 'staff' && processed.status === 'waiting') {
        await changeLog().record(
          {
            action: 'data-request.process',
            entityType: 'data-request',
            entityId: processed.id,
            after: { status: 'waiting' },
          },
          ctx,
        );
      }
      return viewOfRequest(row);
    },

    /** POST /data-requests/:id/reject {reason} — e.g. a statutory retention duty. */
    async rejectRequest(documentId: string, input: { reason?: unknown }, ctx: ServiceContext) {
      const request = (await requests().findOne({
        where: { documentId, ...(await requestScopeWhere(ctx)) },
        populate: { customer: { select: ['id', 'documentId', 'phone'] } },
      })) as DataRequestRow | null;
      if (!request) throw new OrderingError('DATA_REQUEST_NOT_FOUND', 'data request not found');
      if (request.status === 'done' || request.status === 'rejected') {
        throw new OrderingError('VALIDATION_ERROR', 'request is already closed', {
          details: { status: request.status },
        });
      }
      const reason = typeof input.reason === 'string' ? input.reason.trim() : '';
      if (reason === '') {
        throw new OrderingError('VALIDATION_ERROR', 'a reason is required', {
          details: { field: 'reason' },
        });
      }
      const updated = (await requests().update({
        where: { id: request.id },
        data: {
          status: 'rejected',
          doneAt: nowOf(ctx),
          handledBy: actorRefOf(ctx),
          note: reason,
        },
      })) as DataRequestRow;
      await changeLog().record(
        {
          action: 'data-request.reject',
          entityType: 'data-request',
          entityId: request.id,
          after: { status: 'rejected' },
        },
        ctx,
      );
      return viewOfRequest({ ...updated, customer: request.customer });
    },

    /**
     * `data-request-waiting` job body: re-runs every `waiting` request (plus a `received`
     * row a crashed write may have left behind). A failed request is logged and skipped —
     * it retries next run instead of blocking the queue.
     */
    async processWaiting(now: Date): Promise<{ done: number; waiting: number; failed: number }> {
      const due = (await requests().findMany({
        where: {
          status: { $in: ['received', 'waiting'] },
          requestedAt: { $lte: now },
          kind: 'erase',
        },
        select: ['id'],
        orderBy: { requestedAt: 'asc' },
        limit: 200,
      })) as Array<{ id: number }>;
      let done = 0;
      let waiting = 0;
      let failed = 0;
      const ctx: ServiceContext = { actor: { kind: 'system' }, now };
      for (const row of due) {
        try {
          const processed = await process(row.id, ctx);
          if (processed.status === 'done') done += 1;
          else if (processed.status === 'waiting') waiting += 1;
        } catch (error) {
          failed += 1;
          strapi.log.error(`[ordering] data-request ${row.id} failed to process`, {
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
      return { done, waiting, failed };
    },
  };
};

export default dataRights;
