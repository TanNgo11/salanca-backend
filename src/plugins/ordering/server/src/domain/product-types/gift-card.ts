import type { ProductTypeDefinition, ValidationResult } from '../../contracts';
import { OrderingError } from '../errors';

const invalid = (message: string): ValidationResult => ({
  valid: false,
  code: 'LINE_INVALID',
  message,
});

/**
 * The `gift-card` product type (O9 plan step 3). The denomination is the catalog price —
 * variants model the fixed face values — and a line takes no options. Every unit of
 * `quantity` becomes one issued card after payment capture; the workflow is always
 * `gift-card` (awaiting-payment → issued | expired | canceled), selected only for
 * `digital` orders so card lines can never ride a pickup/delivery flow.
 */
export const giftCardProductType: ProductTypeDefinition = {
  code: 'gift-card',
  version: '1',
  capabilities: ['digital'],
  validateLine(input) {
    if (!Number.isInteger(input.quantity) || input.quantity < 1) {
      return invalid('quantity must be a positive integer');
    }
    if (input.selected.length > 0) {
      return invalid('gift cards take no options');
    }
    if (
      !Number.isSafeInteger(input.sellable.listPrice.amount) ||
      input.sellable.listPrice.amount <= 0
    ) {
      return invalid('a gift card needs a positive denomination price');
    }
    return { valid: true };
  },
  async quoteLine(input) {
    return {
      unitAmount: input.sellable.listPrice.amount,
      optionAmount: 0,
      currency: input.sellable.listPrice.currency,
      taxGroupRef: input.sellable.taxGroupRef,
    };
  },
  selectWorkflow({ receiveMethod }) {
    if (receiveMethod.kind !== 'digital') {
      throw new OrderingError('LINE_INVALID', 'gift cards are delivered digitally only');
    }
    return { name: 'gift-card', version: '1' };
  },
};
