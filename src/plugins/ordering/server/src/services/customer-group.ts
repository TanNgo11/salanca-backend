import type { Core } from '@strapi/strapi';

import { maskPhone, normalizeVietnamesePhone } from '../../../shared/contact/phone';
import { parseCustomerGroupInput, parseMembersInput, type CustomerGroupInput } from '../domain/catalog/price-list-input';
import { o11Hashing } from '../domain/customers/identity';
import { OrderingError } from '../domain/errors';
import type { OrderingConfig } from '../config';
import type { ServiceContext } from './context';
import type changeLogFactory from './change-log';

const GROUP = 'plugin::ordering.customer-group';
const MEMBER = 'plugin::ordering.customer-group-member';
const CUSTOMER = 'plugin::ordering.customer';
const ORDER_LINK = 'plugins_ordering_order_customer_lnk';
const ORDER = 'plugins_ordering_order';
const BATCH = 200;

type GroupRow = {
  id: number;
  documentId: string;
  code: string;
  name: { vi?: string; en?: string } | null;
  auto: CustomerGroupInput['auto'] | null;
  active: boolean;
};

type MemberRow = {
  id: number;
  customerId: number;
  customerDocumentId: string;
  groupDocumentId: string;
  source: 'manual' | 'auto';
};

type AutoRule = { minTotalSpent?: number; minOrderCount?: number; sinceDays?: number };

const parseJson = <T>(value: unknown, fallback: T): T => {
  if (typeof value === 'string') {
    try {
      return JSON.parse(value) as T;
    } catch {
      return fallback;
    }
  }
  return (value ?? fallback) as T;
};

const customerGroup = ({ strapi }: { strapi: Core.Strapi }) => {
  const groups = () => strapi.db.query(GROUP);
  const members = () => strapi.db.query(MEMBER);
  const customers = () => strapi.db.query(CUSTOMER);
  const changeLog = () => strapi.plugin('ordering').service('change-log') as ReturnType<typeof changeLogFactory>;
  const hashing = () => o11Hashing((strapi.config.get('plugin::ordering') as OrderingConfig).encryptionKey);

  const load = async (id: number): Promise<GroupRow> => {
    const row = (await groups().findOne({ where: { id } })) as GroupRow | null;
    if (!row) throw new OrderingError('CUSTOMER_GROUP_NOT_FOUND', 'customer group not found');
    return { ...row, name: parseJson(row.name, {}), auto: parseJson(row.auto, null) };
  };

  const counts = async (): Promise<Map<string, number>> => {
    const { rows } = await strapi.db.connection.raw(
      `SELECT group_document_id, COUNT(*)::int AS n
       FROM plugins_ordering_customer_group_member
       GROUP BY group_document_id`,
    );
    return new Map((rows as Array<{ group_document_id: string; n: number }>).map((row) => [row.group_document_id, Number(row.n)]));
  };

  const view = (row: GroupRow, memberCount = 0) => ({
    id: row.id,
    code: row.code,
    name: row.name ?? { vi: '' },
    auto: row.auto,
    active: row.active !== false,
    memberCount,
  });

  const assertCodeFree = async (code: string, exceptId?: number) => {
    const { rows } = await strapi.db.connection.raw(
      `SELECT id FROM plugins_ordering_customer_group WHERE upper(code) = upper(?)`,
      [code],
    );
    const clash = (rows as Array<{ id: number }>).find((row) => row.id !== exceptId);
    if (clash) {
      throw new OrderingError('VALIDATION_ERROR', 'customer group code is already used', {
        details: { issues: [{ path: 'code', message: 'already used' }] },
      });
    }
  };

  const mask = (phone: string | null | undefined): string | null => {
    if (!phone) return null;
    const national = normalizeVietnamesePhone(phone);
    return national.valid ? maskPhone(national.national) : null;
  };

  const memberViews = async (group: GroupRow) => {
    const rows = (await members().findMany({
      where: { groupDocumentId: group.documentId },
      orderBy: { id: 'asc' },
      limit: 100,
    })) as MemberRow[];
    if (rows.length === 0) return [];
    const people = (await customers().findMany({
      where: { id: { $in: rows.map((row) => row.customerId) } },
      select: ['id', 'documentId', 'name', 'phone', 'status'],
    })) as Array<{ id: number; documentId: string; name: string | null; phone: string | null; status: string }>;
    const byId = new Map(people.map((person) => [person.id, person]));
    return rows
      .filter((row) => byId.get(row.customerId)?.status !== 'erased')
      .map((row) => {
        const person = byId.get(row.customerId);
        return {
          customerId: person?.documentId ?? row.customerDocumentId,
          name: person?.name ?? null,
          phoneMasked: mask(person?.phone),
          source: row.source,
        };
      });
  };

  return {
    async codesForCustomer(customerId: number): Promise<string[]> {
      const customer = (await customers().findOne({
        where: { id: customerId },
        select: ['id', 'status'],
      })) as { id: number; status: string } | null;
      if (!customer || customer.status === 'erased') return [];
      const rows = (await members().findMany({
        where: { customerId },
        select: ['groupDocumentId'],
      })) as Array<{ groupDocumentId: string }>;
      if (rows.length === 0) return [];
      const found = (await groups().findMany({
        where: { documentId: { $in: rows.map((row) => row.groupDocumentId) }, active: true },
        select: ['code'],
      })) as Array<{ code: string }>;
      return found.map((row) => row.code);
    },

    /**
     * Groups that may change a price. A storefront caller must already be signed in
     * (`customerId` from the session). A staff draft may name the profile attached by phone,
     * because the caller is an admin. A guest phone never selects a group.
     */
    async codesForPricing(input: {
      customerId?: number | null;
      originKind?: string | null;
      phone?: string | null;
    }): Promise<string[]> {
      if (input.customerId) return this.codesForCustomer(input.customerId);
      if (input.originKind !== 'staff-draft' || !input.phone) return [];
      const normalized = normalizeVietnamesePhone(input.phone);
      if (!normalized.valid) return [];
      const customer = (await customers().findOne({
        where: { phoneHash: hashing().phoneHash(normalized.e164), status: { $ne: 'erased' } },
        select: ['id'],
      })) as { id: number } | null;
      if (!customer) return [];
      return this.codesForCustomer(customer.id);
    },

    async list() {
      const [rows, memberCounts] = await Promise.all([
        groups().findMany({ orderBy: { code: 'asc' } }) as Promise<GroupRow[]>,
        counts(),
      ]);
      return {
        items: rows.map((row) =>
          view(
            { ...row, name: parseJson(row.name, {}), auto: parseJson(row.auto, null) },
            memberCounts.get(row.documentId) ?? 0,
          ),
        ),
      };
    },

    async get(id: number) {
      const row = await load(id);
      const memberCounts = await counts();
      return {
        item: view(row, memberCounts.get(row.documentId) ?? 0),
        members: await memberViews(row),
      };
    },

    async create(raw: unknown, ctx: ServiceContext) {
      const input = parseCustomerGroupInput(raw);
      await assertCodeFree(input.code);
      const created = (await groups().create({
        data: { code: input.code, name: input.name, auto: input.auto ?? null, active: input.active },
      })) as GroupRow;
      await changeLog().record(
        {
          action: 'customer-group.create',
          entityType: 'customer-group',
          entityId: created.id,
          entityLabel: input.code,
          after: { active: input.active, automatic: input.auto != null },
        },
        ctx,
      );
      return this.get(created.id);
    },

    async update(id: number, raw: unknown, ctx: ServiceContext) {
      const before = await load(id);
      const input = parseCustomerGroupInput({ ...(raw as object), code: before.code });
      if (input.code !== before.code) {
        throw new OrderingError('VALIDATION_ERROR', 'customer group code cannot change', {
          details: { issues: [{ path: 'code', message: 'immutable' }] },
        });
      }
      await groups().update({
        where: { id },
        data: { name: input.name, auto: input.auto ?? null, active: input.active },
      });
      await changeLog().record(
        {
          action: 'customer-group.update',
          entityType: 'customer-group',
          entityId: id,
          entityLabel: before.code,
          before: { active: before.active, automatic: before.auto != null },
          after: { active: input.active, automatic: input.auto != null },
        },
        ctx,
      );
      return this.get(id);
    },

    async setMembers(id: number, raw: unknown, ctx: ServiceContext) {
      const group = await load(id);
      const input = parseMembersInput(raw);
      let added = 0;
      let removed = 0;
      if (input.add.length > 0) {
        const people = (await customers().findMany({
          where: { documentId: { $in: input.add }, status: { $ne: 'erased' } },
          select: ['id', 'documentId'],
        })) as Array<{ id: number; documentId: string }>;
        for (const person of people) {
          const existing = (await members().findOne({
            where: { customerId: person.id, groupDocumentId: group.documentId },
            select: ['id'],
          })) as { id: number } | null;
          if (existing) continue;
          await members().create({
            data: {
              customerId: person.id,
              customerDocumentId: person.documentId,
              groupDocumentId: group.documentId,
              source: 'manual',
            },
          });
          added += 1;
        }
      }
      if (input.remove.length > 0) {
        const people = (await customers().findMany({
          where: { documentId: { $in: input.remove } },
          select: ['id'],
        })) as Array<{ id: number }>;
        if (people.length > 0) {
          const result = await members().deleteMany({
            where: { groupDocumentId: group.documentId, customerId: { $in: people.map((person) => person.id) } },
          });
          removed = result.count ?? 0;
        }
      }
      await changeLog().record(
        {
          action: 'customer-group.members',
          entityType: 'customer-group',
          entityId: id,
          entityLabel: group.code,
          after: { added, removed },
        },
        ctx,
      );
      return { ...(await this.get(id)), added, removed };
    },

    /** Masked customer search for the member picker. The query itself is not logged. */
    async search(q: string) {
      const query = q.trim();
      if (!query) return { items: [] as Array<{ id: string; name: string | null; phoneMasked: string | null }> };
      const phone = normalizeVietnamesePhone(query);
      const builder = strapi.db.connection('plugins_ordering_customer').whereNot('status', 'erased');
      if (phone.valid) builder.where('phone_hash', hashing().phoneHash(phone.e164));
      else builder.whereRaw(`name ILIKE ? ESCAPE '\\'`, [`%${query.replace(/[\\%_]/g, (char) => `\\${char}`)}%`]);
      const rows = (await builder.clone().limit(10).select('document_id', 'name', 'phone')) as Array<{
        document_id: string;
        name: string | null;
        phone: string | null;
      }>;
      return {
        items: rows.map((row) => ({
          id: row.document_id,
          name: row.name,
          phoneMasked: mask(row.phone),
        })),
      };
    },

    /**
     * Daily membership refresh. One batch of customers at a time; order totals for a
     * `sinceDays` window are aggregated for that batch only. Erased customers are removed
     * and never inserted. Manual members are left in place.
     */
    async refreshAuto(now = new Date()): Promise<{ groups: number; added: number; removed: number }> {
      await strapi.db.connection.raw(
        `DELETE FROM plugins_ordering_customer_group_member m
         USING plugins_ordering_customer c
         WHERE m.customer_id = c.id AND c.status = 'erased'`,
      );
      const automatic = ((await groups().findMany({ where: { active: true } })) as GroupRow[])
        .map((row) => ({ ...row, auto: parseJson<AutoRule | null>(row.auto, null) }))
        .filter((row) => row.auto && (row.auto.minOrderCount !== undefined || row.auto.minTotalSpent !== undefined || row.auto.sinceDays !== undefined));
      let added = 0;
      let removed = 0;
      for (const group of automatic) {
        const rule = group.auto as AutoRule;
        let afterId = 0;
        for (;;) {
          const batch = (await customers().findMany({
            where: { id: { $gt: afterId }, status: { $ne: 'erased' } },
            orderBy: { id: 'asc' },
            limit: BATCH,
            select: ['id', 'documentId', 'orderCount', 'totalSpent'],
          })) as Array<{ id: number; documentId: string; orderCount: number; totalSpent: string | number }>;
          if (batch.length === 0) break;
          afterId = batch[batch.length - 1].id;
          const stats = new Map<number, { count: number; spent: number }>();
          if (rule.sinceDays) {
            const since = new Date(now.getTime() - rule.sinceDays * 86_400_000);
            const { rows } = await strapi.db.connection.raw(
              `SELECT l.customer_id,
                      COUNT(*)::int AS order_count,
                      COALESCE(SUM(GREATEST(0, o.total_amount - COALESCE(o.canceled_amount, 0))), 0)::bigint AS spent
               FROM ${ORDER_LINK} l
               JOIN ${ORDER} o ON o.id = l.order_id
               WHERE l.customer_id = ANY(?)
                 AND o.status = 'completed'
                 AND o.completed_at >= ?
               GROUP BY l.customer_id`,
              [batch.map((person) => person.id), since],
            );
            for (const row of rows as Array<{ customer_id: number; order_count: number; spent: string | number }>) {
              stats.set(Number(row.customer_id), { count: Number(row.order_count), spent: Number(row.spent) });
            }
          }
          const existing = (await members().findMany({
            where: { groupDocumentId: group.documentId, customerId: { $in: batch.map((person) => person.id) } },
          })) as MemberRow[];
          const byCustomer = new Map(existing.map((row) => [row.customerId, row]));
          for (const person of batch) {
            const window = stats.get(person.id) ?? { count: 0, spent: 0 };
            const count = rule.sinceDays ? window.count : Number(person.orderCount ?? 0);
            const spent = rule.sinceDays ? window.spent : Number(person.totalSpent ?? 0);
            // A rule with only `sinceDays` means "ordered within N days": at least one order, never
            // everyone (an empty threshold would otherwise admit customers who never ordered).
            const minCount =
              rule.minOrderCount ?? (rule.minTotalSpent === undefined ? 1 : undefined);
            const qualifies =
              (minCount === undefined || count >= minCount) &&
              (rule.minTotalSpent === undefined || spent >= rule.minTotalSpent);
            const member = byCustomer.get(person.id);
            if (qualifies && !member) {
              await members().create({
                data: {
                  customerId: person.id,
                  customerDocumentId: person.documentId,
                  groupDocumentId: group.documentId,
                  source: 'auto',
                },
              });
              added += 1;
            } else if (!qualifies && member?.source === 'auto') {
              await members().delete({ where: { id: member.id } });
              removed += 1;
            }
          }
        }
      }
      return { groups: automatic.length, added, removed };
    },
  };
};

export default customerGroup;
