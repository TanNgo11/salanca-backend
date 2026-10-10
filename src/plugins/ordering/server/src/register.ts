import type { Core } from '@strapi/strapi';

import type { OrderingConfig } from './config';
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
    registry.registerOutboxConsumer('test.ping', async () => {});
  }

  strapi.customFields.register({ name: 'localized-text', plugin: 'ordering', type: 'json' });
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
      strapi.plugin('ordering').service('branch-scope').condition({ user }),
  });
  strapi.log.info('[ordering] lifecycle: plugin register');
};

export default register;
