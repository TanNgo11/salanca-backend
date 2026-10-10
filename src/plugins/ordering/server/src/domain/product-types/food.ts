import type { ProductTypeDefinition } from '../../contracts';
import { OrderingError } from '../errors';
import { quoteTestLine, validateTestLine } from './test-line';

/**
 * The real `food` product type (contracts §4) — the default `productType` of catalog products.
 * Line rules reuse the shared validators (quantity, option existence/activity, group min/max,
 * required groups) and the option-delta quote; bundle slots reach the line as option groups,
 * so no bundle-specific pricing code is needed here. Dedicated food workflows replace the
 * pickup placeholders with later phases.
 */
export const foodProductType: ProductTypeDefinition = {
  code: 'food',
  version: '1',
  capabilities: ['pickup', 'delivery'],
  validateLine: validateTestLine,
  quoteLine: quoteTestLine,
  selectWorkflow({ receiveMethod, paymentTiming }) {
    switch (receiveMethod.kind) {
      case 'pickup':
        return paymentTiming === 'prepay'
          ? { name: 'pickup-prepay', version: '1' }
          : { name: 'pickup-pay-on-pickup', version: '1' };
      case 'delivery':
        return { name: 'pickup-pay-on-pickup', version: '1' };
      default:
        throw new OrderingError('LINE_INVALID', 'food does not support appointment');
    }
  },
};
