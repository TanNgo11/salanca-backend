import { useState } from 'react';
import {
  Button,
  Field,
  Flex,
  SingleSelect,
  SingleSelectOption,
  Switch,
  Textarea,
  TextInput,
  Typography,
} from '@strapi/design-system';

import { formatMoney } from '../../lib/format';
import { useT } from '../../lib/i18n';
import type { DeliveryStaff } from '../../lib/types';
import { Frame } from '../Orders/OrderDialogs';

const FAILURE_REASONS = ['unreachable', 'wrong-address', 'refused', 'other'] as const;

/**
 * "Gán người giao" (screens D3): an in-house courier or an outside vehicle with carrier/tracking —
 * both dispatch `ready → out-for-delivery`. Button variants pick the mode so no dropdown opens
 * inside the Modal.
 */
export const AssignDialog = ({
  staff,
  staffLoading,
  busy,
  onClose,
  onSubmit,
}: {
  staff: DeliveryStaff[] | null;
  staffLoading: boolean;
  busy: boolean;
  onClose: () => void;
  onSubmit: (body: Record<string, unknown>) => void;
}) => {
  const t = useT();
  const [mode, setMode] = useState<'staff' | 'external'>('staff');
  const [ref, setRef] = useState('');
  const [carrier, setCarrier] = useState('');
  const [number, setNumber] = useState('');
  const [url, setUrl] = useState('');
  const [notify, setNotify] = useState(true);
  const urlOk = !url.trim() || /^https?:\/\/\S+$/.test(url.trim());
  const ready =
    mode === 'staff'
      ? ref !== ''
      : carrier.trim() !== '' && number.trim() !== '' && urlOk;
  const submit = () =>
    onSubmit(
      mode === 'staff'
        ? { to: 'out-for-delivery', assigneeRef: ref, notifyCustomer: notify }
        : {
            to: 'out-for-delivery',
            tracking: {
              carrier: carrier.trim(),
              number: number.trim(),
              url: url.trim() || undefined,
            },
            notifyCustomer: notify,
          },
    );
  return (
    <Frame
      title={t('deliveries.assign.title')}
      onClose={onClose}
      action={
        <Button loading={busy} disabled={!ready} onClick={submit}>
          {t('deliveries.assign.confirm')}
        </Button>
      }
    >
      <Flex gap={2}>
        <Button
          variant={mode === 'staff' ? 'default' : 'secondary'}
          onClick={() => setMode('staff')}
        >
          {t('deliveries.assign.staff')}
        </Button>
        <Button
          variant={mode === 'external' ? 'default' : 'secondary'}
          onClick={() => setMode('external')}
        >
          {t('deliveries.assign.external')}
        </Button>
      </Flex>
      {mode === 'staff' ? (
        <Field.Root required>
          <Field.Label>{t('deliveries.assign.courier')}</Field.Label>
          <SingleSelect
            value={ref}
            onChange={(next: string | number) => setRef(String(next))}
            placeholder={t('deliveries.assign.pick')}
            disabled={staffLoading}
          >
            {(staff ?? []).map((member) => (
              <SingleSelectOption key={member.ref} value={member.ref}>
                {member.name}
              </SingleSelectOption>
            ))}
          </SingleSelect>
          {!staffLoading && (staff ?? []).length === 0 ? (
            <Typography variant="pi" textColor="warning600">
              {t('deliveries.assign.noStaff')}
            </Typography>
          ) : null}
        </Field.Root>
      ) : (
        <>
          <Field.Root required>
            <Field.Label>{t('deliveries.assign.carrier')}</Field.Label>
            <TextInput
              value={carrier}
              onChange={(event: React.ChangeEvent<HTMLInputElement>) => setCarrier(event.target.value)}
              placeholder={t('deliveries.assign.carrierHint')}
            />
          </Field.Root>
          <Field.Root required>
            <Field.Label>{t('deliveries.assign.tracking')}</Field.Label>
            <TextInput
              value={number}
              onChange={(event: React.ChangeEvent<HTMLInputElement>) => setNumber(event.target.value)}
            />
          </Field.Root>
          <Field.Root>
            <Field.Label>{t('deliveries.assign.trackingUrl')}</Field.Label>
            <TextInput
              value={url}
              onChange={(event: React.ChangeEvent<HTMLInputElement>) => setUrl(event.target.value)}
              placeholder="https://…"
            />
            {!urlOk ? (
              <Typography variant="pi" textColor="danger600">
                {t('deliveries.assign.urlInvalid')}
              </Typography>
            ) : null}
          </Field.Root>
        </>
      )}
      <Flex gap={2}>
        <Switch checked={notify} onCheckedChange={setNotify} />
        <Typography>{t('dialog.notifyCustomer')}</Typography>
      </Flex>
    </Frame>
  );
};

/** "Giao thất bại": the courier reports why the drop-off did not happen (screens D2). */
export const FailDialog = ({
  busy,
  onClose,
  onSubmit,
}: {
  busy: boolean;
  onClose: () => void;
  onSubmit: (body: { to: string; reasonCode: string; note?: string; notifyCustomer: boolean }) => void;
}) => {
  const t = useT();
  const [code, setCode] = useState('');
  const [note, setNote] = useState('');
  const [notify, setNotify] = useState(true);
  const ready = code === 'other' ? note.trim().length >= 3 : code !== '';
  return (
    <Frame
      title={t('deliveries.fail.title')}
      onClose={onClose}
      action={
        <Button
          variant="danger"
          loading={busy}
          disabled={!ready}
          onClick={() =>
            onSubmit({
              to: 'failed',
              reasonCode: code,
              note: note.trim() || undefined,
              notifyCustomer: notify,
            })
          }
        >
          {t('deliveries.fail.confirm')}
        </Button>
      }
    >
      <Field.Root required>
        <Field.Label>{t('dialog.reason')}</Field.Label>
        <SingleSelect
          value={code}
          onChange={(next: string | number) => setCode(String(next))}
          placeholder={t('dialog.reason.pick')}
        >
          {FAILURE_REASONS.map((reason) => (
            <SingleSelectOption key={reason} value={reason}>
              {t(`deliveries.failReason.${reason}`)}
            </SingleSelectOption>
          ))}
        </SingleSelect>
      </Field.Root>
      <Field.Root required={code === 'other'}>
        <Field.Label>{t('dialog.note')}</Field.Label>
        <Textarea
          value={note}
          onChange={(event: React.ChangeEvent<HTMLTextAreaElement>) => setNote(event.target.value)}
        />
      </Field.Root>
      <Flex gap={2}>
        <Switch checked={notify} onCheckedChange={setNotify} />
        <Typography>{t('dialog.notifyCustomer')}</Typography>
      </Flex>
    </Frame>
  );
};

/**
 * O13 "Gọi xe" (screens P2): quotes the carrier on open, shows the carrier fee next to the
 * customer-paid fee and the COD the courier must collect, then books once. Booking is
 * idempotent server-side — a double click cannot create two trips.
 */
export const CarrierDialog = ({
  quote,
  quoteError,
  quoteLoading,
  busy,
  onClose,
  onSubmit,
}: {
  quote: {
    providerCode: string;
    quotes: Array<{ serviceId: string; fee: { amount: number } }>;
    due: number;
    customerFee: number;
  } | null;
  quoteError: boolean;
  quoteLoading: boolean;
  busy: boolean;
  onClose: () => void;
  onSubmit: (body: { serviceId?: string; note?: string }) => void;
}) => {
  const t = useT();
  const [note, setNote] = useState('');
  const first = quote?.quotes[0] ?? null;
  return (
    <Frame
      title={t('carrier.title')}
      onClose={onClose}
      action={
        <Button
          loading={busy}
          disabled={!first}
          onClick={() =>
            onSubmit({
              ...(first ? { serviceId: first.serviceId } : {}),
              ...(note.trim() ? { note: note.trim().slice(0, 200) } : {}),
            })
          }
        >
          {t('carrier.call')}
        </Button>
      }
    >
      {quoteLoading ? <Typography>{t('carrier.quoteLoading')}</Typography> : null}
      {quoteError ? (
        <Typography variant="pi" textColor="danger600">
          {t('carrier.quoteFailed')}
        </Typography>
      ) : null}
      {first ? (
        <>
          <Flex justifyContent="space-between">
            <Typography>{t('carrier.service')}</Typography>
            <Typography fontWeight="semiBold">
              {quote?.providerCode} · {first.serviceId}
            </Typography>
          </Flex>
          <Flex justifyContent="space-between">
            <Typography>{t('carrier.fee')}</Typography>
            <Typography variant="beta">{formatMoney(first.fee.amount)}</Typography>
          </Flex>
          <Flex justifyContent="space-between">
            <Typography>{t('carrier.customerFee')}</Typography>
            <Typography>{formatMoney(quote?.customerFee ?? 0)}</Typography>
          </Flex>
          {(quote?.due ?? 0) > 0 ? (
            <Flex justifyContent="space-between">
              <Typography>{t('carrier.due')}</Typography>
              <Typography>{formatMoney(quote?.due ?? 0)}</Typography>
            </Flex>
          ) : null}
          <Field.Root>
            <Field.Label>{t('dialog.note')}</Field.Label>
            <Textarea
              value={note}
              onChange={(event: React.ChangeEvent<HTMLTextAreaElement>) => setNote(event.target.value)}
            />
          </Field.Root>
        </>
      ) : null}
    </Frame>
  );
};

/** Hủy chuyến đối tác while it is still searching for a driver (screens P2). */
export const CarrierCancelDialog = ({
  busy,
  onClose,
  onSubmit,
}: {
  busy: boolean;
  onClose: () => void;
  onSubmit: () => void;
}) => {
  const t = useT();
  return (
    <Frame
      title={t('carrier.cancel')}
      onClose={onClose}
      action={
        <Button variant="danger" loading={busy} onClick={onSubmit}>
          {t('carrier.cancel')}
        </Button>
      }
    >
      <Typography>{t('carrier.cancelConfirm')}</Typography>
    </Frame>
  );
};

/** "Thu tiền và giao" at the door: one confirm, the leg lands `delivered` (screens D2). */
export const CollectDialog = ({
  due,
  busy,
  onClose,
  onSubmit,
}: {
  due: number;
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
          {t('dialog.cash.confirm', { amount: formatMoney(due) })}
        </Button>
      }
    >
      <Flex justifyContent="space-between">
        <Typography>{t('dialog.cash.due')}</Typography>
        <Typography variant="beta">{formatMoney(due)}</Typography>
      </Flex>
      <Typography variant="pi" textColor="neutral600">
        {t('deliveries.collect.hint')}
      </Typography>
    </Frame>
  );
};
