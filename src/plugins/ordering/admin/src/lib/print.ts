/**
 * O12/N1 print helpers: the admin-route prefix for the standalone print page, the
 * per-browser "máy in quầy" (counter printer) flag, and a per-order reprint counter
 * shown at the bottom of reprints — all localStorage machine conveniences, not data.
 */

/** `/admin` (or the configured admin path) — derived from the current URL's `/plugins/` segment. */
export const adminBase = (): string => {
  const index = window.location.pathname.indexOf('/plugins/');
  return index >= 0 ? window.location.pathname.slice(0, index) : '/admin';
};

export const printUrl = (orderId: number, doc: 'kitchen' | 'receipt', width?: 58 | 80): string =>
  `${adminBase()}/plugins/ordering/print/${orderId}?doc=${doc}${width ? `&width=${width}` : ''}`;

const COUNTER_KEY = 'ordering.print.counter';
const COUNT_PREFIX = 'ordering.print.count.';

export const isCounterPrinter = (): boolean => {
  try {
    return window.localStorage.getItem(COUNTER_KEY) === '1';
  } catch {
    return false;
  }
};

export const setCounterPrinter = (on: boolean) => {
  try {
    window.localStorage.setItem(COUNTER_KEY, on ? '1' : '0');
  } catch {
    // private mode: the flag lasts for this tab only
  }
};

/** How many times this order+doc has been sent to the printer from this machine. */
export const readPrintCount = (orderId: number, doc: string): number => {
  try {
    return Number(window.localStorage.getItem(`${COUNT_PREFIX}${doc}.${orderId}`) ?? '0') || 0;
  } catch {
    return 0;
  }
};

export const bumpPrintCount = (orderId: number, doc: string): number => {
  const next = readPrintCount(orderId, doc) + 1;
  try {
    window.localStorage.setItem(`${COUNT_PREFIX}${doc}.${orderId}`, String(next));
  } catch {
    // private mode
  }
  return next;
};
