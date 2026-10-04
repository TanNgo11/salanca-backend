import { useCallback, type ChangeEvent } from 'react';

import {
  Button,
  Flex,
  LinkButton,
  Table,
  Tbody,
  Td,
  Th,
  Thead,
  Toggle,
  Tr,
  Typography,
} from '@strapi/design-system';
import { Layouts, Page, useNotification } from '@strapi/strapi/admin';
import { useIntl } from 'react-intl';
import { Link as RouterLink } from 'react-router-dom';

import { InformationStatusChip } from '../information-status-chip/InformationStatusChip';
import { informationStatusChipColor } from '../information-status-chip/information-status-chip.helper';
import { InformationStatusChipTone } from '../information-status-chip/information-status-chip.types';

import { useReservationInboxContext } from './reservation-inbox.context';
import {
  contentManagerEditPath,
  formatInboxReceivedAt,
  formatInboxVisitDateTime,
  formatReservationInboxMessage,
  reservationInboxPermissions,
} from './reservation-inbox.helper';
import { playReservationInboxChime } from './reservation-inbox.sound';
import { ReservationInboxTranslationKey } from './reservation-inbox.types';

import './reservation-inbox.css';

const ReservationInboxScreen = () => {
  const intl = useIntl();
  const { items, markRead, mode, prefs, setPrefs } = useReservationInboxContext();
  const { toggleNotification } = useNotification();
  const translate = useCallback(
    (
      key: ReservationInboxTranslationKey,
      values?: Parameters<typeof formatReservationInboxMessage>[2],
    ): string => formatReservationInboxMessage(intl, key, values),
    [intl],
  );

  const onOsNotifyChange = async (checked: boolean) => {
    if (!checked) {
      setPrefs({ ...prefs, osNotify: false });
      return;
    }
    if (typeof Notification === 'undefined') {
      toggleNotification({
        type: 'warning',
        message: translate(ReservationInboxTranslationKey.OsNotifyDenied),
      });
      return;
    }
    try {
      const result = await Notification.requestPermission();
      if (result === 'granted') {
        setPrefs({ ...prefs, osNotify: true });
      } else {
        setPrefs({ ...prefs, osNotify: false });
        toggleNotification({
          type: 'warning',
          message: translate(ReservationInboxTranslationKey.OsNotifyDenied),
        });
      }
    } catch {
      toggleNotification({
        type: 'warning',
        message: translate(ReservationInboxTranslationKey.OsNotifyDenied),
      });
    }
  };

  const onSoundChange = (checked: boolean) => {
    setPrefs({ ...prefs, sound: checked });
    if (checked) {
      playReservationInboxChime();
    }
  };

  const statusLabel =
    mode === 'stream'
      ? translate(ReservationInboxTranslationKey.StatusStream)
      : translate(ReservationInboxTranslationKey.StatusPolling);

  return (
    <Page.Protect permissions={reservationInboxPermissions.read}>
      <Page.Title>{translate(ReservationInboxTranslationKey.Title)}</Page.Title>
      <Page.Main className="reservation-inbox">
        <Layouts.Header
          subtitle={statusLabel}
          title={translate(ReservationInboxTranslationKey.Title)}
        />
        <Layouts.Content>
          <div className="reservation-inbox__panel">
            <Flex direction="column" alignItems="flex-start" gap={4}>
              <Flex alignItems="center" gap={3}>
                <Toggle
                  checked={prefs.osNotify}
                  offLabel={translate(ReservationInboxTranslationKey.ToggleOff)}
                  onChange={(event: ChangeEvent<HTMLInputElement>) =>
                    void onOsNotifyChange(event.target.checked)
                  }
                  onLabel={translate(ReservationInboxTranslationKey.ToggleOn)}
                  aria-label={translate(ReservationInboxTranslationKey.PrefOsNotify)}
                />
                <Typography textColor="neutral700" variant="omega">
                  {translate(ReservationInboxTranslationKey.PrefOsNotify)}
                </Typography>
              </Flex>
              <Flex alignItems="center" gap={3}>
                <Toggle
                  checked={prefs.sound}
                  offLabel={translate(ReservationInboxTranslationKey.ToggleOff)}
                  onChange={(event: ChangeEvent<HTMLInputElement>) =>
                    onSoundChange(event.target.checked)
                  }
                  onLabel={translate(ReservationInboxTranslationKey.ToggleOn)}
                  aria-label={translate(ReservationInboxTranslationKey.PrefSound)}
                />
                <Typography textColor="neutral700" variant="omega">
                  {translate(ReservationInboxTranslationKey.PrefSound)}
                </Typography>
              </Flex>
            </Flex>
          </div>

          <div className="reservation-inbox__table-wrap">
            <Table colCount={7} rowCount={items.length}>
              <Thead>
                <Tr>
                  <Th>
                    <Typography variant="omega">
                      {translate(ReservationInboxTranslationKey.ColumnCustomer)}
                    </Typography>
                  </Th>
                  <Th>
                    <Typography variant="omega">
                      {translate(ReservationInboxTranslationKey.ColumnPhone)}
                    </Typography>
                  </Th>
                  <Th>
                    <Typography variant="omega">
                      {translate(ReservationInboxTranslationKey.ColumnGuests)}
                    </Typography>
                  </Th>
                  <Th>
                    <Typography variant="omega">
                      {translate(ReservationInboxTranslationKey.ColumnDateTime)}
                    </Typography>
                  </Th>
                  <Th>
                    <Typography variant="omega">
                      {translate(ReservationInboxTranslationKey.ColumnOverlap)}
                    </Typography>
                  </Th>
                  <Th>
                    <Typography variant="omega">
                      {translate(ReservationInboxTranslationKey.ColumnReceivedAt)}
                    </Typography>
                  </Th>
                  <Th>
                    <Typography variant="omega">
                      {translate(ReservationInboxTranslationKey.ColumnActions)}
                    </Typography>
                  </Th>
                </Tr>
              </Thead>
              <Tbody>
                {items.length === 0 ? (
                  <Tr>
                    <Td colSpan={7}>
                      <Typography textColor="neutral600" variant="omega">
                        {translate(ReservationInboxTranslationKey.Empty)}
                      </Typography>
                    </Td>
                  </Tr>
                ) : (
                  items.map((item) => (
                    <Tr key={item.documentId}>
                      <Td>
                        <Typography fontWeight="semiBold" variant="omega">
                          {item.fullName}
                        </Typography>
                      </Td>
                      <Td>
                        <Typography variant="omega">{item.phone}</Typography>
                      </Td>
                      <Td>
                        <Typography variant="omega">{item.guestCount}</Typography>
                      </Td>
                      <Td>
                        <Typography variant="omega">
                          {formatInboxVisitDateTime(item)}
                        </Typography>
                      </Td>
                      <Td>
                        {item.overlapCount > 0 ? (
                          <InformationStatusChip
                            color={informationStatusChipColor(
                              InformationStatusChipTone.Warning,
                            )}
                            label={translate(
                              ReservationInboxTranslationKey.OverlapCount,
                              { count: item.overlapCount },
                            )}
                          />
                        ) : (
                          <Typography textColor="neutral600" variant="omega">
                            —
                          </Typography>
                        )}
                      </Td>
                      <Td>
                        <Typography variant="omega">
                          {formatInboxReceivedAt(item.createdAt)}
                        </Typography>
                      </Td>
                      <Td>
                        <Flex gap={2}>
                          <LinkButton
                            size="S"
                            tag={RouterLink}
                            to={contentManagerEditPath(item.documentId)}
                            variant="secondary"
                          >
                            {translate(ReservationInboxTranslationKey.ActionOpen)}
                          </LinkButton>
                          <Button
                            onClick={() => void markRead(item.documentId)}
                            size="S"
                            variant="tertiary"
                          >
                            {translate(ReservationInboxTranslationKey.ActionMarkRead)}
                          </Button>
                        </Flex>
                      </Td>
                    </Tr>
                  ))
                )}
              </Tbody>
            </Table>
          </div>
        </Layouts.Content>
      </Page.Main>
    </Page.Protect>
  );
};

export default ReservationInboxScreen;
