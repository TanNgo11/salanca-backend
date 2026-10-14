import { useCallback, useEffect, useState } from 'react';
import { Button, EmptyStateLayout, Flex, Loader, Typography } from '@strapi/design-system';
import { useFetchClient, useRBAC } from '@strapi/strapi/admin';
import { useParams, useSearchParams } from 'react-router-dom';

import { bumpPrintCount, readPrintCount, ticketStyles } from '../../lib/print';
import { formatMoney, formatDateTime, formatTime } from '../../lib/format';
import { useT } from '../../lib/i18n';
import { RBAC_TABLES } from '../../lib/permissions';

type SessionPayload = {
  doc: 'receipt';
  width: 58 | 80;
  header: string | null;
  footer: string | null;
  session: {
    id: number;
    businessDate: string;
    openedAt: string;
    closedAt: string | null;
    table: { code: string; name: string; area: string | null } | null;
  };
  branch: { code: string; name: string; phone: string | null; timezone: string };
  orderCodes: string[];
  lines: Array<{
    title: string;
    quantity: number;
    canceledQuantity: number;
    lineTotalAmount: number;
    activeAmount?: number;
  }>;
  adjustments: Array<{ kind: string; label: string; amount: number }>;
  totals: {
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
  payments: Array<{ providerCode: string; status: string; capturedAmount: number; orderCode?: string }>;
};

const activeLineTotal = (line: {
  quantity: number;
  canceledQuantity: number;
  lineTotalAmount: number;
  activeAmount?: number;
}) =>
  line.activeAmount !== undefined
    ? line.activeAmount
    : line.quantity <= 0
    ? 0
    : Math.round((line.lineTotalAmount * (line.quantity - line.canceledQuantity)) / line.quantity);

/**
 * "In hóa đơn bàn" (screen N7): the merged provisional bill of a whole table session —
 * one thermal page, lines merged across orders, the order codes listed for cross-checking.
 */
const SessionPrintPage = () => {
  const t = useT();
  const { sessionId } = useParams<{ sessionId: string }>();
  const [params] = useSearchParams();
  const widthParam = params.get('width');
  const autoprint = params.get('autoprint') === '1';
  const { get } = useFetchClient();
  const rbac = useRBAC(RBAC_TABLES);
  const id = Number(sessionId);

  const [data, setData] = useState<SessionPayload | null>(null);
  const [failed, setFailed] = useState(false);
  const [prints, setPrints] = useState(() => (Number.isInteger(id) ? readPrintCount(id, 'session') : 0));
  const [widthChoice, setWidthChoice] = useState<58 | 80 | null>(
    widthParam === '58' ? 58 : widthParam === '80' ? 80 : null,
  );
  const width: 58 | 80 = widthChoice ?? data?.width ?? 80;
  const tz = data?.branch.timezone ?? 'Asia/Ho_Chi_Minh';

  useEffect(() => {
    if (!Number.isInteger(id)) return undefined;
    const onBefore = () => setPrints(bumpPrintCount(id, 'session'));
    window.addEventListener('beforeprint', onBefore);
    return () => window.removeEventListener('beforeprint', onBefore);
  }, [id]);

  useEffect(() => {
    if (!Number.isInteger(id)) {
      setFailed(true);
      return undefined;
    }
    let live = true;
    get(`/ordering/print/table-sessions/${id}`)
      .then(({ data: body }) => {
        if (live) setData((body as { item: SessionPayload }).item);
      })
      .catch(() => {
        if (live) setFailed(true);
      });
    return () => {
      live = false;
    };
  }, [get, id]);

  useEffect(() => {
    if (data && autoprint) window.print();
  }, [data, autoprint]);

  const close = useCallback(() => {
    window.close();
    setTimeout(() => {
      if (!window.closed && document.visibilityState === 'visible') {
        window.location.href = `${window.location.pathname.replace(/\/print\/.*$/, '')}/table-sessions`;
      }
    }, 200);
  }, []);

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
  const printedAt = formatTime(new Date().toISOString(), tz);

  return (
    <>
      <style>{ticketStyles(width)}</style>
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
          {data.header ? <div className="center break">{data.header}</div> : null}
          <div className="center bold">{data.branch.name}</div>
          {data.branch.phone ? <div className="center small">{data.branch.phone}</div> : null}
          <div className="hr" />
          {data.session.table ? (
            <div className="center huge">
              {data.session.table.name} · {data.session.table.code}
            </div>
          ) : null}
          <div className="row">
            <span>{t('print.sessionOrders')}</span>
            <span className="break">{data.orderCodes.map((code) => `#${code}`).join(' ')}</span>
          </div>
          <div className="row">
            <span>{t('sessions.opened')}</span>
            <span>{formatDateTime(data.session.openedAt, tz)}</span>
          </div>
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
            <span>{formatMoney(data.totals.subtotal)}</span>
          </div>
          {data.adjustments.map((adjustment, index) => (
            <div className="row" key={index}>
              <span className="break">{adjustment.label}</span>
              <span>{formatMoney(adjustment.amount)}</span>
            </div>
          ))}
          {data.totals.fulfillment ? (
            <div className="row">
              <span>{t('detail.fee')}</span>
              <span>{formatMoney(data.totals.fulfillment)}</span>
            </div>
          ) : null}
          {data.totals.tax ? (
            <div className="row">
              <span>{t('print.tax')}</span>
              <span>{formatMoney(data.totals.tax)}</span>
            </div>
          ) : null}
          <div className="row total">
            <span>{t('detail.total')}</span>
            <span>{formatMoney(data.totals.total)}</span>
          </div>
          {data.payments
            .filter((payment) => payment.capturedAmount > 0)
            .map((payment, index) => (
              <div className="row" key={index}>
                <span>{t('print.paidBy', { method: t(`method.${payment.providerCode}`) })}</span>
                <span>{formatMoney(payment.capturedAmount)}</span>
              </div>
            ))}
          {data.totals.refunded ? (
            <div className="row">
              <span>{t('detail.refunded')}</span>
              <span>{formatMoney(data.totals.refunded)}</span>
            </div>
          ) : null}
          {data.totals.due ? (
            <div className="row bold">
              <span>{t('detail.due')}</span>
              <span>{formatMoney(data.totals.due)}</span>
            </div>
          ) : null}
          {data.footer ? (
            <>
              <div className="hr" />
              <div className="center break">{data.footer}</div>
            </>
          ) : null}
          <div className="hr" />
          <div className="center small">{t('print.notFiscal')}</div>
          <div className="small">{t('print.printedAt', { time: printedAt, count: prints + 1 })}</div>
        </div>
      </div>
    </>
  );
};

export default SessionPrintPage;
