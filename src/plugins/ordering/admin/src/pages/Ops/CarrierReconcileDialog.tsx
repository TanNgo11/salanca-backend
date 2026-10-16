import { useState } from 'react';
import {
  Button,
  Field,
  SingleSelect,
  SingleSelectOption,
  Textarea,
  TextInput,
  Typography,
} from '@strapi/design-system';

import { useT } from '../../lib/i18n';
import { Frame } from '../Orders/OrderDialogs';

const OUTCOMES_FOR_KIND: Record<string, string[]> = {
  'carrier-book': ['booked', 'not-created'],
  'carrier-cancel': ['cancelled', 'still-booked'],
};

/**
 * "Đối soát" on the Ops board (screens V1): staff check the carrier (dashboard or API) and record
 * what really happened, so a stuck operation leaves `unknown`. The reason is mandatory and audited
 * server-side; the trip ref is required only when the booking actually went through.
 */
export const CarrierReconcileDialog = ({
  kind,
  providerCode,
  operationKey,
  busy,
  onClose,
  onSubmit,
}: {
  kind: string;
  providerCode: string;
  operationKey: string;
  busy: boolean;
  onClose: () => void;
  onSubmit: (body: {
    outcome: string;
    carrierRef?: string;
    carrierStatus?: string;
    reason: string;
  }) => void;
}) => {
  const t = useT();
  const [outcome, setOutcome] = useState('');
  const [carrierRef, setCarrierRef] = useState('');
  const [carrierStatus, setCarrierStatus] = useState('');
  const [reason, setReason] = useState('');
  const outcomes = OUTCOMES_FOR_KIND[kind] ?? [];
  const needsRef = outcome === 'booked';
  const ready =
    outcome !== '' && reason.trim().length >= 3 && (!needsRef || carrierRef.trim() !== '');
  return (
    <Frame
      title={t('ops.carrier.reconcile.title')}
      onClose={onClose}
      action={
        <Button
          loading={busy}
          disabled={!ready}
          onClick={() =>
            onSubmit({
              outcome,
              reason: reason.trim(),
              ...(needsRef ? { carrierRef: carrierRef.trim() } : {}),
              ...(carrierStatus.trim() !== '' ? { carrierStatus: carrierStatus.trim() } : {}),
            })
          }
        >
          {t('ops.carrier.reconcile.confirm')}
        </Button>
      }
    >
      <Typography variant="pi" textColor="neutral600">
        {t(kind === 'carrier-cancel' ? 'carrier.cancel' : 'carrier.call')} · {providerCode} ·{' '}
        {operationKey.slice(-8)}
      </Typography>
      <Typography variant="pi" textColor="neutral600">
        {t('ops.carrier.reconcile.hint')}
      </Typography>
      <Field.Root required>
        <Field.Label>{t('ops.carrier.reconcile.outcome')}</Field.Label>
        <SingleSelect
          value={outcome}
          onChange={(next: string | number) => setOutcome(String(next))}
          placeholder={t('ops.carrier.reconcile.pick')}
        >
          {outcomes.map((value) => (
            <SingleSelectOption key={value} value={value}>
              {t(`ops.carrier.reconcile.outcome.${value}`)}
            </SingleSelectOption>
          ))}
        </SingleSelect>
      </Field.Root>
      {needsRef ? (
        <Field.Root required>
          <Field.Label>{t('ops.carrier.reconcile.ref')}</Field.Label>
          <TextInput
            value={carrierRef}
            onChange={(event: React.ChangeEvent<HTMLInputElement>) =>
              setCarrierRef(event.target.value)
            }
          />
          <Typography variant="pi" textColor="neutral600">
            {t('ops.carrier.reconcile.refHint')}
          </Typography>
        </Field.Root>
      ) : null}
      <Field.Root>
        <Field.Label>{t('ops.carrier.reconcile.status')}</Field.Label>
        <TextInput
          value={carrierStatus}
          onChange={(event: React.ChangeEvent<HTMLInputElement>) =>
            setCarrierStatus(event.target.value)
          }
        />
      </Field.Root>
      <Field.Root required>
        <Field.Label>{t('ops.carrier.reconcile.reason')}</Field.Label>
        <Textarea
          value={reason}
          onChange={(event: React.ChangeEvent<HTMLTextAreaElement>) => setReason(event.target.value)}
        />
      </Field.Root>
    </Frame>
  );
};
