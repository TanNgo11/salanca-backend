/** `GET /ordering/kitchen` answers `{ item: board }` (controllers/kitchen.ts). */
export const boardFrom = <T extends { orders: unknown[] }>(body: unknown): T | null => {
  const item = (body as { item?: { orders?: unknown } } | null)?.item;
  return item && Array.isArray(item.orders) ? (item as T) : null;
};
