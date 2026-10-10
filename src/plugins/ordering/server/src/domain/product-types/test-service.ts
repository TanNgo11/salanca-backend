import type { ProductTypeDefinition } from '../../contracts';
import { quoteTestLine, validateTestLine } from './test-line';

/** Test product type for appointment-free services; only exists under `testing.builtins`. */
export const testServiceProductType: ProductTypeDefinition = {
  code: 'test-service',
  version: '1',
  capabilities: ['pickup', 'delivery'],
  validateLine: validateTestLine,
  quoteLine: quoteTestLine,
  selectWorkflow() {
    return { name: 'test-service', version: '1' };
  },
};
