import type { AdapterContext, AvailabilityResult, JsonObject, Locale } from './common';
import type { Money } from '../domain/money';
import type { Sellable, SellableRef } from './sellable';

/**
 * Normalizes a catalog into sellables, list prices and availability (contracts doc §4). It never
 * validates options a second time and never decides the final order price — that is the pipeline's
 * and the product type's job.
 */
export interface CatalogAdapter {
  code: string;
  listCategories(ctx: AdapterContext, input: { locale: Locale }): Promise<JsonObject[]>;
  listSellables(
    ctx: AdapterContext,
    input: { locale: Locale; categoryRef?: string; cursor?: string; limit: number },
  ): Promise<{ items: Sellable[]; nextCursor?: string }>;
  getSellable(ctx: AdapterContext, ref: SellableRef, input: { locale: Locale }): Promise<Sellable | null>;
  getListPrice(ctx: AdapterContext, sellable: Sellable): Promise<Money>;
  getAvailability(
    ctx: AdapterContext,
    sellable: Sellable,
    quantity: number,
  ): Promise<AvailabilityResult>;
}
