import { AsyncLocalStorage } from 'node:async_hooks';

const genericAuditCaptureSuppression = new AsyncLocalStorage<number>();

export const isGenericAuditCaptureSuppressed = (): boolean =>
  (genericAuditCaptureSuppression.getStore() ?? 0) > 0;

export const withGenericAuditCaptureSuppressed = async <T>(
  run: () => Promise<T>,
): Promise<T> => {
  const depth = (genericAuditCaptureSuppression.getStore() ?? 0) + 1;
  return genericAuditCaptureSuppression.run(depth, run);
};
