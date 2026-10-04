import { AsyncLocalStorage } from 'node:async_hooks';

const requestAuditCaptures = new AsyncLocalStorage<Set<string>>();

export const withAuditRequestCapture = async <T>(
  run: () => Promise<T>,
): Promise<T> => requestAuditCaptures.run(new Set<string>(), run);

export const markAuditRequestCaptured = (requestId: string): void => {
  requestAuditCaptures.getStore()?.add(requestId);
};

export const wasAuditRequestCaptured = (requestId: string): boolean =>
  requestAuditCaptures.getStore()?.has(requestId) === true;
