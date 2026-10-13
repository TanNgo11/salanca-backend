import type { TransactionClient } from '../migrations/runner';

/** Same identity lock for order linking and erasure, followed by the customer's row lock. */
export const lockCustomer = async (
  trx: TransactionClient,
  customer: { id: number; phoneHash: string | null },
): Promise<void> => {
  await trx.raw('SELECT pg_advisory_xact_lock(hashtext(?))', [
    `ordering-customer:${customer.phoneHash ?? `id:${customer.id}`}`,
  ]);
  await trx('plugins_ordering_customer').where({ id: customer.id }).forUpdate().first('id');
};
