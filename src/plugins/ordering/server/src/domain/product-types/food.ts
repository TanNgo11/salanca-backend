import type { ProductTypeDefinition } from '../../contracts';
import { OrderingError } from '../errors';
import { quoteTestLine, validateTestLine } from './test-line';

/**
 * The real `food` product type (contracts §4) — the default `productType` of catalog products.
 * Line rules reuse the shared validators (quantity, option existence/activity, group min/max,
 * required groups) and the option-delta quote; bundle slots reach the line as option groups,
 * so no bundle-specific pricing code is needed here. Pickup maps the branch's
 * `paymentTiming` to one of the three pickup workflows (contracts §19.6); delivery maps to the
 * three `delivery-*` workflows of O5 (contracts §19.8).
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
      default:
        throw new OrderingError('LINE_INVALID', 'food does not support appointment');
    }
  },
};
