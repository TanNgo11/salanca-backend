import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Badge,
  Box,
  Button,
  Dialog,
  Divider,
  Field,
  Flex,
  Loader,
  NumberInput,
  SingleSelect,
  SingleSelectOption,
  Table,
  Tbody,
  Td,
  TextInput,
  Th,
  Thead,
  Toggle,
  Tr,
  Typography,
} from '@strapi/design-system';
import { useFetchClient, useNotification } from '@strapi/strapi/admin';
import { useIntl } from 'react-intl';

import { PLUGIN_ID } from '../../pluginId';

type BranchOption = { code: string; name: string; timezone?: string; isActive: boolean };

type EntityType = 'product' | 'variant' | 'modifier';

type Row = {
  entityType: EntityType;
  entityDocumentId: string;
  label: string;
  selling: boolean;
  outOfStockUntil: string | null;
  untilKind: string | null;
  toggledBy: string | null;
  toggledAt: string | null;
  dailyLimit: number | null;
  reservedToday: number | null;
  remainingToday: number | null;
};

type OffDialog = { row: Row } | null;

/** A state row blocks selling until `outOfStockUntil`; no timestamp means indefinite. */
const isBlockedNow = (row: Row): boolean =>
  row.selling === false &&
  (row.outOfStockUntil === null || Date.parse(row.outOfStockUntil) > Date.now());

const rowKey = (row: Row): string => `${row.entityType}:${row.entityDocumentId}`;

/** Design system has no ProgressBar in this Strapi build, so the ratio is a thin bar. */
const PortionBar = ({
  reserved,
  limit,
  soldOut,
  low,
}: {
  reserved: number;
  limit: number;
  soldOut: boolean;
  low: boolean;
}) => {
  const pct = limit <= 0 ? 100 : Math.max(0, Math.min(100, Math.round((reserved / limit) * 100)));
  return (
    <Box background="neutral200" hasRadius style={{ width: 96, height: 6, overflow: 'hidden' }}>
      <Box
        background={soldOut ? 'danger600' : low ? 'warning600' : 'primary600'}
        style={{ width: `${pct}%`, height: 6 }}
      />
    </Box>
  );
};

const fmtUntil = (row: Row, t: (k: string, f: string, v?: Record<string, unknown>) => string): string => {
  if (row.outOfStockUntil === null) return '—';
  if (row.untilKind === 'end-of-business-day') return t('until.eod', 'Hết ngày kinh doanh');
  const at = new Date(row.outOfStockUntil);
  return at.toLocaleString('vi-VN', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit' });
};

/**
 * "Tạm hết món" screen (plan step 8 / mockup 5): branch select limited to the staff
 * member's scope, a flat product/variant/modifier table, and Còn/Hết toggles that write
 * `catalog-location-state` through the guarded admin route.
 */
const AvailabilityPage = () => {
  const { formatMessage } = useIntl();
  const { get, post, put } = useFetchClient();
  const { toggleNotification } = useNotification();

  const [branches, setBranches] = useState<BranchOption[]>([]);
  const [locationRef, setLocationRef] = useState<string>('');
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [tab, setTab] = useState<'all' | 'off'>('all');
  const [dialog, setDialog] = useState<OffDialog>(null);
  const [untilKind, setUntilKind] = useState<'end-of-business-day' | 'specific-time'>(
    'end-of-business-day',
  );
  const [untilTime, setUntilTime] = useState('14:00');
  const [busy, setBusy] = useState(false);
  const [onlyLimited, setOnlyLimited] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [draftLimit, setDraftLimit] = useState<number | undefined>(undefined);
  const [missingBranch, setMissingBranch] = useState(false);

  const t = useCallback(
    (key: string, fallback: string, values?: Record<string, unknown>) =>
      formatMessage({ id: `${PLUGIN_ID}.availability.${key}`, defaultMessage: fallback }, values),
    [formatMessage],
  );

  const notifyError = useCallback(
    (error: unknown) => {
      const api = (error as { response?: { data?: { error?: { code?: string; message?: string } } } })
        ?.response?.data?.error;
      toggleNotification({
        type: 'danger',
        message:
          api?.code === 'SCOPE_REQUIRED'
            ? t('error.scope', 'Chi nhánh này ngoài phạm vi của bạn')
            : api?.message ?? t('error.generic', 'Thao tác thất bại, thử lại sau'),
      });
    },
    [t, toggleNotification],
  );

  const loadRows = useCallback(
    async (code: string) => {
      try {
        const { data } = await get(`/${PLUGIN_ID}/availability?locationRef=${encodeURIComponent(code)}`);
        setRows(Array.isArray(data?.items) ? data.items : []);
        setMissingBranch(false);
      } catch (error) {
        const api = (error as { response?: { data?: { error?: { code?: string } } } })?.response?.data
          ?.error;
        if (api?.code === 'BRANCH_NOT_FOUND') {
          setRows([]);
          setMissingBranch(true);
          return;
        }
        throw error;
      }
    },
    [get],
  );

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { data } = await get(`/${PLUGIN_ID}/availability/locations`);
        const items = (Array.isArray(data?.items) ? data.items : []) as BranchOption[];
        if (cancelled) return;
        setBranches(items);
        const first = items[0]?.code;
        if (first) {
          setLocationRef(first);
          await loadRows(first);
        }
      } catch (error) {
        if (!cancelled) notifyError(error);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [get, loadRows, notifyError]);

  const switchBranch = async (code: string) => {
    setLocationRef(code);
    setLoading(true);
    try {
      await loadRows(code);
    } catch (error) {
      notifyError(error);
    } finally {
      setLoading(false);
    }
  };

  const toggle = async (row: Row, body: Record<string, unknown>) => {
    setBusy(true);
    try {
      await post(`/${PLUGIN_ID}/availability/toggle`, {
        entityType: row.entityType,
        entityDocumentId: row.entityDocumentId,
        locationRef,
        ...body,
      });
      await loadRows(locationRef);
    } catch (error) {
      notifyError(error);
    } finally {
      setBusy(false);
      setDialog(null);
    }
  };

  const beginEdit = (row: Row) => {
    setEditing(rowKey(row));
    setDraftLimit(row.dailyLimit === null ? undefined : row.dailyLimit);
  };

  const saveLimit = async (row: Row) => {
    setBusy(true);
    try {
      await put(`/${PLUGIN_ID}/availability/daily-limit`, {
        entityType: row.entityType,
        entityDocumentId: row.entityDocumentId,
        locationRef,
        dailyLimit: draftLimit === undefined ? null : draftLimit,
      });
      toggleNotification({ type: 'success', message: t('saved', 'Đã lưu giới hạn') });
      setEditing(null);
      await loadRows(locationRef);
    } catch (error) {
      const api = (error as { response?: { data?: { error?: { code?: string } } } })?.response?.data
        ?.error;
      if (api?.code === 'BRANCH_NOT_FOUND') setMissingBranch(true);
      else notifyError(error);
    } finally {
      setBusy(false);
    }
  };

  const onToggle = (row: Row, checked: boolean) => {
    if (checked) {
      void toggle(row, { selling: true });
    } else {
      setUntilKind('end-of-business-day');
      setDialog({ row });
    }
  };

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows
      .filter((row) => (tab === 'off' ? isBlockedNow(row) : true))
      .filter((row) => (onlyLimited ? row.dailyLimit !== null : true))
      .filter((row) => q === '' || row.label.toLowerCase().includes(q));
  }, [rows, query, tab, onlyLimited]);

  const offCount = useMemo(() => rows.filter(isBlockedNow).length, [rows]);
  const kindLabel = (type: EntityType) =>
    type === 'product' ? t('kind.product', 'Món') : type === 'variant' ? t('kind.variant', 'Biến thể') : t('kind.modifier', 'Tùy chọn');
  const fmtActor = (row: Row): string => {
    if (!row.toggledBy || !row.toggledAt) return '—';
    const at = new Date(row.toggledAt);
    return `${row.toggledBy.replace(/^admin:/, '')} · ${at.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })}`;
  };

  return (
    <Box padding={8}>
      <Flex justifyContent="space-between" alignItems="flex-start" gap={4}>
        <Box>
          <Typography variant="alpha" tag="h1">
            {t('title', 'Tạm hết món')}
          </Typography>
          <Typography variant="epsilon" textColor="neutral600">
            {t('subtitle', 'Chi nhánh trong phạm vi của bạn')}
          </Typography>
        </Box>
        <SingleSelect
          aria-label={t('branch', 'Chi nhánh')}
          value={locationRef}
          onChange={(value: string | number) => void switchBranch(String(value))}
        >
          {branches.map((branch) => (
            <SingleSelectOption key={branch.code} value={branch.code}>
              {`${t('branch', 'Chi nhánh')}: ${branch.name || branch.code}`}
            </SingleSelectOption>
          ))}
        </SingleSelect>
      </Flex>

      <Flex gap={4} paddingTop={4} alignItems="center">
        <TextInput
          aria-label={t('search', 'Tìm món, topping…')}
          placeholder={t('search', 'Tìm món, topping…')}
          value={query}
          onChange={(event: React.ChangeEvent<HTMLInputElement>) => setQuery(event.target.value)}
          style={{ width: 320 }}
        />
        <Flex gap={2}>
          <Button variant={tab === 'all' ? 'default' : 'tertiary'} size="S" onClick={() => setTab('all')}>
            {t('tab.all', 'Tất cả')}
          </Button>
          <Button variant={tab === 'off' ? 'default' : 'tertiary'} size="S" onClick={() => setTab('off')}>
            {t('tab.off', 'Đang tạm hết ({n})', { n: offCount })}
          </Button>
        </Flex>
        <Toggle
          checked={onlyLimited}
          onLabel={t('onlyLimited', 'Chỉ món có giới hạn')}
          offLabel={t('onlyLimited', 'Chỉ món có giới hạn')}
          onChange={(event: React.ChangeEvent<HTMLInputElement>) => setOnlyLimited(event.target.checked)}
        />
      </Flex>

      <Box paddingTop={4} background="neutral0" hasRadius borderColor="neutral200">
        {missingBranch ? (
          <Box padding={8}>
            <Typography>{t('missingBranch', 'Không thấy chi nhánh')}</Typography>
          </Box>
        ) : loading ? (
          <Flex justifyContent="center" padding={8}>
            <Loader />
          </Flex>
        ) : (
          <Table colCount={7} rowCount={filtered.length}>
            <Thead>
              <Tr>
                <Th>
                  <Typography variant="sigma">{t('col.name', 'Món / lựa chọn')}</Typography>
                </Th>
                <Th>
                  <Typography variant="sigma">{t('col.kind', 'Loại')}</Typography>
                </Th>
                <Th>
                  <Typography variant="sigma">{t('col.limit', 'Giới hạn/ngày')}</Typography>
                </Th>
                <Th>
                  <Typography variant="sigma">{t('col.today', 'Hôm nay')}</Typography>
                </Th>
                <Th>
                  <Typography variant="sigma">{t('col.state', 'Trạng thái')}</Typography>
                </Th>
                <Th>
                  <Typography variant="sigma">{t('col.until', 'Đến khi')}</Typography>
                </Th>
                <Th>
                  <Typography variant="sigma">{t('col.actor', 'Người bật')}</Typography>
                </Th>
              </Tr>
            </Thead>
            <Tbody>
              {filtered.map((row) => {
                const blocked = isBlockedNow(row);
                return (
                  <Tr key={`${row.entityType}:${row.entityDocumentId}`} background={blocked ? 'danger100' : undefined}>
                    <Td>
                      <Typography>{row.label}</Typography>
                    </Td>
                    <Td>
                      <Badge>{kindLabel(row.entityType)}</Badge>
                    </Td>
                    <Td>
                      {editing === rowKey(row) ? (
                        <Flex gap={2} alignItems="center">
                          <NumberInput
                            aria-label={t('editLimit', 'Sửa giới hạn mỗi ngày')}
                            value={draftLimit}
                            min={0}
                            onValueChange={(value?: number) =>
                              setDraftLimit(
                                typeof value === 'number' && Number.isFinite(value)
                                  ? Math.max(0, Math.trunc(value))
                                  : undefined,
                              )
                            }
                          />
                          <Button size="S" loading={busy} onClick={() => void saveLimit(row)}>
                            {t('saveLimit', 'Lưu')}
                          </Button>
                          <Button
                            size="S"
                            variant="tertiary"
                            disabled={busy}
                            onClick={() => setEditing(null)}
                          >
                            {t('cancelLimit', 'Hủy')}
                          </Button>
                        </Flex>
                      ) : (
                        <Button variant="tertiary" size="S" onClick={() => beginEdit(row)} disabled={busy}>
                          {row.dailyLimit === null ? t('unlimited', '—') : String(row.dailyLimit)}
                        </Button>
                      )}
                    </Td>
                    <Td>
                      {row.dailyLimit === null ||
                      row.reservedToday === null ||
                      row.remainingToday === null ? (
                        <Typography textColor="neutral600">{t('unlimited', '—')}</Typography>
                      ) : (
                        <Flex direction="column" alignItems="flex-start" gap={1}>
                          <Flex gap={2} alignItems="center">
                            <Typography>{`${row.reservedToday} / ${row.dailyLimit}`}</Typography>
                            {row.remainingToday <= 0 ? (
                              <Badge>{t('soldOutBadge', 'Hết hôm nay')}</Badge>
                            ) : null}
                          </Flex>
                          <PortionBar
                            reserved={row.reservedToday}
                            limit={row.dailyLimit}
                            soldOut={row.remainingToday <= 0}
                            low={row.dailyLimit === 0 || row.remainingToday / row.dailyLimit <= 0.2}
                          />
                          {row.remainingToday <= 0 ? (
                            <Typography variant="pi" textColor="neutral600">
                              {t('soldOutHint', 'Tự bán lại từ ngày kinh doanh mai')}
                            </Typography>
                          ) : null}
                        </Flex>
                      )}
                    </Td>
                    <Td>
                      <Flex gap={2} alignItems="center">
                        <Toggle
                          onLabel={t('on', 'Còn')}
                          offLabel={t('off', 'Hết')}
                          checked={!blocked}
                          onChange={(event: React.ChangeEvent<HTMLInputElement>) =>
                            onToggle(row, event.target.checked)
                          }
                          disabled={busy}
                          aria-label={row.label}
                        />
                      </Flex>
                    </Td>
                    <Td>
                      <Typography textColor={blocked ? 'danger600' : 'neutral600'}>
                        {fmtUntil(row, t)}
                      </Typography>
                    </Td>
                    <Td>
                      <Typography textColor="neutral600">{fmtActor(row)}</Typography>
                    </Td>
                  </Tr>
                );
              })}
            </Tbody>
          </Table>
        )}
      </Box>

      {/* Until picker when marking an item "Hết" */}
      <Dialog.Root open={dialog !== null} onOpenChange={(open: boolean) => !open && setDialog(null)}>
        <Dialog.Content>
          <Dialog.Header>
            {t('dialog.title', 'Tạm hết "{name}"?', { name: dialog?.row.label ?? '' })}
          </Dialog.Header>
          <Dialog.Body>
            <Flex direction="column" alignItems="flex-start" gap={3}>
              <Field.Root name="untilKind">
                <Field.Label>{t('dialog.until', 'Đến khi')}</Field.Label>
                <SingleSelect
                  value={untilKind}
                  onChange={(value: string | number) =>
                    setUntilKind(value as 'end-of-business-day' | 'specific-time')
                  }
                >
                  <SingleSelectOption value="end-of-business-day">
                    {t('dialog.eod', 'Hết ngày kinh doanh')}
                  </SingleSelectOption>
                  <SingleSelectOption value="specific-time">
                    {t('dialog.time', 'Đến giờ cụ thể')}
                  </SingleSelectOption>
                </SingleSelect>
              </Field.Root>
              {untilKind === 'specific-time' ? (
                <Field.Root name="untilTime">
                  <Field.Label>{t('dialog.at', 'Giờ (HH:mm)')}</Field.Label>
                  <TextInput
                    value={untilTime}
                    placeholder="14:00"
                    onChange={(event: React.ChangeEvent<HTMLInputElement>) =>
                      setUntilTime(event.target.value)
                    }
                  />
                  <Field.Hint />
                </Field.Root>
              ) : (
                <Typography variant="pi" textColor="neutral600">
                  {t('dialog.eod.note', 'Tự mở lại ở giờ chốt ngày của chi nhánh.')}
                </Typography>
              )}
            </Flex>
          </Dialog.Body>
          <Dialog.Footer>
            <Dialog.Cancel>
              <Button variant="tertiary" disabled={busy}>
                {t('dialog.cancel', 'Hủy')}
              </Button>
            </Dialog.Cancel>
            <Dialog.Action>
              <Button
                variant="danger"
                loading={busy}
                onClick={() =>
                  dialog &&
                  void toggle(dialog.row, {
                    selling: false,
                    untilKind,
                    ...(untilKind === 'specific-time' ? { until: untilTime } : {}),
                  })
                }
              >
                {t('dialog.confirm', 'Đánh dấu hết')}
              </Button>
            </Dialog.Action>
          </Dialog.Footer>
        </Dialog.Content>
      </Dialog.Root>
      <Divider marginTop={6} />
      <Typography variant="pi" textColor="neutral500" paddingTop={3}>
        {t('hint', 'Bật "Hết" chỉ gỡ món khỏi bán online ở chi nhánh này; mọi thao tác đều ghi nhật ký.')}
      </Typography>
    </Box>
  );
};

export default AvailabilityPage;
