import type { ProductTypeDefinition } from '../../contracts';
import { OrderingError } from '../errors';
import { quoteTestLine, validateTestLine } from './test-line';

/** Test product type for pickup-style goods; only exists under `testing.builtins`. */
export const testFoodProductType: ProductTypeDefinition = {
  code: 'test-food',
  version: '1',
  capabilities: ['pickup', 'delivery'],
  validateLine: validateTestLine,
  quoteLine: quoteTestLine,
  selectWorkflow({ receiveMethod, paymentTiming }) {
    switch (receiveMethod.kind) {
      case 'pickup':
        // O1 treats "accept then pay" as prepay; the dedicated workflow arrives with it.
        return paymentTiming === 'prepay'
          ? { name: 'pickup-prepay', version: '1' }
          : { name: 'pickup-pay-on-pickup', version: '1' };
      case 'delivery':
        // O5 adds the delivery workflows; O1 reuses the pickup happy path for tests.
        return { name: 'pickup-pay-on-pickup', version: '1' };
      default:
        throw new OrderingError('LINE_INVALID', 'test-food does not support appointment');
    }
  },
};
