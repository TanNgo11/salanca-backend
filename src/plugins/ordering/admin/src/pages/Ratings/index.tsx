import { useCallback, useEffect, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Checkbox,
  EmptyStateLayout,
  Field,
  Flex,
  Grid,
  Loader,
  Modal,
  SingleSelect,
  SingleSelectOption,
  Table,
  Tag,
  Tbody,
  Td,
  Textarea,
  TextInput,
  Th,
  Thead,
  Tr,
  Typography,
} from '@strapi/design-system';
import { Layouts, Page, useFetchClient, useNotification, useRBAC } from '@strapi/strapi/admin';
import { Link } from 'react-router-dom';

import { httpStatusOf, useErrorToast } from '../../lib/api';
import { formatDateTime, formatMoney, localized } from '../../lib/format';
import { useLocale, useT } from '../../lib/i18n';
import { PERMISSIONS, RBAC_RATING } from '../../lib/permissions';

export type RatingRow = {
  id: number;
  orderId: number;
  orderCode: string | null;
  locationRef: string;
  stars: number;
  tags: string[];
  comment: string | null;
  status: 'visible' | 'hidden';
  staffNote: string | null;
  ratedAt: string | null;
  updatedAt: string | null;
};

type Summary = { average: number | null; count: number; distribution: Record<string, number> };
type Branch = { code: string; name: Record<string, string> };
type TagLabels = Record<string, Record<string, string>>;
type Detail = {
  rating: RatingRow;
  tagLabels: TagLabels;
  order: { id: number; code: string; total: number; items: Array<{ title: string; quantity: number }>; courierRef: string | null } | null;
};

/** The configured label for a tag code, falling back to the raw code when it was removed. */
const tagText = (code: string, labels: TagLabels | undefined, locale: string) =>
  localized(labels?.[code], locale) || code;

/** ★★★☆☆ — ≤ 2 stars in red (screens R1). */
export const Stars = ({ value }: { value: number }) => (
  <Typography textColor={value <= 2 ? 'danger600' : 'warning600'} aria-label={`${value}/5`}>
    {'★'.repeat(value)}
    <Typography textColor="neutral300">{'★'.repeat(5 - value)}</Typography>
  </Typography>
);

const DetailModal = ({
  id,
  canManage,
  onClose,
  onChanged,
}: {
  id: number;
  canManage: boolean;
  onClose: () => void;
  onChanged: () => void;
}) => {
  const t = useT();
  const locale = useLocale();
  const { get, post } = useFetchClient();
  const { toggleNotification } = useNotification();
  const toastError = useErrorToast();
  const [detail, setDetail] = useState<Detail | null>(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void get(`/ordering/ratings/${id}`)
      .then(({ data }) => {
        const body = data as Detail;
        setDetail(body);
        setNote(body.rating.staffNote ?? '');
      })
      .catch((error: unknown) => toastError(error));
  }, [get, id, toastError]);

  const act = async (path: string, body: Record<string, unknown>) => {
    setBusy(true);
    try {
      const { data } = await post(`/ordering/ratings/${id}/${path}`, body);
      setDetail((current) => (current ? { ...current, rating: (data as { rating: RatingRow }).rating } : current));
      toggleNotification({ type: 'success', message: t('rating.saved') });
      onChanged();
    } catch (error) {
      toastError(error);
    } finally {
      setBusy(false);
    }
  };

  const rating = detail?.rating;
  return (
    <Modal.Root open onOpenChange={(open: boolean) => !open && onClose()}>
      <Modal.Content>
        <Modal.Header>
          <Modal.Title>{t('rating.detail.title', { code: detail?.order?.code ?? '' })}</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          {!rating ? (
            <Loader>{t('common.loading')}</Loader>
          ) : (
            <Flex direction="column" alignItems="stretch" gap={4}>
              <Stars value={rating.stars} />
              {rating.tags.length > 0 ? (
                <Flex gap={2} wrap="wrap">
                  {rating.tags.map((tag) => (
                    <Tag key={tag} icon={null}>
                      {tagText(tag, detail?.tagLabels, locale)}
                    </Tag>
                  ))}
                </Flex>
              ) : null}
              <Typography>{rating.comment ?? t('rating.noComment')}</Typography>
              <Typography variant="pi" textColor="neutral600">
                {t('rating.detail.at', { at: formatDateTime(rating.ratedAt), updated: formatDateTime(rating.updatedAt) })}
              </Typography>
              {detail?.order ? (
                <Box background="neutral100" padding={3} hasRadius>
                  <Link to={`/plugins/ordering/orders/${detail.order.id}`}>{detail.order.code}</Link>
                  <Typography tag="p">
                    {detail.order.items.map((item) => `${item.quantity}× ${item.title}`).join(', ')}
                  </Typography>
                  <Typography tag="p" fontWeight="semiBold">
                    {formatMoney(detail.order.total)}
                  </Typography>
                  {detail.order.courierRef ? (
                    <Typography variant="pi" textColor="neutral600">
                      {t('rating.detail.courier', { ref: detail.order.courierRef })}
                    </Typography>
                  ) : null}
                </Box>
              ) : null}
              {canManage ? (
                <Field.Root hint={t('rating.note.hint')}>
                  <Field.Label>{t('rating.note')}</Field.Label>
                  <Textarea value={note} onChange={(event: React.ChangeEvent<HTMLTextAreaElement>) => setNote(event.target.value)} />
                  <Field.Hint />
                </Field.Root>
              ) : rating.staffNote ? (
                <Typography>{`${t('rating.note')}: ${rating.staffNote}`}</Typography>
              ) : null}
            </Flex>
          )}
        </Modal.Body>
        <Modal.Footer>
          <Modal.Close>
            <Button variant="tertiary">{t('common.close')}</Button>
          </Modal.Close>
          {canManage && rating ? (
            <Flex gap={2}>
              <Button variant="secondary" loading={busy} onClick={() => void act('hide', { hidden: rating.status === 'visible' })}>
                {rating.status === 'visible' ? t('rating.hide') : t('rating.show')}
              </Button>
              <Button loading={busy} onClick={() => void act('note', { note })}>
                {t('rating.note.save')}
              </Button>
            </Flex>
          ) : null}
        </Modal.Footer>
      </Modal.Content>
    </Modal.Root>
  );
};

const RatingsList = () => {
  const t = useT();
  const locale = useLocale();
  const { get } = useFetchClient();
  const manage = useRBAC(RBAC_RATING);
  const canManage = !manage.isLoading && Object.values(manage.allowedActions).some(Boolean);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [branch, setBranch] = useState('');
  const [stars, setStars] = useState<number[]>([]);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [hasComment, setHasComment] = useState(false);
  const [statusFilter, setStatusFilter] = useState('');
  const [page, setPage] = useState(1);
  const [rows, setRows] = useState<RatingRow[] | null>(null);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [tagLabels, setTagLabels] = useState<TagLabels>({});
  const [total, setTotal] = useState(0);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error' | 'forbidden'>('loading');
  const [open, setOpen] = useState<number | null>(null);

  useEffect(() => {
    void get('/ordering/orders/branches')
      .then(({ data }) => setBranches(((data as { results?: Branch[] }).results ?? []) as Branch[]))
      .catch(() => undefined);
  }, [get]);

  const load = useCallback(async () => {
    try {
      const query = new URLSearchParams({ page: String(page) });
      if (branch) query.set('branch', branch);
      if (stars.length > 0) query.set('stars', stars.join(','));
      if (from) query.set('from', from);
      if (to) query.set('to', to);
      if (hasComment) query.set('hasComment', 'true');
      if (statusFilter) query.set('status', statusFilter);
      const { data } = await get(`/ordering/ratings?${query.toString()}`);
      const body = data as { items: RatingRow[]; summary: Summary; tagLabels?: TagLabels; pagination: { total: number } };
      setRows(body.items);
      setSummary(body.summary);
      setTagLabels(body.tagLabels ?? {});
      setTotal(body.pagination.total);
      setStatus('ready');
    } catch (error) {
      setStatus(httpStatusOf(error) === 403 ? 'forbidden' : 'error');
    }
  }, [branch, from, get, hasComment, page, stars, statusFilter, to]);

  useEffect(() => {
    void load();
  }, [load]);

  const maxCount = Math.max(1, ...Object.values(summary?.distribution ?? {}));

  return (
    <>
      <Layouts.Header title={t('rating.title')} subtitle={t('rating.subtitle')} />
      <Layouts.Content>
        <Flex direction="column" alignItems="stretch" gap={4}>
          {summary ? (
            <Grid.Root gap={4}>
              <Grid.Item col={3} s={6}>
                <Box background="neutral0" padding={4} hasRadius shadow="tableShadow" width="100%">
                  <Typography variant="sigma" textColor="neutral600">
                    {t('rating.average')}
                  </Typography>
                  <Typography variant="beta" tag="p">
                    {summary.average === null ? '—' : `${summary.average} ★`}
                  </Typography>
                </Box>
              </Grid.Item>
              <Grid.Item col={3} s={6}>
                <Box background="neutral0" padding={4} hasRadius shadow="tableShadow" width="100%">
                  <Typography variant="sigma" textColor="neutral600">
                    {t('rating.count')}
                  </Typography>
                  <Typography variant="beta" tag="p">
                    {summary.count}
                  </Typography>
                </Box>
              </Grid.Item>
              <Grid.Item col={6} s={12}>
                <Box background="neutral0" padding={4} hasRadius shadow="tableShadow" width="100%">
                  {[5, 4, 3, 2, 1].map((value) => (
                    <Flex key={value} gap={2}>
                      <Typography style={{ width: 24 }}>{`${value}★`}</Typography>
                      <Box
                        background={value <= 2 ? 'danger500' : 'warning500'}
                        style={{ height: 8, width: `${((summary.distribution[value] ?? 0) / maxCount) * 70}%`, minWidth: 2 }}
                        hasRadius
                      />
                      <Typography variant="pi">{summary.distribution[value] ?? 0}</Typography>
                    </Flex>
                  ))}
                </Box>
              </Grid.Item>
            </Grid.Root>
          ) : null}
          <Flex gap={4} wrap="wrap" alignItems="flex-end">
            <Box style={{ minWidth: 200 }}>
              <Field.Root>
                <Field.Label>{t('rating.filter.branch')}</Field.Label>
                <SingleSelect value={branch} onChange={(value: string | number) => { setPage(1); setBranch(String(value)); }}>
                  <SingleSelectOption value="">{t('common.all')}</SingleSelectOption>
                  {branches.map((item) => (
                    <SingleSelectOption key={item.code} value={item.code}>
                      {localized(item.name, locale) || item.code}
                    </SingleSelectOption>
                  ))}
                </SingleSelect>
              </Field.Root>
            </Box>
            <Flex direction="column" alignItems="stretch" gap={1}>
              <Typography variant="pi" fontWeight="bold">
                {t('rating.filter.stars')}
              </Typography>
              <Flex gap={1}>
                {[1, 2, 3, 4, 5].map((value) => (
                  <Button
                    key={value}
                    size="S"
                    variant={stars.includes(value) ? 'default' : 'tertiary'}
                    onClick={() => {
                      setPage(1);
                      setStars(stars.includes(value) ? stars.filter((item) => item !== value) : [...stars, value]);
                    }}
                  >
                    {`${value}★`}
                  </Button>
                ))}
              </Flex>
            </Flex>
            <Field.Root>
              <Field.Label>{t('rating.filter.from')}</Field.Label>
              <TextInput type="date" value={from} onChange={(event: React.ChangeEvent<HTMLInputElement>) => { setPage(1); setFrom(event.target.value); }} />
            </Field.Root>
            <Field.Root>
              <Field.Label>{t('rating.filter.to')}</Field.Label>
              <TextInput type="date" value={to} onChange={(event: React.ChangeEvent<HTMLInputElement>) => { setPage(1); setTo(event.target.value); }} />
            </Field.Root>
            <Flex gap={2}>
              <Checkbox checked={hasComment} onCheckedChange={(value: boolean) => { setPage(1); setHasComment(value); }} aria-label={t('rating.filter.hasComment')} />
              <Typography>{t('rating.filter.hasComment')}</Typography>
            </Flex>
            <Box style={{ minWidth: 160 }}>
              <Field.Root>
                <Field.Label>{t('rating.filter.status')}</Field.Label>
                <SingleSelect value={statusFilter} onChange={(value: string | number) => { setPage(1); setStatusFilter(String(value)); }}>
                  <SingleSelectOption value="">{t('common.all')}</SingleSelectOption>
                  <SingleSelectOption value="visible">{t('rating.status.visible')}</SingleSelectOption>
                  <SingleSelectOption value="hidden">{t('rating.status.hidden')}</SingleSelectOption>
                </SingleSelect>
              </Field.Root>
            </Box>
          </Flex>
          {status === 'loading' ? (
            <Flex justifyContent="center" padding={8}>
              <Loader>{t('common.loading')}</Loader>
            </Flex>
          ) : status !== 'ready' ? (
            <Alert
              variant="danger"
              closeLabel={t('common.close')}
              title={status === 'forbidden' ? t('common.forbidden.title') : t('common.error.title')}
              action={status === 'error' ? <Button onClick={() => void load()}>{t('common.retry')}</Button> : undefined}
            >
              {status === 'forbidden' ? t('orders.noScope') : t('rating.loadFailed')}
            </Alert>
          ) : !rows || rows.length === 0 ? (
            <EmptyStateLayout content={t('rating.empty')} />
          ) : (
            <>
              <Table colCount={6} rowCount={rows.length + 1}>
                <Thead>
                  <Tr>
                    {['stars', 'tags', 'comment', 'order', 'branch', 'at'].map((column) => (
                      <Th key={column}>
                        <Typography variant="sigma">{t(`rating.col.${column}`)}</Typography>
                      </Th>
                    ))}
                  </Tr>
                </Thead>
                <Tbody>
                  {rows.map((row) => (
                    <Tr key={row.id} onClick={() => setOpen(row.id)} style={{ cursor: 'pointer', opacity: row.status === 'hidden' ? 0.6 : 1 }}>
                      <Td>
                        <Stars value={row.stars} />
                      </Td>
                      <Td>
                        <Flex gap={1} wrap="wrap">
                          {row.tags.map((tag) => (
                            <Tag key={tag} icon={null}>
                              {tagText(tag, tagLabels, locale)}
                            </Tag>
                          ))}
                        </Flex>
                      </Td>
                      <Td style={{ maxWidth: 320 }}>
                        <Typography ellipsis>{row.comment ?? '—'}</Typography>
                      </Td>
                      <Td>
                        <Typography>{row.orderCode ?? '—'}</Typography>
                      </Td>
                      <Td>
                        <Typography>{row.locationRef}</Typography>
                      </Td>
                      <Td>
                        <Typography>{formatDateTime(row.ratedAt)}</Typography>
                      </Td>
                    </Tr>
                  ))}
                </Tbody>
              </Table>
              <Flex justifyContent="flex-end" gap={2}>
                <Button variant="tertiary" disabled={page <= 1} onClick={() => setPage(page - 1)}>
                  {t('common.previous')}
                </Button>
                <Button variant="tertiary" disabled={page * 50 >= total} onClick={() => setPage(page + 1)}>
                  {t('common.next')}
                </Button>
              </Flex>
            </>
          )}
        </Flex>
      </Layouts.Content>
      {open !== null ? (
        <DetailModal id={open} canManage={canManage} onClose={() => setOpen(null)} onChanged={() => void load()} />
      ) : null}
    </>
  );
};

/** `/plugins/ordering/ratings` (screens R1–R2). Reading follows `order.read` + branch scope. */
const RatingsPage = () => {
  const t = useT();
  return (
    <Page.Protect permissions={PERMISSIONS.read}>
      <Page.Title>{t('rating.title')}</Page.Title>
      <Page.Main>
        <RatingsList />
      </Page.Main>
    </Page.Protect>
  );
};

export default RatingsPage;
