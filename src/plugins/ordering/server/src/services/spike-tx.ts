import type { Core } from '@strapi/strapi';

export async function runSpikeTransaction(strapi: Core.Strapi, code: string) {
  return strapi.db.transaction(async ({ trx, onCommit, onRollback }) => {
    const row = await trx('plugins_ordering_order').where({ code }).forUpdate().first();
    if (!row) throw new Error(`Missing spike order ${code}`);
    const next = Number(row.counter) + 1;
    await trx('plugins_ordering_order').where({ id: row.id }).update({ counter: next, updated_at: new Date() });
    onCommit(() => undefined);
    onRollback(() => undefined);
    return next;
  });
}
