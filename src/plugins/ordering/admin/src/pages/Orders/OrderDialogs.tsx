import { useEffect, useRef, useState, type ReactNode } from 'react';
import {
  Box,
  Button,
  Field,
  Flex,
  Modal,
  NumberInput,
  SingleSelect,
  SingleSelectOption,
  Switch,
  Textarea,
  TextInput,
  Typography,
} from '@strapi/design-system';

import { formatMoney, localized } from '../../lib/format';
import { useLocale, useT } from '../../lib/i18n';
import type { InboxSettings, OrderDetail } from '../../lib/types';

/** Shared frame: "Hủy bỏ" left, the main action right (danger for destructive steps). */
export const Frame = ({
  title,
  children,
  onClose,
  action,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  action: ReactNode;
}) => {
  const t = useT();
  return (
    <Modal.Root open onOpenChange={(open: boolean) => (!open ? onClose() : undefined)}>
      <Modal.Content>
        <Modal.Header>
          <Modal.Title>{title}</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          <Flex direction="column" alignItems="stretch" gap={4}>
            {children}
          </Flex>
        </Modal.Body>
        <Modal.Footer>
          <Button variant="tertiary" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          {action}
        </Modal.Footer>
      </Modal.Content>
    </Modal.Root>
  );
};

const ReasonPicker = ({
  reasons,
  value,
  onChange,
  note,
  onNote,
}: {
  reasons: InboxSettings['rejectReasons'];
  value: string;
  onChange: (value: string) => void;
  note: string;
  onNote: (value: string) => void;
}) => {
  const t = useT();
  const locale = useLocale();
  return (
    <>
      <Field.Root required>
        <Field.Label>{t('dialog.reason')}</Field.Label>
        <SingleSelect value={value} onChange={(next: string | number) => onChange(String(next))} placeholder={t('dialog.reason.pick')}>
          {reasons.map((reason) => (
            <SingleSelectOption key={reason.code} value={reason.code}>
              {localized(reason.label, locale)}
            </SingleSelectOption>
          ))}
          <SingleSelectOption value="other">{t('dialog.reject.other')}</SingleSelectOption>
        </SingleSelect>
      </Field.Root>
      <Field.Root required={value === 'other'}>
        <Field.Label>{t('dialog.note')}</Field.Label>
        <Textarea value={note} onChange={(event: React.ChangeEvent<HTMLTextAreaElement>) => onNote(event.target.value)} />
      </Field.Root>
    </>
  );
};

const reasonReady = (code: string, note: string) => (code === 'other' ? note.trim().length >= 3 : code !== '');

/** Step with a note and the "Báo khách" switch (TastyIgniter orderstatus). */
export const TransitionDialog = ({
  to,
  isPublic,
  busy,
  onClose,
  onSubmit,
}: {
  to: string;
  isPublic: boolean;
  busy: boolean;
  onClose: () => void;
  onSubmit: (body: { note?: string; notifyCustomer: boolean }) => void;
}) => {
  const t = useT();
  const [note, setNote] = useState('');
  const [notify, setNotify] = useState(isPublic);
  return (
    <Frame
      title={t(`transition.${to}`)}
      onClose={onClose}
      action={
        <Button loading={busy} onClick={() => onSubmit({ note: note.trim() || undefined, notifyCustomer: notify })}>
          {t(`transition.${to}`)}
        </Button>
      }
    >
      <Field.Root>
        <Field.Label>{t('dialog.note')}</Field.Label>
        <Textarea value={note} onChange={(event: React.ChangeEvent<HTMLTextAreaElement>) => setNote(event.target.value)} />
      </Field.Root>
      <Flex gap={2}>
        <Switch checked={notify} onCheckedChange={setNotify} />
        <Typography>{t('dialog.notifyCustomer')}</Typography>
      </Flex>
    </Frame>
  );
};

export const RejectDialog = ({
  to,
  reasons,
  busy,
  onClose,
  onSubmit,
}: {
  to: string;
  reasons: InboxSettings['rejectReasons'];
  busy: boolean;
  onClose: () => void;
  onSubmit: (body: { to: string; reasonCode: string; note?: string }) => void;
}) => {
  const t = useT();
  const [code, setCode] = useState('');
  const [note, setNote] = useState('');
  return (
    <Frame
      title={t('dialog.reject.title')}
      onClose={onClose}
      action={
        <Button
          variant="danger"
          loading={busy}
          disabled={!reasonReady(code, note)}
          onClick={() => onSubmit({ to, reasonCode: code, note: note.trim() || undefined })}
        >
          {t('dialog.reject.confirm')}
        </Button>
      }
    >
      <ReasonPicker reasons={reasons} value={code} onChange={setCode} note={note} onNote={setNote} />
    </Frame>
  );
};

export const CancelDialog = ({
  detail,
  reasons,
  busy,
  onClose,
  onSubmit,
}: {
  detail: OrderDetail;
  reasons: InboxSettings['rejectReasons'];
  busy: boolean;
  onClose: () => void;
  onSubmit: (body: { reasonCode: string; note?: string }) => void;
}) => {
  const t = useT();
  const [code, setCode] = useState('');
  const [note, setNote] = useState('');
  const held = detail.payments
    .filter((payment) => payment.providerCode === 'cash')
    .reduce((sum, payment) => sum + payment.capturedAmount - payment.refundedAmount, 0);
  return (
    <Frame
      title={t('dialog.cancel.title', { code: detail.order.code })}
      onClose={onClose}
      action={
        <Button
          variant="danger"
          loading={busy}
          disabled={!reasonReady(code, note)}
          onClick={() => onSubmit({ reasonCode: code, note: note.trim() || undefined })}
        >
          {t('dialog.cancel.confirm')}
        </Button>
      }
    >
      <ReasonPicker reasons={reasons} value={code} onChange={setCode} note={note} onNote={setNote} />
      {held > 0 ? <Typography textColor="danger600">{t('dialog.cancel.refund', { amount: formatMoney(held) })}</Typography> : null}
    </Frame>
  );
};

/** "Thu tiền và giao" (contracts §19.3): one transaction, nothing changes on failure. */
export const CashHandoverDialog = ({
  detail,
  busy,
  onClose,
  onSubmit,
}: {
  detail: OrderDetail;
  busy: boolean;
  onClose: () => void;
  onSubmit: () => void;
}) => {
  const t = useT();
  return (
    <Frame
      title={t('dialog.cash.title')}
      onClose={onClose}
      action={
        <Button loading={busy} onClick={onSubmit}>
          {t('dialog.cash.confirm', { amount: formatMoney(detail.totals.due) })}
        </Button>
      }
    >
      <Flex justifyContent="space-between">
        <Typography>{t('dialog.cash.due')}</Typography>
        <Typography variant="beta">{formatMoney(detail.totals.due)}</Typography>
      </Flex>
      <Field.Root hint={t('dialog.cash.transferLater')}>
        <Field.Label>{t('dialog.cash.method')}</Field.Label>
        <SingleSelect value="cash" onChange={() => undefined}>
          <SingleSelectOption value="cash">{t('method.cash')}</SingleSelectOption>
          <SingleSelectOption value="bank-counter" disabled>
            {t('method.bank-counter')}
          </SingleSelectOption>
        </SingleSelect>
        <Field.Hint />
      </Field.Root>
      <Typography variant="pi" textColor="neutral600">
        {t('dialog.cash.atomic')}
      </Typography>
    </Frame>
  );
};

/** "Hủy món": the refund shown comes from the server preview (same number the write uses). */
export const LineCancelDialog = ({
  line,
  busy,
  onClose,
  onPreview,
  onSubmit,
}: {
  line: OrderDetail['lines'][number];
  busy: boolean;
  onClose: () => void;
  onPreview: (quantity: number) => Promise<{ refundAmount: number; refundShortfall: number }>;
  onSubmit: (quantity: number, reason: string) => void;
}) => {
  const t = useT();
  const remaining = line.quantity - line.canceledQuantity;
  const [quantity, setQuantity] = useState(1);
  const [reason, setReason] = useState('');
  const [preview, setPreview] = useState<{ refundAmount: number; refundShortfall: number } | null>(null);
  // The parent passes a fresh callback each render; keep the latest in a ref so the preview only
  // refetches when the quantity changes (depending on the callback looped forever).
  const previewRef = useRef(onPreview);
  previewRef.current = onPreview;
  useEffect(() => {
    let active = true;
    setPreview(null);
    previewRef
      .current(quantity)
      .then((value) => active && setPreview(value))
      .catch(() => active && setPreview(null));
    return () => {
      active = false;
    };
  }, [quantity]);
  return (
    <Frame
      title={t('dialog.line.title', { title: line.title })}
      onClose={onClose}
      action={
        <Button
          variant="danger"
          loading={busy}
          disabled={reason.trim().length < 3 || quantity < 1 || quantity > remaining}
          onClick={() => onSubmit(quantity, reason.trim())}
        >
          {t('dialog.line.confirm')}
        </Button>
      }
    >
      <Field.Root required hint={t('dialog.line.of', { remaining })}>
        <Field.Label>{t('dialog.line.quantity')}</Field.Label>
        <NumberInput value={quantity} onValueChange={(value?: number) => setQuantity(Math.max(1, Math.min(remaining, value ?? 1)))} />
        <Field.Hint />
      </Field.Root>
      <Field.Root required>
        <Field.Label>{t('dialog.reason')}</Field.Label>
        <Textarea value={reason} onChange={(event: React.ChangeEvent<HTMLTextAreaElement>) => setReason(event.target.value)} />
      </Field.Root>
      <Box>
        <Typography>
          {preview
            ? preview.refundAmount > 0
              ? t('dialog.line.refund', { amount: formatMoney(preview.refundAmount) })
              : t('dialog.line.noRefund')
            : t('common.loading')}
        </Typography>
      </Box>
    </Frame>
  );
};

/** Cash refund up to what the cash payments still hold (Vendure refund-order dialog). */
export const RefundDialog = ({
  max,
  busy,
  onClose,
  onSubmit,
}: {
  max: number;
  busy: boolean;
  onClose: () => void;
  onSubmit: (amount: number, reason: string) => void;
}) => {
  const t = useT();
  const [amount, setAmount] = useState<number | undefined>(max);
  const [reason, setReason] = useState('');
  const valid = amount !== undefined && amount > 0 && amount <= max && reason.trim().length >= 3;
  return (
    <Frame
      title={t('dialog.refund.title')}
      onClose={onClose}
      action={
        <Button variant="danger" loading={busy} disabled={!valid} onClick={() => onSubmit(amount ?? 0, reason.trim())}>
          {t('dialog.refund.confirm')}
        </Button>
      }
    >
      <Field.Root required hint={t('dialog.refund.max', { amount: formatMoney(max) })}>
        <Field.Label>{t('dialog.refund.amount')}</Field.Label>
        <NumberInput value={amount} onValueChange={setAmount} />
        <Field.Hint />
      </Field.Root>
      <Field.Root required>
        <Field.Label>{t('dialog.reason')}</Field.Label>
        <Textarea value={reason} onChange={(event: React.ChangeEvent<HTMLTextAreaElement>) => setReason(event.target.value)} />
      </Field.Root>
    </Frame>
  );
};

const REFERENCE = /^[A-Za-z0-9][A-Za-z0-9-]{3,40}$/;

/** Manual bank transfer (screens P4). Text fields only — a dropdown inside Modal freezes the page. */
export const ManualPaymentDialog = ({
  due,
  busy,
  onClose,
  onSubmit,
}: {
  due: number;
  busy: boolean;
  onClose: () => void;
  onSubmit: (body: { reference: string; amount: number; transferredAt?: string; note?: string }) => void;
}) => {
  const t = useT();
  const [reference, setReference] = useState('');
  const [amountText, setAmountText] = useState(due > 0 ? String(due) : '');
  const [when, setWhen] = useState('');
  const [note, setNote] = useState('');
  const amount = Number(amountText);
  const whenOk = when === '' || !Number.isNaN(new Date(when).getTime());
  const valid = REFERENCE.test(reference.trim()) && Number.isSafeInteger(amount) && amount > 0 && whenOk;
  return (
    <Frame
      title={t('manual.title')}
      onClose={onClose}
      action={
        <Button
          loading={busy}
          disabled={!valid}
          onClick={() =>
            onSubmit({
              reference: reference.trim(),
              amount,
              ...(when ? { transferredAt: new Date(when).toISOString() } : {}),
              ...(note.trim() ? { note: note.trim() } : {}),
            })
          }
        >
          {t('manual.submit')}
        </Button>
      }
    >
      <Field.Root required>
        <Field.Label>{t('manual.reference')}</Field.Label>
        <TextInput
          name="manual-reference"
          value={reference}
          onChange={(event: React.ChangeEvent<HTMLInputElement>) => setReference(event.target.value)}
        />
      </Field.Root>
      <Field.Root required>
        <Field.Label>{t('manual.amount')}</Field.Label>
        <TextInput
          name="manual-amount"
          type="number"
          value={amountText}
          onChange={(event: React.ChangeEvent<HTMLInputElement>) => setAmountText(event.target.value)}
        />
      </Field.Root>
      <Field.Root>
        <Field.Label>{t('manual.when')}</Field.Label>
        <TextInput
          name="manual-when"
          type="datetime-local"
          value={when}
          onChange={(event: React.ChangeEvent<HTMLInputElement>) => setWhen(event.target.value)}
        />
      </Field.Root>
      <Field.Root>
        <Field.Label>{t('manual.note')}</Field.Label>
        <Textarea
          name="manual-note"
          value={note}
          onChange={(event: React.ChangeEvent<HTMLTextAreaElement>) => setNote(event.target.value.slice(0, 500))}
        />
      </Field.Root>
    </Frame>
  );
};

/** Bank refund (screens P5a). Two buttons, not a dropdown — a menu inside Modal freezes the page. */
export const BankRefundDialog = ({
  max,
  busy,
  onClose,
  onSubmit,
}: {
  max: number;
  busy: boolean;
  onClose: () => void;
  onSubmit: (amount: number, reason: string) => void;
}) => {
  const t = useT();
  const [mode, setMode] = useState<'full' | 'partial'>('full');
  const [amount, setAmount] = useState<number | undefined>(undefined);
  const [reason, setReason] = useState('');
  const value = mode === 'full' ? max : amount;
  const valid = value !== undefined && value > 0 && value <= max && reason.trim().length >= 3;
  return (
    <Frame
      title={t('dialog.refundBank.title')}
      onClose={onClose}
      action={
        <Button variant="danger" loading={busy} disabled={!valid} onClick={() => onSubmit(value ?? 0, reason.trim())}>
          {t('dialog.refundBank.confirm')}
        </Button>
      }
    >
      <Flex gap={2}>
        <Button variant={mode === 'full' ? 'default' : 'secondary'} onClick={() => setMode('full')}>
          {t('dialog.refundBank.full')}
        </Button>
        <Button variant={mode === 'partial' ? 'default' : 'secondary'} onClick={() => setMode('partial')}>
          {t('dialog.refundBank.partial')}
        </Button>
      </Flex>
      {mode === 'partial' ? (
        <Field.Root required hint={t('dialog.refund.max', { amount: formatMoney(max) })}>
          <Field.Label>{t('dialog.refund.amount')}</Field.Label>
          <NumberInput value={amount} onValueChange={setAmount} />
          <Field.Hint />
        </Field.Root>
      ) : (
        <Typography>{t('dialog.refund.max', { amount: formatMoney(max) })}</Typography>
      )}
      <Field.Root required>
        <Field.Label>{t('dialog.reason')}</Field.Label>
        <Textarea value={reason} onChange={(event: React.ChangeEvent<HTMLTextAreaElement>) => setReason(event.target.value)} />
      </Field.Root>
    </Frame>
  );
};

/** Record the outbound transfer (screens P5b). Text fields only. */
export const SettleRefundDialog = ({
  busy,
  onClose,
  onSubmit,
}: {
  busy: boolean;
  onClose: () => void;
  onSubmit: (reference: string, settledAt?: string) => void;
}) => {
  const t = useT();
  const [reference, setReference] = useState('');
  const [when, setWhen] = useState('');
  const whenOk = when === '' || !Number.isNaN(new Date(when).getTime());
  const valid = REFERENCE.test(reference.trim()) && whenOk;
  return (
    <Frame
      title={t('dialog.settle.title')}
      onClose={onClose}
      action={
        <Button
          loading={busy}
          disabled={!valid}
          onClick={() => onSubmit(reference.trim(), when ? new Date(when).toISOString() : undefined)}
        >
          {t('dialog.settle.confirm')}
        </Button>
      }
    >
      <Field.Root required>
        <Field.Label>{t('dialog.settle.reference')}</Field.Label>
        <TextInput
          name="settle-reference"
          value={reference}
          onChange={(event: React.ChangeEvent<HTMLInputElement>) => setReference(event.target.value)}
        />
      </Field.Root>
      <Field.Root>
        <Field.Label>{t('dialog.settle.when')}</Field.Label>
        <TextInput
          name="settle-when"
          type="datetime-local"
          value={when}
          onChange={(event: React.ChangeEvent<HTMLInputElement>) => setWhen(event.target.value)}
        />
      </Field.Root>
    </Frame>
  );
};
