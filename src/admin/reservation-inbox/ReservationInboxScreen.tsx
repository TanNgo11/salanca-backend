import { useCallback, useEffect, useState, type ChangeEvent } from 'react';

import {
  Button,
  Flex,
  LinkButton,
  Searchbar,
  Switch,
  Table,
  Tbody,
  Td,
  Th,
  Thead,
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
  INBOX_SEARCH_DEBOUNCE_MS,
  initialListFilters,
  reservationInboxPermissions,
  reservationStatusActions,
  reservationStatusTone,
} from './reservation-inbox.helper';
import { playReservationInboxChime } from './reservation-inbox.sound';
import {
  ReservationInboxTranslationKey,
  type ReservationStatus,
  type ReservationStatusFilter,
} from './reservation-inbox.types';
import { useReservationList } from './useReservationList';

import './reservation-inbox.css';

const chipLabelKey: Record<ReservationStatus, ReservationInboxTranslationKey> = {
  new: ReservationInboxTranslationKey.ChipNew,
  read: ReservationInboxTranslationKey.ChipRead,
  archived: ReservationInboxTranslationKey.ChipArchived,
};

const ReservationInboxScreen = () => {
  const intl = useIntl();
  const { unreadCount, refresh, mode, prefs, setPrefs } = useReservationInboxContext();
  const { toggleNotification } = useNotification();
  const translate = useCallback(
    (
      key: ReservationInboxTranslationKey,
      values?: Parameters<typeof formatReservationInboxMessage>[2],
    ): string => formatReservationInboxMessage(intl, key, values),
    [intl],
  );

  const [statusFilter, setStatusFilter] = useState<ReservationStatusFilter>(
    initialListFilters.status,
  );
  const [searchInput, setSearchInput] = useState(initialListFilters.search);
  const [search, setSearch] = useState(initialListFilters.search);
  const [page, setPage] = useState(initialListFilters.page);

  useEffect(() => {
    const timer = setTimeout(() => {
      if (searchInput !== search) {
        setSearch(searchInput);
        setPage(1);
      }
    }, INBOX_SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [searchInput, search]);

  // Live arrivals change the unread count; reload so the open list stays current.
  const { result, loading, failed, setStatus } = useReservationList(
    { status: statusFilter, search, page },
    unreadCount,
  );

  const items = result?.items ?? [];
  const pageCount = result?.pageCount ?? 1;
  const counts = result?.counts ?? { new: 0, read: 0, archived: 0 };
  const hasFilters = statusFilter !== 'all' || search.trim() !== '';

  useEffect(() => {
    // The last row of the last page may have just left the filter.
    if (page > pageCount) {
      setPage(pageCount);
    }
  }, [page, pageCount]);

  const onStatusChange = (next: ReservationStatusFilter) => {
    setStatusFilter(next);
    setPage(1);
  };

  const onRowStatusChange = async (documentId: string, target: ReservationStatus) => {
    const ok = await setStatus(documentId, target);
    if (!ok) {
      toggleNotification({
        type: 'danger',
        message: translate(ReservationInboxTranslationKey.ActionFailed),
      });
      return;
    }
    // Keeps the floating pill and unread badge in step with the change.
    void refresh().catch(() => {});
  };

  const statusTabs: ReadonlyArray<{
    value: ReservationStatusFilter;
    key: ReservationInboxTranslationKey;
    count: number;
  }> = [
    { value: 'new', key: ReservationInboxTranslationKey.StatusNew, count: counts.new },
    { value: 'read', key: ReservationInboxTranslationKey.StatusRead, count: counts.read },
    {
      value: 'archived',
      key: ReservationInboxTranslationKey.StatusArchived,
      count: counts.archived,
    },
    {
      value: 'all',
      key: ReservationInboxTranslationKey.FilterAll,
      count: counts.new + counts.read + counts.archived,
    },
  ];

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
          primaryAction={
            <Flex className="reservation-inbox__prefs" gap={5}>
              <Flex alignItems="center" gap={2} tag="label">
                <Switch
                  checked={prefs.osNotify}
                  onCheckedChange={(checked: boolean) => void onOsNotifyChange(checked)}
                />
                <Typography textColor="neutral700" variant="omega">
                  {translate(ReservationInboxTranslationKey.PrefOsNotify)}
                </Typography>
              </Flex>
              <Flex alignItems="center" gap={2} tag="label">
                <Switch checked={prefs.sound} onCheckedChange={onSoundChange} />
                <Typography textColor="neutral700" variant="omega">
                  {translate(ReservationInboxTranslationKey.PrefSound)}
                </Typography>
              </Flex>
            </Flex>
          }
          subtitle={
            <Flex alignItems="center" gap={2} tag="span">
              <span className="reservation-inbox__live-dot" data-mode={mode} />
              <Typography textColor="neutral600" variant="omega">
                {statusLabel}
              </Typography>
            </Flex>
          }
          title={translate(ReservationInboxTranslationKey.Title)}
        />
        <Layouts.Content>
          <div className="reservation-inbox__card">
            <div className="reservation-inbox__toolbar">
              <Flex
                aria-label={translate(ReservationInboxTranslationKey.FilterStatusLabel)}
                gap={2}
                role="group"
                wrap="wrap"
              >
                {statusTabs.map((tab) => (
                  <Button
                    aria-pressed={statusFilter === tab.value}
                    key={tab.value}
                    onClick={() => onStatusChange(tab.value)}
                    size="S"
                    variant={statusFilter === tab.value ? 'default' : 'tertiary'}
                  >
                    {translate(tab.key, { count: tab.count })}
                  </Button>
                ))}
              </Flex>
              <div className="reservation-inbox__search">
                <Searchbar
                  clearLabel={translate(ReservationInboxTranslationKey.SearchClear)}
                  name="reservation-inbox-search"
                  onChange={(event: ChangeEvent<HTMLInputElement>) =>
                    setSearchInput(event.target.value)
                  }
                  onClear={() => setSearchInput('')}
                  placeholder={translate(ReservationInboxTranslationKey.SearchPlaceholder)}
                  size="S"
                  value={searchInput}
                >
                  {translate(ReservationInboxTranslationKey.SearchLabel)}
                </Searchbar>
              </div>
            </div>

            <div aria-busy={loading} className="reservation-inbox__table-wrap">
              <Table colCount={8} rowCount={items.length}>
                <Thead>
                  <Tr>
                    {[
                      ReservationInboxTranslationKey.ColumnCustomer,
                      ReservationInboxTranslationKey.ColumnPhone,
                      ReservationInboxTranslationKey.ColumnGuests,
                      ReservationInboxTranslationKey.ColumnDateTime,
                      ReservationInboxTranslationKey.ColumnStatus,
                      ReservationInboxTranslationKey.ColumnOverlap,
                      ReservationInboxTranslationKey.ColumnReceivedAt,
                      ReservationInboxTranslationKey.ColumnActions,
                    ].map((key) => (
                      <Th key={key}>
                        <Typography variant="omega">{translate(key)}</Typography>
                      </Th>
                    ))}
                  </Tr>
                </Thead>
                <Tbody>
                  {items.length === 0 ? (
                    <Tr>
                      <Td colSpan={8}>
                        <div className="reservation-inbox__empty">
                          <Typography
                            role={failed ? 'alert' : undefined}
                            textColor={failed ? 'danger600' : 'neutral600'}
                            variant="omega"
                          >
                            {failed
                              ? translate(ReservationInboxTranslationKey.LoadFailed)
                              : translate(
                                  hasFilters
                                    ? ReservationInboxTranslationKey.EmptyFiltered
                                    : ReservationInboxTranslationKey.Empty,
                                )}
                          </Typography>
                        </div>
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
                          <InformationStatusChip
                            color={informationStatusChipColor(
                              reservationStatusTone(item.status),
                            )}
                            label={translate(chipLabelKey[item.status])}
                          />
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
                          <Flex gap={2} wrap="wrap">
                            <LinkButton
                              size="S"
                              tag={RouterLink}
                              to={contentManagerEditPath(item.documentId)}
                              variant="secondary"
                            >
                              {translate(ReservationInboxTranslationKey.ActionOpen)}
                            </LinkButton>
                            {reservationStatusActions(item.status).map((action) => (
                              <Button
                                key={action.target}
                                onClick={() =>
                                  void onRowStatusChange(item.documentId, action.target)
                                }
                                size="S"
                                variant="tertiary"
                              >
                                {translate(action.translationKey)}
                              </Button>
                            ))}
                          </Flex>
                        </Td>
                      </Tr>
                    ))
                  )}
                </Tbody>
              </Table>
            </div>
          </div>

          {pageCount > 1 ? (
            <Flex alignItems="center" gap={3} justifyContent="flex-end" paddingTop={4}>
              <Typography textColor="neutral600" variant="omega">
                {translate(ReservationInboxTranslationKey.PaginationSummary, {
                  page,
                  pageCount,
                  total: result?.total ?? 0,
                })}
              </Typography>
              <Button
                disabled={page <= 1 || loading}
                onClick={() => setPage((current) => Math.max(1, current - 1))}
                size="S"
                variant="secondary"
              >
                {translate(ReservationInboxTranslationKey.PaginationPrev)}
              </Button>
              <Button
                disabled={page >= pageCount || loading}
                onClick={() => setPage((current) => Math.min(pageCount, current + 1))}
                size="S"
                variant="secondary"
              >
                {translate(ReservationInboxTranslationKey.PaginationNext)}
              </Button>
            </Flex>
          ) : null}
        </Layouts.Content>
      </Page.Main>
    </Page.Protect>
  );
};

export default ReservationInboxScreen;
