/**
 * Order CSV export limits (O6 V5). Lives in shared/ so the server enforces them and the
 * Admin modal can show the same numbers without importing server code.
 */
export const ORDER_EXPORT_MAX_ROWS = 10_000;
export const ORDER_EXPORT_MAX_DAYS = 92;
