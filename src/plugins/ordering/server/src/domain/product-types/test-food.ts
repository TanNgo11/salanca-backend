import type { ProductTypeDefinition } from '../../contracts';
import { OrderingError } from '../errors';
import { quoteTestLine, validateTestLine } from './test-line';

/** Test product type for pickup-style goods; only exists under `testing.builtins`. */
export const testFoodProductType: ProductTypeDefinition = {
  code: 'test-food',
  version: '1',
  capabilities: ['pickup', 'delivery', 'dine-in'],
  validateLine: validateTestLine,
  quoteLine: quoteTestLine,
  selectWorkflow({ receiveMethod, paymentTiming }) {
    switch (receiveMethod.kind) {
      case 'pickup':
        if (paymentTiming === 'prepay') return { name: 'pickup-prepay', version: '1' };
        if (paymentTiming === 'accept-then-pay') {
          return { name: 'pickup-accept-then-pay', version: '1' };
        }
        return { name: 'pickup-pay-on-pickup', version: '1' };
      case 'delivery':
        if (paymentTiming === 'prepay') return { name: 'delivery-prepay', version: '1' };
        if (paymentTiming === 'accept-then-pay') {
          return { name: 'delivery-accept-then-pay', version: '1' };
        }
        return { name: 'delivery-pay-on-delivery', version: '1' };
      case 'dine-in':
        if (paymentTiming === 'prepay') return { name: 'dine-in-prepay', version: '1' };
        if (paymentTiming === 'accept-then-pay') {
          return { name: 'dine-in-accept-then-pay', version: '1' };
        }
        return { name: 'dine-in-pay-later', version: '1' };
      default:
        throw new OrderingError(
          'LINE_INVALID',
          `test-food does not support "${receiveMethod.kind}"`,
        );
    }
  },
};
