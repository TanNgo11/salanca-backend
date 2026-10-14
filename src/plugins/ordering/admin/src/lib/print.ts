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

/** "In hóa đơn bàn" (N7): the merged session receipt at `print/session/:sessionId`. */
export const sessionPrintUrl = (sessionId: number, width?: 58 | 80): string =>
  `${adminBase()}/plugins/ordering/print/session/${sessionId}?doc=receipt${width ? `&width=${width}` : ''}`;

/** The thermal-ticket stylesheet shared by the order and session print pages. */
export const ticketStyles = (width: 58 | 80): string => `
  @page { size: ${width}mm auto; margin: 0; }
  .print-page { background: #52525b; min-height: 100vh; padding: 12px 0; }
  .print-doc {
    width: ${width}mm; margin: 0 auto; background: #fff; color: #000;
    font-family: 'Courier New', 'Liberation Mono', monospace;
    font-size: ${width === 58 ? '11px' : '13px'}; line-height: 1.35;
    padding: 4mm 3mm; box-sizing: border-box;
  }
  .print-doc .center { text-align: center; }
  .print-doc .huge { font-size: ${width === 58 ? '24px' : '30px'}; font-weight: 700; }
  .print-doc .bold { font-weight: 700; }
  .print-doc .small { font-size: 0.85em; }
  .print-doc .hr { border-top: 1px dashed #000; margin: 6px 0; }
  .print-doc .item { font-size: ${width === 58 ? '14px' : '18px'}; margin-top: 4px; }
  .print-doc .opt { padding-left: 12px; }
  .print-doc .note { padding-left: 12px; font-style: italic; }
  .print-doc .row { display: flex; justify-content: space-between; gap: 8px; }
  .print-doc .total { font-size: ${width === 58 ? '15px' : '18px'}; font-weight: 700; }
  .print-doc .break { word-break: break-word; }
  .print-toolbar { position: sticky; top: 0; z-index: 1; display: flex; gap: 8px; justify-content: center; padding: 8px; background: #181826; }
  @media print {
    .print-page { background: #fff; padding: 0; }
    .print-toolbar { display: none !important; }
    .print-doc { margin: 0; box-shadow: none; }
  }
`;

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
