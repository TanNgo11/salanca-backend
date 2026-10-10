import type { Core } from '@strapi/strapi';

import { nextBusinessDayCutoff, nextLocalTime } from '../domain/catalog/availability';
import { resolveLocalizedText } from '../domain/catalog/localized-text';
import { OrderingError } from '../domain/errors';
import { scopeIncludes } from '../domain/scope';
import { actorRefOf, nowOf, type ServiceContext } from './context';
import type changeLogFactory from './change-log';
import type scopeFactory from './scope';

const STATE = 'plugin::ordering.catalog-location-state';
const BRANCH = 'plugin::ordering.branch';
const PRODUCT = 'plugin::ordering.catalog-product';
const VARIANT = 'plugin::ordering.catalog-variant';
const MODIFIER = 'plugin::ordering.catalog-modifier';

const ENTITY_CT: Record<string, string> = {
  product: PRODUCT,
  variant: VARIANT,
  modifier: MODIFIER,
};

type EntityType = 'product' | 'variant' | 'modifier';

type ToggleInput = {
  entityType: EntityType;
  entityDocumentId: string;
  locationRef: string;
  selling: boolean;
  untilKind?: 'end-of-business-day' | 'specific-time';
  /** 'HH:mm' branch-local wall time or an absolute ISO instant (specific-time only). */
  until?: string;
};

type NamedRow = { id: number; documentId: string; name?: Record<string, string> };

type StateRow = {
  id: number;
  documentId: string;
  entityType: string;
  entityDocumentId: string;
  locationRef: string;
  selling: boolean;
  outOfStockUntil?: string | null;
  untilKind?: string | null;
  toggledBy?: string | null;
  toggledAt?: string | null;
};

const pickName = (name: Record<string, string> | undefined, locale: string): string =>
  resolveLocalizedText(name, locale, 'vi') ?? '';

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

/**
 * "Tạm hết món" backend (plan step 8 / mockup 5): scoped branch list, the flat
 * product/variant/modifier list with current per-branch state, and the guarded toggle.
 * Every write is scope-checked and appended to `admin-change-log`; the location-state
 * content type stays hidden from Content Manager on purpose.
 */
const catalogAvailability = ({ strapi }: { strapi: Core.Strapi }) => {
  const scope = () =>
    strapi.plugin('ordering').service('scope') as ReturnType<typeof scopeFactory>;
  const changeLog = () =>
    strapi.plugin('ordering').service('change-log') as ReturnType<typeof changeLogFactory>;
  const states = () => strapi.db.query(STATE);

  const config = () =>
    strapi.config.get('plugin::ordering') as { businessDay?: { cutoffLocalTime?: string } };

  const scopedOrThrow = async (ctx: ServiceContext, locationRef: string) => {
    const resolved = await scope().loadScope(ctx);
    if (resolved === null || !scopeIncludes(resolved, locationRef)) {
      throw new OrderingError('SCOPE_REQUIRED', 'branch is outside your assigned scope', {
        details: { locationRef },
      });
    }
    return resolved;
  };

  const findBranch = async (code: string) => {
    const branch = (await strapi.db.query(BRANCH).findOne({
      where: { code },
    })) as { documentId: string; code: string; name?: Record<string, string>; timezone?: string } | null;
    if (!branch) {
      throw new OrderingError('BRANCH_NOT_FOUND', 'branch not found', {
        details: { locationRef: code },
      });
    }
    return branch;
  };

  return {
    /** Branches inside the actor's scope — the screen's selector options. */
    async listLocations(ctx: ServiceContext) {
      const resolved = await scope().loadScope(ctx);
      if (resolved === null) return { items: [] };
      const rows = (await strapi.db.query(BRANCH).findMany({
        where: resolved.allLocations ? {} : { code: { $in: resolved.locationRefs } },
        orderBy: { rank: 'asc' },
      })) as { code: string; name?: Record<string, string>; timezone?: string; isActive?: boolean }[];
      return {
        items: rows.map((row) => ({
          code: row.code,
          name: pickName(row.name, 'vi'),
          timezone: row.timezone,
          isActive: row.isActive !== false,
        })),
      };
    },

    /**
     * Flat product/variant/modifier rows merged with the location-state at `locationRef`.
     * A missing state row means "selling" — states only exist once a staff member toggles.
     */
    async list(locationRef: string, ctx: ServiceContext) {
      await scopedOrThrow(ctx, locationRef);
      const [products, variants, modifiers, stateRows] = await Promise.all([
        strapi.db.query(PRODUCT).findMany({
          where: { status: { $ne: 'archived' } },
          select: ['id', 'documentId', 'name'],
          orderBy: { rank: 'asc' },
        }) as Promise<NamedRow[]>,
        strapi.db.query(VARIANT).findMany({
          select: ['id', 'documentId', 'name'],
          populate: { product: { select: ['documentId', 'name', 'status'] } },
          orderBy: { rank: 'asc' },
        }) as Promise<(NamedRow & { product?: NamedRow & { status?: string } | null })[]>,
        strapi.db.query(MODIFIER).findMany({
          select: ['id', 'documentId', 'name'],
          orderBy: { rank: 'asc' },
        }) as Promise<NamedRow[]>,
        states().findMany({ where: { locationRef } }) as Promise<StateRow[]>,
      ]);
      const stateByRef = new Map(stateRows.map((row) => [`${row.entityType}:${row.entityDocumentId}`, row]));
      const item = (entityType: EntityType, ref: string, label: string) => {
        const state = stateByRef.get(`${entityType}:${ref}`);
        return {
          entityType,
          entityDocumentId: ref,
          label,
          selling: state ? state.selling !== false : true,
          outOfStockUntil: state?.outOfStockUntil ?? null,
          untilKind: state?.untilKind ?? null,
          toggledBy: state?.toggledBy ?? null,
          toggledAt: state?.toggledAt ?? null,
        };
      };
      return {
        items: [
          ...products.map((row) => item('product', row.documentId, pickName(row.name, 'vi'))),
          ...variants
            .filter((row) => row.product?.status !== 'archived')
            .map((row) =>
              item(
                'variant',
                row.documentId,
                `${pickName(row.product?.name, 'vi')} · ${pickName(row.name, 'vi')}`,
              ),
            ),
          ...modifiers.map((row) => item('modifier', row.documentId, pickName(row.name, 'vi'))),
        ],
      };
    },

    /**
     * Upsert the (entityType, entityDocumentId, locationRef) state row. `selling=false` may
     * carry `untilKind`: 'end-of-business-day' resolves the configured day-close in the
     * branch timezone; 'specific-time' accepts 'HH:mm' (next occurrence, branch tz) or an
     * absolute ISO instant that must lie in the future; absent means indefinite off.
     */
    async toggle(input: ToggleInput, ctx: ServiceContext) {
      const entityCt = ENTITY_CT[input.entityType];
      if (!entityCt || typeof input.entityDocumentId !== 'string' || input.entityDocumentId === '') {
        throw new OrderingError('VALIDATION_ERROR', 'entityType/entityDocumentId invalid');
      }
      if (typeof input.locationRef !== 'string' || input.locationRef === '') {
        throw new OrderingError('VALIDATION_ERROR', 'locationRef invalid');
      }
      await scopedOrThrow(ctx, input.locationRef);
      const branch = await findBranch(input.locationRef);
      const entity = (await strapi.db
        .query(entityCt)
        .findOne({ where: { documentId: input.entityDocumentId } })) as NamedRow | null;
      if (!entity) {
        throw new OrderingError('SELLABLE_NOT_FOUND', 'catalog entity not found', {
          details: { entityType: input.entityType, entityDocumentId: input.entityDocumentId },
        });
      }

      const now = nowOf(ctx);
      const timezone = branch.timezone ?? 'Asia/Ho_Chi_Minh';
      let outOfStockUntil: string | null = null;
      let untilKind: string | null = null;
      if (input.selling === false) {
        if (input.untilKind === 'end-of-business-day') {
          outOfStockUntil = nextBusinessDayCutoff(
            now,
            config().businessDay?.cutoffLocalTime ?? '04:00',
            timezone,
          ).toISOString();
          untilKind = 'end-of-business-day';
        } else if (input.untilKind === 'specific-time') {
          if (typeof input.until !== 'string' || input.until === '') {
            throw new OrderingError('VALIDATION_ERROR', 'until is required for a timed tạm hết');
          }
          if (HHMM.test(input.until)) {
            outOfStockUntil = nextLocalTime(now, input.until, timezone).toISOString();
          } else {
            const at = new Date(input.until);
            if (Number.isNaN(at.getTime()) || at.getTime() <= now.getTime()) {
              throw new OrderingError('VALIDATION_ERROR', 'until must be a future time');
            }
            outOfStockUntil = at.toISOString();
          }
          untilKind = 'specific-time';
        } else if (input.untilKind !== undefined && input.untilKind !== null) {
          throw new OrderingError('VALIDATION_ERROR', 'untilKind invalid');
        }
      }

      const before = (await states().findOne({
        where: {
          entityType: input.entityType,
          entityDocumentId: input.entityDocumentId,
          locationRef: input.locationRef,
        },
      })) as StateRow | null;
      const data = {
        entityType: input.entityType,
        entityDocumentId: input.entityDocumentId,
        locationRef: input.locationRef,
        selling: input.selling === true,
        outOfStockUntil,
        untilKind,
        toggledBy: actorRefOf(ctx),
        toggledAt: now.toISOString(),
      };
      const row = (before
        ? await states().update({ where: { id: before.id }, data })
        : await states().create({ data })) as StateRow;

      await changeLog().record(
        {
          action: 'catalog-availability.toggle',
          entityType: 'catalog-location-state',
          entityId: `${input.entityType}:${input.entityDocumentId}`,
          locationRef: input.locationRef,
          before: before
            ? {
                selling: before.selling,
                outOfStockUntil: before.outOfStockUntil ?? null,
                untilKind: before.untilKind ?? null,
              }
            : null,
          after: {
            selling: row.selling,
            outOfStockUntil: row.outOfStockUntil ?? null,
            untilKind: row.untilKind ?? null,
          },
        },
        ctx,
      );
      return {
        item: {
          entityType: row.entityType,
          entityDocumentId: row.entityDocumentId,
          locationRef: row.locationRef,
          selling: row.selling,
          outOfStockUntil: row.outOfStockUntil ?? null,
          untilKind: row.untilKind ?? null,
          toggledBy: row.toggledBy ?? null,
          toggledAt: row.toggledAt ?? null,
        },
      };
    },

    /** ServiceContext for an admin request — same actor derivation as the other services. */
    async contextFor(adminUser: { id?: number; roles?: { code?: string }[] }) {
      const actor = await scope().actorFromAdminUser(adminUser);
      return { actor } satisfies ServiceContext;
    },
  };
};

export default catalogAvailability;
