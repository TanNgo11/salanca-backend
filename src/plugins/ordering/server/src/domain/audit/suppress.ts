import { AsyncLocalStorage } from 'node:async_hooks';

/**
 * Lets a service that writes its own, richer change-log row (e.g. `catalog-category.create`)
 * tell the Document Service audit middleware not to add a second row for the same write.
 * Scoped to the async call chain, so concurrent requests never affect each other.
 */
const storage = new AsyncLocalStorage<{ uids: Set<string> }>();

export const withAuditSuppressed = <T>(uid: string, fn: () => Promise<T>): Promise<T> => {
  const current = storage.getStore();
  const uids = new Set(current?.uids ?? []);
  uids.add(uid);
  return storage.run({ uids }, fn);
};

export const isAuditSuppressed = (uid: string): boolean =>
  storage.getStore()?.uids.has(uid) ?? false;
