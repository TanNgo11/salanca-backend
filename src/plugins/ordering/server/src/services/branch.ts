import type { Core } from '@strapi/strapi';

import type { OrderingConfig } from '../config';
import {
  resolveDeliverySettings,
  resolvePickupSettings,
  validateBranchInput,
  type DeliverySettings,
  type PickupSettings,
} from '../domain/branch-settings';
import { deliveryQuoteInputSchema, quoteDelivery } from '../domain/delivery/zones';
import { OrderingError } from '../domain/errors';
import { scopeIncludes } from '../domain/scope';
import { isOnlinePaymentProvider } from '../providers/cash';
import type adminUnitsFactory from './admin-units';
import type changeLogFactory from './change-log';
import type { ServiceContext } from './context';
import type { OrderingRegistry } from './registry';
import type scopeFactory from './scope';

export type BranchRow = {
  id: number;
  code: string;
  name: Record<string, string> | null;
  address: Record<string, unknown> | null;
  phone: string | null;
  email: string | null;
  timezone: string;
  isActive: boolean;
  onlineOrdering: boolean;
  rank: number;
  fulfillment: Record<string, unknown> | null;
  tax: Record<string, unknown> | null;
  cashRounding: { enabled: boolean; multiple: number; providerCodes: string[] } | null;
};

/** Keys the client actually sent. Zod prefills omitted pickup/delivery, which must not overwrite storage. */
const requestedFulfillment = (raw: unknown): Record<string, unknown> | null => {
  if (typeof raw !== 'object' || raw === null || !('fulfillment' in raw)) return null;
  const fulfillment = (raw as { fulfillment?: unknown }).fulfillment;
  if (typeof fulfillment !== 'object' || fulfillment === null) return null;
  return fulfillment as Record<string, unknown>;
};

const BRANCH_FIELDS = [
  'code',
  'name',
  'address',
  'phone',
  'email',
  'timezone',
  'isActive',
  'onlineOrdering',
  'rank',
  'cashRounding',
] as const;

/**
 * Branch administration and settings (contracts §19.6, §21.1; screens S7). `code` is the stable
 * external ref (orders pin it via locationRef), so it is immutable once the branch exists — the
 * same rule is enforced for the Document Service path by a middleware in register.ts. Staff only
 * see branches inside their location scope; creating a branch needs an all-locations scope.
 * Every write appends an admin-change-log row. Settings changes apply to new orders only.
 */
const branch = ({ strapi }: { strapi: Core.Strapi }) => {
  const branches = () => strapi.db.query('plugin::ordering.branch');
  const changeLog = () =>
    strapi.plugin('ordering').service('change-log') as ReturnType<typeof changeLogFactory>;
  const scope = () => strapi.plugin('ordering').service('scope') as ReturnType<typeof scopeFactory>;
  const registry = () => strapi.plugin('ordering').service('registry') as OrderingRegistry;
  const config = () => strapi.config.get('plugin::ordering') as OrderingConfig;
  const units = () => strapi.plugin('ordering').service('admin-units') as ReturnType<typeof adminUnitsFactory>;

  /** Registered payment providers the config does not explicitly disable. */
  const enabledPaymentProviders = (): { known: string[]; online: string[] } => {
    const settings = config().providers.payment;
    const known = registry()
      .paymentProviderCodes()
      .filter((code) => settings[code]?.enabled !== false);
    return {
      known,
      online: known.filter((code) => isOnlinePaymentProvider(registry().paymentProvider(code))),
    };
  };

  const notFound = (code: string) =>
    new OrderingError('BRANCH_NOT_FOUND', 'branch not found', { details: { code } });

  const toAdmin = (row: BranchRow) => ({
    id: row.id,
    code: row.code,
    name: row.name ?? {},
    address: row.address ?? null,
    phone: row.phone ?? null,
    email: row.email ?? null,
    timezone: row.timezone,
    isActive: row.isActive,
    onlineOrdering: row.onlineOrdering,
    rank: row.rank ?? 0,
    cashRounding: row.cashRounding ?? null,
    fulfillment: {
      ...(row.fulfillment ?? {}),
      pickup: resolvePickupSettings(row.fulfillment?.pickup),
      delivery: resolveDeliverySettings(row.fulfillment?.delivery),
    },
  });

  /** Commune codes the loaded catalog accepts. A missing catalog blocks enabling delivery. */
  const catalogGate = () => {
    const resolved = units().load();
    if (!resolved.available) return { catalogAvailable: false as const };
    return {
      catalogAvailable: true as const,
      knownCommuneCodes: new Set(resolved.catalog.communes.map((commune) => commune.code)),
    };
  };

  const assertValid = (
    raw: unknown,
    mode: 'create' | 'update',
  ): NonNullable<ReturnType<typeof validateBranchInput> & { valid: true }>['value'] => {
    const providers = enabledPaymentProviders();
    const result = validateBranchInput(raw, {
      mode,
      knownProviders: providers.known,
      onlineProviders: providers.online,
      ...catalogGate(),
    });
    if (!result.valid) {
      throw new OrderingError('VALIDATION_ERROR', 'branch settings are invalid', {
        details: { issues: result.issues },
      });
    }
    return result.value;
  };

  const service = {
    enabledPaymentProviders,

    async findByCode(code: string): Promise<BranchRow | null> {
      return (await branches().findOne({ where: { code } })) as BranchRow | null;
    },

    async list(): Promise<BranchRow[]> {
      return (await branches().findMany({ orderBy: [{ rank: 'asc' }, { code: 'asc' }] })) as BranchRow[];
    },

    /** Resolved pickup settings for a branch row (defaults applied). */
    pickupSettings(row: Pick<BranchRow, 'fulfillment'>): PickupSettings {
      return resolvePickupSettings(row.fulfillment?.pickup);
    },

    /** Resolved delivery settings for a branch row (defaults applied). */
    deliverySettings(row: Pick<BranchRow, 'fulfillment'>): DeliverySettings {
      return resolveDeliverySettings(row.fulfillment?.delivery);
    },

    /** Admin list: only branches inside the staff scope (system actors see all). */
    async listForAdmin(ctx: ServiceContext) {
      const staffScope = await scope().loadScope(ctx);
      if (staffScope === null) {
        throw new OrderingError('SCOPE_REQUIRED', 'staff member has no location scope');
      }
      const rows = await service.list();
      return rows.filter((row) => scopeIncludes(staffScope, row.code)).map(toAdmin);
    },

    async getForAdmin(code: string, ctx: ServiceContext) {
      const row = await service.findByCode(code);
      if (!row || !scopeIncludes(await scope().loadScope(ctx), row.code)) throw notFound(code);
      return toAdmin(row);
    },

    async createBranch(raw: unknown, ctx: ServiceContext) {
      const staffScope = await scope().loadScope(ctx);
      if (!staffScope?.allLocations) {
        throw new OrderingError('SCOPE_REQUIRED', 'creating a branch needs an all-locations scope');
      }
      const value = assertValid(raw, 'create');
      if (await service.findByCode(value.code as string)) {
        throw new OrderingError('VALIDATION_ERROR', 'branch settings are invalid', {
          details: { issues: [{ path: 'code', message: 'code is already used' }] },
        });
      }
      const data: Record<string, unknown> = {
        timezone: 'Asia/Ho_Chi_Minh',
        isActive: true,
        onlineOrdering: false,
        rank: 0,
      };
      for (const field of BRANCH_FIELDS) {
        if (value[field] !== undefined) data[field] = value[field];
      }
      data.fulfillment = {
        ...(value.fulfillment ?? {}),
        pickup: resolvePickupSettings(value.fulfillment?.pickup),
      };
      const row = (await branches().create({ data })) as BranchRow;
      await changeLog().record(
        {
          action: 'branch.create',
          entityType: 'branch',
          entityId: row.id,
          locationRef: row.code,
          after: data,
        },
        ctx,
      );
      return toAdmin(row);
    },

    async updateBranch(code: string, raw: unknown, ctx: ServiceContext) {
      const current = await service.findByCode(code);
      if (!current || !scopeIncludes(await scope().loadScope(ctx), current.code)) {
        throw notFound(code);
      }
      const value = assertValid(raw, 'update');
      if (value.code !== undefined && value.code !== current.code) {
        throw new OrderingError('BRANCH_CODE_IMMUTABLE', 'branch code is immutable', {
          details: { code },
        });
      }
      const data: Record<string, unknown> = {};
      for (const field of BRANCH_FIELDS) {
        if (field !== 'code' && value[field] !== undefined) data[field] = value[field];
      }
      const requested = requestedFulfillment(raw);
      if (requested && value.fulfillment) {
        // Kinds the request does not mention stay as stored.
        const next: Record<string, unknown> = { ...(current.fulfillment ?? {}) };
        if ('pickup' in requested) next.pickup = value.fulfillment.pickup;
        if ('delivery' in requested) next.delivery = value.fulfillment.delivery;
        for (const key of Object.keys(requested)) {
          if (key !== 'pickup' && key !== 'delivery') next[key] = (value.fulfillment as Record<string, unknown>)[key];
        }
        data.fulfillment = next;
      }
      const row = (await branches().update({ where: { id: current.id }, data })) as BranchRow;
      await changeLog().record(
        {
          action: 'branch.update',
          entityType: 'branch',
          entityId: current.id,
          locationRef: current.code,
          before: current as unknown as Record<string, unknown>,
          after: row as unknown as Record<string, unknown>,
        },
        ctx,
      );
      return toAdmin(row);
    },

    /** Storefront list (contracts §21.1): active + online branches, public fields only. */
    async listPublic() {
      const rows = (await branches().findMany({
        where: { isActive: true, onlineOrdering: true },
        orderBy: [{ rank: 'asc' }, { code: 'asc' }],
      })) as BranchRow[];
      return rows.map((row) => {
        const pickup = resolvePickupSettings(row.fulfillment?.pickup);
        const delivery = resolveDeliverySettings(row.fulfillment?.delivery);
        const receiveMethods: Array<{ kind: 'pickup' | 'delivery'; orderTiming: string }> = [];
        if (pickup.enabled) receiveMethods.push({ kind: 'pickup', orderTiming: pickup.orderTiming });
        if (delivery.enabled) receiveMethods.push({ kind: 'delivery', orderTiming: delivery.orderTiming });
        return {
          code: row.code,
          name: row.name ?? {},
          address: row.address ?? null,
          phone: row.phone ?? null,
          email: row.email ?? null,
          timezone: row.timezone,
          receiveMethods,
        };
      });
    },

    /**
     * Fee preview for the branch editor. A `zones` body quotes the draft on screen;
     * otherwise the saved zones are used. The response is the quote only — no address.
     */
    async deliveryQuote(code: string, raw: unknown, ctx: ServiceContext) {
      const row = await service.findByCode(code);
      if (!row || !scopeIncludes(await scope().loadScope(ctx), row.code)) throw notFound(code);
      const parsed = deliveryQuoteInputSchema.safeParse(raw ?? {});
      if (!parsed.success) {
        throw new OrderingError('VALIDATION_ERROR', 'delivery quote is invalid', {
          details: {
            issues: parsed.error.issues.map((issue) => ({
              path: issue.path.join('.'),
              message: issue.message,
            })),
          },
        });
      }
      const zones = parsed.data.zones ?? service.deliverySettings(row).zones;
      return quoteDelivery(zones, {
        communeCode: parsed.data.communeCode,
        subtotal: parsed.data.subtotal,
      });
    },

    // O1 compatibility: generic create/update used by fixtures and older call sites.
    async create(data: Record<string, unknown>, ctx: ServiceContext): Promise<Record<string, unknown>> {
      const row = await branches().create({ data });
      await changeLog().record(
        {
          action: 'branch.create',
          entityType: 'branch',
          entityId: row.id as number,
          locationRef: (data.code as string) ?? undefined,
          after: data,
        },
        ctx,
      );
      return row;
    },

    async update(
      id: number,
      data: Record<string, unknown>,
      ctx: ServiceContext,
    ): Promise<Record<string, unknown>> {
      const current = (await branches().findOne({ where: { id } })) as BranchRow | null;
      if (!current) {
        throw new OrderingError('BRANCH_NOT_FOUND', 'branch not found', { details: { id } });
      }
      if (data.code !== undefined && data.code !== current.code) {
        throw new OrderingError('BRANCH_CODE_IMMUTABLE', 'branch code is immutable', {
          details: { id },
        });
      }
      const row = await branches().update({ where: { id }, data });
      await changeLog().record(
        {
          action: 'branch.update',
          entityType: 'branch',
          entityId: id,
          locationRef: current.code,
          before: current as unknown as Record<string, unknown>,
          after: row as unknown as Record<string, unknown>,
        },
        ctx,
      );
      return row;
    },
  };
  return service;
};

export default branch;
