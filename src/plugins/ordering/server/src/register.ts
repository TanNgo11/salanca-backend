import type { Core } from '@strapi/strapi';

import type { OrderingConfig } from './config';
import { OrderingError } from './domain/errors';
import { testFoodProductType } from './domain/product-types/test-food';
import { testServiceProductType } from './domain/product-types/test-service';
import { builtinWorkflows } from './domain/workflow/definitions';
import { createOrderingCatalogStubAdapter } from './providers/ordering-catalog-stub';
import { createTestCatalogAdapter } from './providers/test-catalog';
import { createTestPaymentProvider } from './providers/test-payment';
import type { OrderingRegistry } from './services/registry';

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
