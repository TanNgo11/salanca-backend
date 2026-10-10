import type { JsonObject, ValidationResult } from './common';
import type { Money } from '../domain/money';
import type { Fulfillment, FulfillmentGroup, Order } from './entities';

/** Fulfillment provider contract; the provider never writes order status itself (doc §5). */
export interface FulfillmentProvider {
  code: string;
  capabilities: string[];
  getOptions(input: { order: Order; group: FulfillmentGroup }): Promise<JsonObject[]>;
  validate(input: {
    order: Order;
    group: FulfillmentGroup;
    option: JsonObject;
  }): Promise<ValidationResult>;
  calculatePrice(input: {
    order: Order;
    group: FulfillmentGroup;
    option: JsonObject;
  }): Promise<Money>;
  create(input: { order: Order; group: FulfillmentGroup; option: JsonObject }): Promise<{
    providerReference?: string;
    trackingNumber?: string;
    trackingUrl?: string;
  }>;
  cancel?(input: { fulfillment: Fulfillment; reason: string }): Promise<void>;
  getDocuments?(input: { fulfillment: Fulfillment }): Promise<JsonObject[]>;
}
