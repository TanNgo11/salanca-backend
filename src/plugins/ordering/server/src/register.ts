import type { Core } from '@strapi/strapi';

import type { OrderingConfig } from './config';
import { validateBundleSlotRefs, validateBundleSlots } from './domain/catalog/bundle-slots';
import {
  LOCALIZED_TEXT_MAX_DESCRIPTION,
  LOCALIZED_TEXT_MAX_NAME,
  LOCALIZED_TEXT_MAX_SLUG,
  validateLocalizedText,
} from './domain/catalog/localized-text';
import {
  type ModifierLibrary,
  validateModifierGroupRefs,
  validateModifierGroups,
} from './domain/catalog/modifier-groups';
import { OrderingError } from './domain/errors';
import { testFoodProductType } from './domain/product-types/test-food';
import { testServiceProductType } from './domain/product-types/test-service';
import { builtinWorkflows } from './domain/workflow/definitions';
import { createOrderingCatalogStubAdapter } from './providers/ordering-catalog-stub';
import { createTestCatalogAdapter } from './providers/test-catalog';
import { createTestPaymentProvider } from './providers/test-payment';
import type catalogSlugFactory from './services/catalog-slug';
import type { OrderingRegistry } from './services/registry';

type CatalogSlugService = ReturnType<typeof catalogSlugFactory>;

/** UIDs that carry per-locale slug rows in `catalog-slug` (contracts §20.1). */
const SLUGGED_UIDS = {
  'plugin::ordering.catalog-category': 'catalog-category',
  'plugin::ordering.catalog-product': 'catalog-product',
} as const;

/** Admin actions of contracts §19.2, registered under the plugin section. */
const adminActions = [
  { uid: 'order.read', displayName: 'Xem đơn hàng' },
  { uid: 'order.process', displayName: 'Xử lý đơn hàng' },
  { uid: 'order.cancel', displayName: 'Hủy đơn hàng' },
  { uid: 'order.create', displayName: 'Tạo đơn hộ khách' },
  { uid: 'order.edit-lines', displayName: 'Hủy một phần món' },
  { uid: 'payment.record-cash', displayName: 'Ghi nhận tiền mặt' },
  { uid: 'payment.review', displayName: 'Duyệt chuyển khoản' },
  { uid: 'payment.raw-read', displayName: 'Xem payload cổng thanh toán' },
  { uid: 'refund.manage', displayName: 'Hoàn tiền' },
  { uid: 'report.read', displayName: 'Báo cáo' },
  { uid: 'export', displayName: 'Xuất CSV đơn' },
  { uid: 'settings.manage', displayName: 'Cấu hình bán hàng' },
  { uid: 'scope.manage', displayName: 'Gán chi nhánh cho nhân viên' },
  { uid: 'ops.read', displayName: 'Tình trạng vận hành' },
];

const register = ({ strapi }: { strapi: Core.Strapi }) => {
  const config = strapi.config.get('plugin::ordering') as OrderingConfig;
  const registry = strapi.plugin('ordering').service('registry') as OrderingRegistry;

  registry.registerCatalogAdapter(createOrderingCatalogStubAdapter());
  for (const workflow of builtinWorkflows) {
    registry.registerWorkflow(workflow);
  }
  if (config.testing.builtins) {
    registry.registerCatalogAdapter(createTestCatalogAdapter());
    registry.registerProductType(testFoodProductType);
    registry.registerProductType(testServiceProductType);
    registry.registerPaymentProvider(createTestPaymentProvider());
    // test.ping appends to the delivery log (idempotent by event id — ON CONFLICT DO NOTHING);
    // test.fail always throws for the backoff path. Both exist only under testing.builtins.
    let deliveryTable: Promise<unknown> | null = null;
    const ensureDeliveryTable = () => {
      deliveryTable ??= strapi.db.connection.raw(
        `CREATE TABLE IF NOT EXISTS ordering_test_delivery_log (
           event_id integer PRIMARY KEY,
           owner text NOT NULL,
           delivered_at timestamptz NOT NULL DEFAULT now()
         )`,
      );
      return deliveryTable;
    };
    registry.registerOutboxConsumer('test.ping', async (event) => {
      await ensureDeliveryTable();
      await strapi.db.connection.raw(
        'INSERT INTO ordering_test_delivery_log (event_id, owner) VALUES (?, ?) ON CONFLICT (event_id) DO NOTHING',
        [Number(event.id), `${process.pid}`],
      );
    });
    registry.registerOutboxConsumer('test.fail', async () => {
      throw new Error('test.fail consumer always fails');
    });
  }

  strapi.customFields.register({ name: 'localized-text', plugin: 'ordering', type: 'json' });
  strapi.customFields.register({ name: 'modifier-groups', plugin: 'ordering', type: 'json' });
  strapi.customFields.register({ name: 'bundle-slots', plugin: 'ordering', type: 'json' });

  // Branch codes are immutable — orders pin them via locationRef. This middleware covers the
  // Document Service path (Admin/API); the `branch` service enforces the same rule for
  // service calls. Raw `db.query` bypass is a documented boundary.
  type DocumentsMiddleware = Parameters<typeof strapi.documents.use>[0];
  const branchImmutability: DocumentsMiddleware = async (context, next) => {
    const params = context.params as
      | { documentId?: string; data?: { code?: string } }
      | undefined;
    if (
      context.uid === 'plugin::ordering.branch' &&
      context.action === 'update' &&
      params?.data?.code !== undefined
    ) {
      const current = (await strapi.db.query('plugin::ordering.branch').findOne({
        where: { documentId: params.documentId },
      })) as { code: string } | null;
      if (current && params.data.code !== current.code) {
        throw new OrderingError('BRANCH_CODE_IMMUTABLE', 'branch code is immutable');
      }
    }
    return next();
  };
  strapi.documents.use(branchImmutability);

  // Catalog integrity (plan steps 2–3): every localized-text attribute on a plugin UID is
  // validated against the app's enabled locales, and category/product writes reconcile their
  // per-locale `catalog-slug` rows in the same transaction (released on delete). db.query
  // bypass is a documented boundary, same as branch code immutability.
  const slugService = () =>
    strapi.plugin('ordering').service('catalog-slug') as CatalogSlugService;
  const enabledLocales = async (): Promise<string[]> => {
    try {
      const rows = (await strapi.plugin('i18n').service('locales').find()) as {
        code: string;
      }[];
      return rows.length > 0 ? rows.map((row) => row.code) : ['vi', 'en'];
    } catch {
      return ['vi', 'en'];
    }
  };
  const localizedMax = (field: string): number =>
    field === 'description'
      ? LOCALIZED_TEXT_MAX_DESCRIPTION
      : field === 'slug'
        ? LOCALIZED_TEXT_MAX_SLUG
        : LOCALIZED_TEXT_MAX_NAME;

  const catalogIntegrity: DocumentsMiddleware = async (context, next) => {
    if (!context.uid.startsWith('plugin::ordering.')) return next();
    const entityType = SLUGGED_UIDS[context.uid as keyof typeof SLUGGED_UIDS];
    const params = context.params as
      | { documentId?: string; data?: Record<string, unknown> }
      | undefined;

    if (context.action === 'create' || context.action === 'update') {
      const attributes = context.contentType.attributes as Record<
        string,
        { customField?: string; required?: boolean }
      >;
      const localizedFields = Object.entries(attributes).filter(
        ([, attribute]) => attribute.customField === 'plugin::ordering.localized-text',
      );
      if (localizedFields.length > 0 && params?.data) {
        const locales = await enabledLocales();
        for (const [field, attribute] of localizedFields) {
          if (!(field in params.data)) continue;
          const result = validateLocalizedText(params.data[field], {
            enabledLocales: locales,
            maxLength: localizedMax(field),
            required: attribute.required === true,
            field,
          });
          if (!result.valid) {
            throw new OrderingError('VALIDATION_ERROR', result.message, {
              details: result.details,
            });
          }
        }
      }
      // Product JSON fields (plan step 4): structural validation, then reference checks —
      // groupRef/override keys must resolve to real modifier groups and their members, and
      // bundle items must reference existing variants. All refs are documentIds.
      if (context.uid === 'plugin::ordering.catalog-product' && params?.data) {
        if ('modifierGroups' in params.data) {
          const structural = validateModifierGroups(params.data.modifierGroups);
          if (!structural.valid) {
            throw new OrderingError('VALIDATION_ERROR', structural.message, {
              details: structural.details,
            });
          }
          if (structural.value.length > 0) {
            const groups = (await strapi.db
              .query('plugin::ordering.catalog-modifier-group')
              .findMany({ select: ['documentId'] })) as { documentId: string }[];
            const modifiers = (await strapi.db
              .query('plugin::ordering.catalog-modifier')
              .findMany({ select: ['documentId'], populate: { group: true } })) as {
              documentId: string;
              group?: { documentId?: string } | null;
            }[];
            const library: ModifierLibrary = {
              groupDocumentIds: new Set(groups.map((row) => row.documentId)),
              modifierDocumentIdsByGroup: modifiers.reduce((map, row) => {
                const groupRef = row.group?.documentId;
                if (groupRef) {
                  const members = map.get(groupRef) ?? new Set<string>();
                  members.add(row.documentId);
                  map.set(groupRef, members);
                }
                return map;
              }, new Map<string, Set<string>>()),
            };
            const refs = validateModifierGroupRefs(structural.value, library);
            if (!refs.valid) {
              throw new OrderingError('VALIDATION_ERROR', refs.message, {
                details: refs.details,
              });
            }
          }
        }
        if ('bundleSlots' in params.data) {
          const structural = validateBundleSlots(params.data.bundleSlots);
          if (!structural.valid) {
            throw new OrderingError('VALIDATION_ERROR', structural.message, {
              details: structural.details,
            });
          }
          if (structural.value.some((slot) => slot.items.length > 0)) {
            const variants = (await strapi.db
              .query('plugin::ordering.catalog-variant')
              .findMany({ select: ['documentId'] })) as { documentId: string }[];
            const refs = validateBundleSlotRefs(
              structural.value,
              new Set(variants.map((row) => row.documentId)),
            );
            if (!refs.valid) {
              throw new OrderingError('VALIDATION_ERROR', refs.message, {
                details: refs.details,
              });
            }
          }
        }
      }
      if (!entityType) return next();
      const merged = { name: params?.data?.name, slug: params?.data?.slug };
      if (
        context.action === 'update' &&
        params?.documentId &&
        (merged.name === undefined || merged.slug === undefined)
      ) {
        const current = (await strapi.db.query(context.uid).findOne({
          where: { documentId: params.documentId },
        })) as { name?: unknown; slug?: unknown } | null;
        merged.name = merged.name === undefined ? current?.name : merged.name;
        merged.slug = merged.slug === undefined ? current?.slug : merged.slug;
      }
      return strapi.db.transaction(async () => {
        const result = await next();
        const documentId =
          (result as { documentId?: string } | null | undefined)?.documentId ??
          params?.documentId;
        if (documentId) {
          await slugService().sync({
            entityType,
            entityDocumentId: documentId,
            name: merged.name,
            slug: merged.slug,
          });
        }
        return result;
      });
    }
    if (context.action === 'delete' && entityType && params?.documentId) {
      return strapi.db.transaction(async () => {
        const result = await next();
        await slugService().release(entityType, params.documentId as string);
        return result;
      });
    }
    return next();
  };
  strapi.documents.use(catalogIntegrity);

  strapi.admin.services.permission.actionProvider.registerMany(
    adminActions.map((action) => ({
      section: 'plugins',
      pluginName: 'ordering',
      ...action,
    })),
  );
  strapi.admin.services.permission.conditionProvider.register({
    name: 'same-location', displayName: 'Assigned ordering branches', plugin: 'ordering',
    category: 'ordering',
    // Strapi passes the admin user itself (merged with the permission), not `{ user }`;
    // see admin::is-creator in @strapi/admin config/admin-conditions.js.
    handler: async (user: { id?: number }) =>
      strapi.plugin('ordering').service('scope').condition(user),
  });
  strapi.log.info('[ordering] lifecycle: plugin register');
};

export default register;
