import { useEffect, useRef, useState, type ChangeEvent, type ReactNode } from 'react';

import {
  Button,
  Field,
  Flex,
  LinkButton,
  Loader,
  Modal,
  Textarea,
  Typography,
} from '@strapi/design-system';
import { useFetchClient, useNotification } from '@strapi/strapi/admin';
import { useIntl } from 'react-intl';
import { Link as RouterLink } from 'react-router-dom';

import type { ReservationInboxDetail } from '../../api/reservation-inbox/reservation-inbox.types';
import { InformationStatusChip } from '../information-status-chip/InformationStatusChip';
import { informationStatusChipColor } from '../information-status-chip/information-status-chip.helper';
import { InformationStatusChipTone } from '../information-status-chip/information-status-chip.types';
import { contentEnumOptionVietnameseTranslations } from '../translations/content-enum-options';

import {
  contentManagerEditPath,
  formatInboxReceivedAt,
  formatInboxVisitDateTime,
  reservationStatusActions,
  reservationStatusChipKey,
  reservationStatusTone,
} from './reservation-inbox.helper';
import { ReservationInboxTranslationKey, type ReservationStatus } from './reservation-inbox.types';

interface DetailEnvelope {
  data?: ReservationInboxDetail;
}

interface ReservationDetailModalProps {
  documentId: string | null;
  onClose(): void;
  onSaveNote(documentId: string, note: string): Promise<boolean>;
  onStatusChange(documentId: string, status: ReservationStatus): Promise<boolean>;
  translate(key: ReservationInboxTranslationKey, values?: Record<string, unknown>): string;
}

const DetailRow = ({ label, children }: { label: string; children: ReactNode }) => (
  <div className="reservation-detail__row">
    <Typography textColor="neutral600" variant="pi">
      {label}
    </Typography>
    <div className="reservation-detail__value">{children}</div>
  </div>
);

/**
 * Read-only view of one reservation request. Editing stays on the Content
 * Manager page, reached through the footer button.
 */
export const ReservationDetailModal = ({
  documentId,
  onClose,
  onSaveNote,
  onStatusChange,
  translate,
}: ReservationDetailModalProps) => {
  const intl = useIntl();
  const { get } = useFetchClient();
  // `get` changes identity on every render; the request depends on the id only.
  const getRef = useRef(get);
  getRef.current = get;
  const [detail, setDetail] = useState<ReservationInboxDetail | null>(null);
  const [failed, setFailed] = useState(false);
  const { toggleNotification } = useNotification();
  const [noteDraft, setNoteDraft] = useState('');
  const [savingNote, setSavingNote] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    setNoteDraft(detail?.staffNote ?? '');
  }, [detail]);

  const saveNote = async () => {
    if (!documentId) return;
    setSavingNote(true);
    const ok = await onSaveNote(documentId, noteDraft);
    setSavingNote(false);
    toggleNotification({
      type: ok ? 'success' : 'danger',
      message: translate(
        ok
          ? ReservationInboxTranslationKey.DetailStaffNoteSaved
          : ReservationInboxTranslationKey.DetailStaffNoteFailed,
      ),
    });
    if (ok) {
      setReloadKey((key) => key + 1);
    }
  };

  const changeStatus = async (target: ReservationStatus) => {
    if (!documentId) return;
    const ok = await onStatusChange(documentId, target);
    if (ok) {
      setReloadKey((key) => key + 1);
    } else {
      toggleNotification({
        type: 'danger',
        message: translate(ReservationInboxTranslationKey.ActionFailed),
      });
    }
  };

  useEffect(() => {
    if (!documentId) {
      return;
    }
    let active = true;
    setDetail(null);
    setFailed(false);
    getRef.current(`/reservation-inbox/${encodeURIComponent(documentId)}/detail`)
      .then((response) => {
        if (active) {
          setDetail((response.data as DetailEnvelope | null)?.data ?? null);
        }
      })
      .catch(() => {
        if (active) {
          setFailed(true);
        }
      });
    return () => {
      active = false;
    };
  }, [documentId, reloadKey]);

  const enumLabel = (value: string | null): string =>
    value
      ? intl.formatMessage({
          id: value,
          defaultMessage: contentEnumOptionVietnameseTranslations[value] ?? value,
        })
      : translate(ReservationInboxTranslationKey.DetailEmpty);

  const text = (value: string | null): ReactNode =>
    value ? (
      <Typography variant="omega">{value}</Typography>
    ) : (
      <Typography textColor="neutral500" variant="omega">
        {translate(ReservationInboxTranslationKey.DetailEmpty)}
      </Typography>
    );

  const names = (values: readonly string[]): ReactNode =>
    text(values.length > 0 ? values.join(', ') : null);

  const renderBody = (): ReactNode => {
    if (failed) {
      return (
        <Typography role="alert" textColor="danger600" variant="omega">
          {translate(ReservationInboxTranslationKey.DetailLoadFailed)}
        </Typography>
      );
    }
    if (!detail) {
      return (
        <Flex justifyContent="center" padding={6}>
          <Loader small>{translate(ReservationInboxTranslationKey.DetailLoading)}</Loader>
        </Flex>
      );
    }
    return (
      <div className="reservation-detail">
        <DetailRow label={translate(ReservationInboxTranslationKey.DetailFullName)}>
          {text(detail.fullName)}
        </DetailRow>
        <DetailRow label={translate(ReservationInboxTranslationKey.DetailPhone)}>
          {text(detail.phone)}
        </DetailRow>
        <DetailRow label={translate(ReservationInboxTranslationKey.DetailEmail)}>
          {text(detail.email)}
        </DetailRow>
        <DetailRow label={translate(ReservationInboxTranslationKey.DetailStatus)}>
          <InformationStatusChip
            color={informationStatusChipColor(reservationStatusTone(detail.status))}
            label={translate(reservationStatusChipKey[detail.status])}
          />
        </DetailRow>
        <DetailRow label={translate(ReservationInboxTranslationKey.DetailActions)}>
          <Flex gap={2} wrap="wrap">
            {reservationStatusActions(detail.status).map((action) => (
              <Button
                key={action.target}
                onClick={() => void changeStatus(action.target)}
                size="S"
                variant="secondary"
              >
                {translate(action.translationKey)}
              </Button>
            ))}
          </Flex>
        </DetailRow>
        <DetailRow label={translate(ReservationInboxTranslationKey.DetailVisit)}>
          {text(formatInboxVisitDateTime(detail))}
        </DetailRow>
        <DetailRow label={translate(ReservationInboxTranslationKey.DetailGuests)}>
          {text(String(detail.guestCount))}
        </DetailRow>
        <DetailRow label={translate(ReservationInboxTranslationKey.DetailOverlap)}>
          {detail.overlapCount > 0 ? (
            <InformationStatusChip
              color={informationStatusChipColor(InformationStatusChipTone.Warning)}
              label={translate(ReservationInboxTranslationKey.OverlapCount, {
                count: detail.overlapCount,
              })}
            />
          ) : (
            text(null)
          )}
        </DetailRow>
        <DetailRow label={translate(ReservationInboxTranslationKey.DetailOccasion)}>
          {text(detail.occasion)}
        </DetailRow>
        <DetailRow label={translate(ReservationInboxTranslationKey.DetailMenuMode)}>
          {text(enumLabel(detail.menuSelectionMode))}
        </DetailRow>
        <DetailRow label={translate(ReservationInboxTranslationKey.DetailPackages)}>
          {names(detail.menuPackageNames)}
        </DetailRow>
        <DetailRow label={translate(ReservationInboxTranslationKey.DetailItems)}>
          {names(detail.menuItemNames)}
        </DetailRow>
        <div className="reservation-detail__row reservation-detail__row--wide">
          <Typography textColor="neutral600" variant="pi">
            {translate(ReservationInboxTranslationKey.DetailNote)}
          </Typography>
          <div className="reservation-detail__value reservation-detail__note">
            {text(detail.note)}
          </div>
        </div>
        <div className="reservation-detail__row reservation-detail__row--wide">
          <Field.Root
            hint={translate(ReservationInboxTranslationKey.DetailStaffNoteHint)}
            name="staffNote"
          >
            <Field.Label>{translate(ReservationInboxTranslationKey.DetailStaffNote)}</Field.Label>
            <Textarea
              maxLength={2000}
              onChange={(event: ChangeEvent<HTMLTextAreaElement>) =>
                setNoteDraft(event.target.value)
              }
              value={noteDraft}
            />
            <Field.Hint />
          </Field.Root>
          <Flex justifyContent="flex-end" paddingTop={2}>
            <Button
              disabled={savingNote || noteDraft === (detail.staffNote ?? '')}
              loading={savingNote}
              onClick={() => void saveNote()}
              size="S"
            >
              {translate(ReservationInboxTranslationKey.DetailStaffNoteSave)}
            </Button>
          </Flex>
        </div>
        <DetailRow label={translate(ReservationInboxTranslationKey.DetailSourceLocale)}>
          {text(enumLabel(detail.sourceLocale))}
        </DetailRow>
        <DetailRow label={translate(ReservationInboxTranslationKey.DetailSourcePath)}>
          {text(detail.sourcePath)}
        </DetailRow>
        <DetailRow label={translate(ReservationInboxTranslationKey.DetailReceivedAt)}>
          {text(formatInboxReceivedAt(detail.createdAt))}
        </DetailRow>
      </div>
    );
  };

  return (
    <Modal.Root
      onOpenChange={(open: boolean) => {
        if (!open) {
          onClose();
        }
      }}
      open={documentId !== null}
    >
      <Modal.Content>
        <Modal.Header closeLabel={translate(ReservationInboxTranslationKey.DetailClose)}>
          <Modal.Title>{translate(ReservationInboxTranslationKey.DetailTitle)}</Modal.Title>
        </Modal.Header>
        <Modal.Body>{renderBody()}</Modal.Body>
        <Modal.Footer>
          <Modal.Close>
            <Button variant="tertiary">
              {translate(ReservationInboxTranslationKey.DetailClose)}
            </Button>
          </Modal.Close>
          {documentId ? (
            <LinkButton tag={RouterLink} to={contentManagerEditPath(documentId)}>
              {translate(ReservationInboxTranslationKey.ActionEdit)}
            </LinkButton>
          ) : null}
        </Modal.Footer>
      </Modal.Content>
    </Modal.Root>
  );
};
