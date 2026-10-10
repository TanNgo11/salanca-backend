import type { JsonObject } from './common';
import type { Money } from '../domain/money';
import type { Order, OrderLine } from './entities';

/** Voucher/gift-card provider contract (contracts doc §10). */
export interface VoucherProvider {
  code: string;
  issue(input: { order: Order; line: OrderLine; policy: string }): Promise<{
    voucherRef: string;
    delivery: JsonObject;
  }>;
  redeem(input: { code: string; amount?: Money; actorRef?: string }): Promise<{
    redemptionRef: string;
    remaining: Money;
  }>;
  refundUnused(input: { voucherRef: string; reason: string }): Promise<void>;
  getStatus(input: { voucherRef: string }): Promise<JsonObject>;
}
