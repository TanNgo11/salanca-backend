import { useCallback, useEffect, useMemo, useState } from 'react';
import { Button, EmptyStateLayout, Flex, Loader, Typography } from '@strapi/design-system';
import { useFetchClient, useRBAC } from '@strapi/strapi/admin';
import { useParams, useSearchParams } from 'react-router-dom';

import { bumpPrintCount, readPrintCount } from '../../lib/print';
import { formatMoney, formatTime, formatDateTime } from '../../lib/format';
import { useT } from '../../lib/i18n';
import { RBAC_ORDERS_READ } from '../../lib/permissions';

type PrintLine = {
  title: string;
  sku: string | null;
  quantity: number;
  canceledQuantity: number;
  options: Array<{ group: string | null; name: string | null; quantity: number }>;
  note: string | null;
  unitAmount?: number;
  optionAmount?: number;
  lineTotalAmount?: number;
};

type PrintPayload = {
  doc: 'kitchen' | 'receipt';
  width: 58 | 80;
  header: string | null;
  footer: string | null;
  order: { code: string; status: string; placedAt: string; businessDate: string };
  branch: { code: string; name: string; phone: string | null; timezone: string };
  receive: { kind: string; mode: string | null; promisedAt: string | null; slot: { startsAt?: string } | null };
  lines: PrintLine[];
  customerNote: string | null;
  contact?: { name: string | null; phoneMasked: string | null };
  deliveryAddress?: { line1?: string; wardName?: string; provinceName?: string; note?: string } | null;
  adjustments?: Array<{ kind: string; label: string; amount: number }>;
  totals?: {
    currency: string;
    subtotal: number;
    adjustment: number;
    fulfillment: number;
    tax: number;
    total: number;
    paid: number;
    refunded: number;
    due: number;
  };
  payments?: Array<{ providerCode: string; status: string; capturedAmount: number; capturedAt: string | null }>;
};

const KIND_KEY: Record<string, string> = {
  pickup: 'kind.pickup',
  delivery: 'kind.delivery',
  'dine-in': 'kind.dineIn',
  dineIn: 'kind.dineIn',
};

/** `lineTotalAmount` is stored for the original quantity — prorate the units still open. */
const activeLineTotal = (line: PrintLine): number =>
  line.lineTotalAmount === undefined || line.quantity <= 0
    ? 0
    : Math.round((line.lineTotalAmount * (line.quantity - line.canceledQuantity)) / line.quantity);

/**
 * N1 standalone print page (`/plugins/ordering/print/:orderId?doc=kitchen|receipt`): thermal
 * ticket layout, no Admin frame — `App` routes it outside `Layouts.Root`. `autoprint=1` fires
 * `window.print()` once the payload lands; the reprint counter lives in localStorage on this
 * machine and shows as "lần N" at the bottom.
 */
const PrintPage = () => {
  const t = useT();
  const { orderId } = useParams<{ orderId: string }>();
  const [params] = useSearchParams();
  const doc = params.get('doc') === 'receipt' ? 'receipt' : 'kitchen';
  const widthParam = params.get('width');
  const autoprint = params.get('autoprint') === '1';
  const { get } = useFetchClient();
  const rbac = useRBAC(RBAC_ORDERS_READ);
  const id = Number(orderId);

  const [data, setData] = useState<PrintPayload | null>(null);
  const [failed, setFailed] = useState(false);
  const [prints, setPrints] = useState(() => (Number.isInteger(id) ? readPrintCount(id, doc) : 0));
  const [widthChoice, setWidthChoice] = useState<58 | 80 | null>(widthParam === '58' ? 58 : widthParam === '80' ? 80 : null);
  const width: 58 | 80 = widthChoice ?? data?.width ?? 80;
  const tz = data?.branch.timezone ?? 'Asia/Ho_Chi_Minh';

  // "lần N" = prints already sent from this machine + this one. Bumping on `beforeprint`
  // (not on click) keeps cancels from inflating the counter.
  useEffect(() => {
    if (!Number.isInteger(id)) return undefined;
    const onBefore = () => setPrints(bumpPrintCount(id, doc));
    window.addEventListener('beforeprint', onBefore);
    return () => window.removeEventListener('beforeprint', onBefore);
  }, [id, doc]);

  useEffect(() => {
    if (!Number.isInteger(id)) {
      setFailed(true);
      return undefined;
    }
    let live = true;
    get(`/ordering/print/orders/${id}?doc=${doc}`)
      .then(({ data: body }) => {
        if (live) setData((body as { item: PrintPayload }).item);
      })
      .catch(() => {
        if (live) setFailed(true);
      });
    return () => {
      live = false;
    };
  }, [get, id, doc]);

  useEffect(() => {
    if (data && autoprint) window.print();
  }, [data, autoprint]);

  const receiveLabel = useMemo(() => {
    if (!data) return '';
    const kind = t(KIND_KEY[data.receive.kind] ?? 'kind.pickup').toUpperCase();
    const promised = data.receive.slot?.startsAt ?? (data.receive.mode === 'scheduled' ? data.receive.promisedAt : null);
    if (promised) {
      return `${kind} · ${t('print.scheduled', { time: formatTime(promised, tz) })}`;
    }
    return data.receive.promisedAt
      ? `${kind} · ${t('summary.asap')} ~${formatTime(data.receive.promisedAt, tz)}`
      : `${kind} · ${t('summary.asap')}`;
  }, [data, t, tz]);

  const close = useCallback(() => {
    window.close();
    // `window.close()` only works on script-opened tabs; land back on the order otherwise.
    setTimeout(() => {
      if (!window.closed && document.visibilityState === 'visible') {
        window.location.href = `${window.location.pathname.replace(/\/print\/.*$/, '')}/orders/${id}`;
      }
    }, 200);
  }, [id]);

  if (!rbac.isLoading && !Object.values(rbac.allowedActions).some(Boolean)) {
    return <EmptyStateLayout content={t('common.forbidden.body')} />;
  }
  if (failed) {
    return (
      <EmptyStateLayout
        content={t('print.failed')}
        action={<Button onClick={() => window.location.reload()}>{t('common.retry')}</Button>}
      />
    );
  }
  if (!data) {
    return (
      <Flex direction="column" gap={2} alignItems="center" padding={10}>
        <Loader />
        <Typography variant="pi" textColor="neutral500">
          {t('print.notReady')}
        </Typography>
      </Flex>
    );
  }

  const openLines = data.lines.filter((line) => line.quantity - line.canceledQuantity > 0);
  const addressLine = data.deliveryAddress
    ? [data.deliveryAddress.line1, data.deliveryAddress.wardName, data.deliveryAddress.provinceName]
        .filter(Boolean)
        .join(', ')
    : null;
  const printedAt = formatTime(new Date().toISOString(), tz);

  return (
    <>
      <style>{`
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
      `}</style>
      <div className="print-page">
        <div className="print-toolbar">
          <Button onClick={() => window.print()}>{t('print.print')}</Button>
          {([58, 80] as const).map((option) => (
            <Button key={option} variant={width === option ? 'default' : 'tertiary'} onClick={() => setWidthChoice(option)}>
              {option}mm
            </Button>
          ))}
          <Button variant="tertiary" onClick={close}>
            {t('common.close')}
          </Button>
        </div>

        <div className="print-doc">
          {doc === 'kitchen' ? (
            <>
              <div className="center bold">{data.branch.name.toUpperCase()}</div>
              <div className="center huge">#{data.order.code}</div>
              <div className="center">{receiveLabel}</div>
              <div className="hr" />
              {openLines.map((line, index) => (
                <div key={index}>
                  <div className="item">
                    <b>{line.quantity - line.canceledQuantity}</b> {line.title}
                  </div>
                  {line.options.map((option, optionIndex) => (
                    <div className="opt" key={optionIndex}>
                      + {option.name ?? option.group}
                      {option.quantity > 1 ? ` x${option.quantity}` : ''}
                    </div>
                  ))}
                  {line.note ? <div className="note">{line.note}</div> : null}
                </div>
              ))}
              {data.customerNote ? (
                <>
                  <div className="hr" />
                  <div className="break">{data.customerNote}</div>
                </>
              ) : null}
              <div className="hr" />
              <div className="small">{t('print.printedAt', { time: printedAt, count: prints + 1 })}</div>
            </>
          ) : (
            <>
              {data.header ? <div className="center break">{data.header}</div> : null}
              <div className="center bold">{data.branch.name}</div>
              {data.branch.phone ? <div className="center small">{data.branch.phone}</div> : null}
              <div className="hr" />
              <div className="row">
                <span className="bold">#{data.order.code}</span>
                <span>{formatDateTime(data.order.placedAt, tz)}</span>
              </div>
              {data.contact?.name || data.contact?.phoneMasked ? (
                <div className="row">
                  <span>{data.contact?.name ?? ''}</span>
                  <span>{data.contact?.phoneMasked ?? ''}</span>
                </div>
              ) : null}
              {addressLine ? <div className="small break">{addressLine}</div> : null}
              {data.deliveryAddress?.note ? <div className="small note">{data.deliveryAddress.note}</div> : null}
              <div className="hr" />
              {openLines.map((line, index) => (
                <div className="row" key={index}>
                  <span className="break">
                    {line.quantity - line.canceledQuantity} × {line.title}
                  </span>
                  <span>{formatMoney(activeLineTotal(line))}</span>
                </div>
              ))}
              <div className="hr" />
              <div className="row">
                <span>{t('detail.subtotal')}</span>
                <span>{formatMoney(data.totals?.subtotal)}</span>
              </div>
              {(data.adjustments ?? []).map((adjustment, index) => (
                <div className="row" key={index}>
                  <span className="break">{adjustment.label}</span>
                  <span>{formatMoney(adjustment.amount)}</span>
                </div>
              ))}
              {data.totals?.fulfillment ? (
                <div className="row">
                  <span>{t('detail.fee')}</span>
                  <span>{formatMoney(data.totals.fulfillment)}</span>
                </div>
              ) : null}
              {data.totals?.tax ? (
                <div className="row">
                  <span>{t('print.tax')}</span>
                  <span>{formatMoney(data.totals.tax)}</span>
                </div>
              ) : null}
              <div className="row total">
                <span>{t('detail.total')}</span>
                <span>{formatMoney(data.totals?.total)}</span>
              </div>
              {(data.payments ?? [])
                .filter((payment) => payment.capturedAmount > 0)
                .map((payment, index) => (
                  <div className="row" key={index}>
                    <span>{t('print.paidBy', { method: t(`method.${payment.providerCode}`) })}</span>
                    <span>{formatMoney(payment.capturedAmount)}</span>
                  </div>
                ))}
              {data.totals?.refunded ? (
                <div className="row">
                  <span>{t('detail.refunded')}</span>
                  <span>{formatMoney(data.totals.refunded)}</span>
                </div>
              ) : null}
              {data.totals?.due ? (
                <div className="row bold">
                  <span>{t('detail.due')}</span>
                  <span>{formatMoney(data.totals.due)}</span>
                </div>
              ) : null}
              {data.customerNote ? <div className="small break">{data.customerNote}</div> : null}
              {data.footer ? (
                <>
                  <div className="hr" />
                  <div className="center break">{data.footer}</div>
                </>
              ) : null}
              <div className="hr" />
              <div className="center small">{t('print.notFiscal')}</div>
              <div className="small">{t('print.printedAt', { time: printedAt, count: prints + 1 })}</div>
            </>
          )}
        </div>
      </div>
    </>
  );
};

export default PrintPage;
