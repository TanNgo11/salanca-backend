import type { OrderingMigration } from './runner';

/** Durable provider-operation lookup and one unresolved operation per fulfillment/action. */
export const providerRecoveryMigration: OrderingMigration = {
  name: '0014-provider-recovery',
  async up(trx) {
    await trx.raw(
      `CREATE UNIQUE INDEX IF NOT EXISTS plugins_ordering_provider_operation_key_uq
       ON plugins_ordering_provider_operation (operation_key)`,
    );
    await trx.raw(
      `CREATE UNIQUE INDEX IF NOT EXISTS plugins_ordering_provider_operation_active_uq
       ON plugins_ordering_provider_operation (fulfillment_id, kind)
       WHERE state IN ('prepared', 'dispatching', 'unknown')`,
    );
    await trx.raw(
      `CREATE INDEX IF NOT EXISTS plugins_ordering_provider_operation_order_state_idx
       ON plugins_ordering_provider_operation (order_id, state, updated_at)`,
    );
  },
};
