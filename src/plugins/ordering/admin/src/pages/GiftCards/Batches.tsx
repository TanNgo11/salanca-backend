import { useCallback, useEffect, useState } from 'react';
import {
  Alert,
  Badge,
  Box,
  Button,
  EmptyStateLayout,
  Field,
  Flex,
  Loader,
  Modal,
  NumberInput,
  Table,
  Tbody,
  Td,
  Textarea,
  TextInput,
  Th,
  Thead,
  Tr,
  Typography,
} from '@strapi/design-system';
import { ArrowLeft, FileCsv, Plus } from '@strapi/icons';
import { Layouts, useFetchClient, useNotification } from '@strapi/strapi/admin';
import { useNavigate, useParams } from 'react-router-dom';

import { httpStatusOf, useErrorToast } from '../../lib/api';
import { formatDateTime, formatMoney } from '../../lib/format';
import { useT } from '../../lib/i18n';
import type { CardRow } from './CardList';
import { StatusBadge } from './CardList';

type BatchRow = {
  id: number;
  code: string;
  source: 'generated' | 'imported';
  denominationAmount: number;
  currency: string;
  quantity: number;
  note: string | null;
  createdBy: string | null;
  createdAt: string;
  cards: number;
  sold: number;
  remaining: number;
};

const Section = ({ title, children }: { title: string; children: React.ReactNode }) => (
  <Box background="neutral0" hasRadius shadow="tableShadow" padding={5}>
    <Typography variant="delta" tag="h2">
      {title}
    </Typography>
    <Box paddingTop={3}>{children}</Box>
  </Box>
);

/** Download helper — the batch CSV carries plaintext codes, so it rides a blob fetch. */
const useBatchExport = () => {
  const t = useT();
  const { get } = useFetchClient();
  const { toggleNotification } = useNotification();
  return useCallback(
    async (id: number) => {
      try {
        const response = await get(`/ordering/gift-card-batches/${id}/export`, {
          responseType: 'blob',
        } as never);
        const headers = (response as { headers?: Record<string, unknown> }).headers ?? {};
        const name =
          /filename="([^"]+)"/.exec(String(headers['content-disposition'] ?? ''))?.[1] ??
          `lo-the-${id}.csv`;
        const url = URL.createObjectURL(
          new Blob([response.data as BlobPart], { type: 'text/csv;charset=utf-8' }),
        );
        const anchor = document.createElement('a');
        anchor.href = url;
        anchor.download = name;
        anchor.click();
        URL.revokeObjectURL(url);
      } catch (error) {
        toggleNotification({ type: 'danger', message: t('batch.export.hint') });
        throw error;
      }
    },
    [get, t, toggleNotification],
  );
};

/** POST /gift-card-batches — generate `count` codes; the plaintext list comes back once. */
const CreateBatchModal = ({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: () => void }) => {
  const t = useT();
  const { post } = useFetchClient();
  const toastError = useErrorToast();
  const exportBatch = useBatchExport();
  const [denomination, setDenomination] = useState<number | undefined>(undefined);
  const [count, setCount] = useState<number | undefined>(undefined);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [created, setCreated] = useState<{ id: number; code: string; quantity: number } | null>(null);

  const submit = async () => {
    setBusy(true);
    try {
      const { data } = await post('/ordering/gift-card-batches', {
        denomination: denomination ?? 0,
        count: count ?? 0,
        ...(note.trim() ? { note: note.trim() } : {}),
      });
      const batch = (data as { batch: { id: number; code: string; quantity: number } }).batch;
      setCreated(batch);
      onCreated();
      // The CSV is the printing hand-off — download it straight away while the seal lives.
      await exportBatch(batch.id).catch(() => undefined);
    } catch (error) {
      toastError(error);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal.Root open={open} onOpenChange={(next: boolean) => !next && onClose()}>
      <Modal.Content>
        <Modal.Header>
          <Modal.Title>{t('batch.create.title')}</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          {created ? (
            <Alert variant="success" closeLabel={t('common.close')} title={t('batch.create.title')}>
              {t('batch.create.result', { count: created.quantity })}
            </Alert>
          ) : (
            <Flex direction="column" alignItems="stretch" gap={4}>
              <Field.Root required>
                <Field.Label>{t('batch.create.denomination')}</Field.Label>
                <NumberInput
                  value={denomination}
                  onValueChange={(next?: number) => setDenomination(next)}
                  min={1}
                  step={1000}
                />
              </Field.Root>
              <Field.Root required>
                <Field.Label>{t('batch.create.count')}</Field.Label>
                <NumberInput
                  value={count}
                  onValueChange={(next?: number) => setCount(next)}
                  min={1}
                />
              </Field.Root>
              <Field.Root>
                <Field.Label>{t('batch.create.note')}</Field.Label>
                <TextInput
                  value={note}
                  onChange={(event: React.ChangeEvent<HTMLInputElement>) => setNote(event.target.value)}
                />
              </Field.Root>
            </Flex>
          )}
        </Modal.Body>
        {!created ? (
          <Modal.Footer>
            <Modal.Close>
              <Button variant="tertiary">{t('common.cancel')}</Button>
            </Modal.Close>
            <Button loading={busy} disabled={!denomination || !count} onClick={() => void submit()}>
              {t('batch.create.submit')}
            </Button>
          </Modal.Footer>
        ) : (
          <Modal.Footer>
            <Modal.Close>
              <Button variant="tertiary">{t('common.close')}</Button>
            </Modal.Close>
          </Modal.Footer>
        )}
      </Modal.Content>
    </Modal.Root>
  );
};

/** POST /gift-card-batches/import — one preprinted code per line, all-or-nothing. */
const ImportBatchModal = ({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: () => void }) => {
  const t = useT();
  const { post } = useFetchClient();
  const toastError = useErrorToast();
  const [denomination, setDenomination] = useState<number | undefined>(undefined);
  const [codesText, setCodesText] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [imported, setImported] = useState<{ code: string; count: number } | null>(null);

  const lines = codesText
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  const submit = async () => {
    setBusy(true);
    try {
      const { data } = await post('/ordering/gift-card-batches/import', {
        denomination: denomination ?? 0,
        codes: lines,
        ...(note.trim() ? { note: note.trim() } : {}),
      });
      const result = data as { batch: { code: string }; imported: number };
      setImported({ code: result.batch.code, count: result.imported });
      onCreated();
    } catch (error) {
      toastError(error);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal.Root open={open} onOpenChange={(next: boolean) => !next && onClose()}>
      <Modal.Content>
        <Modal.Header>
          <Modal.Title>{t('batch.import.title')}</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          {imported ? (
            <Alert variant="success" closeLabel={t('common.close')} title={t('batch.import.title')}>
              {t('batch.import.result', { count: imported.count, code: imported.code })}
            </Alert>
          ) : (
            <Flex direction="column" alignItems="stretch" gap={4}>
              <Field.Root required>
                <Field.Label>{t('batch.create.denomination')}</Field.Label>
                <NumberInput
                  value={denomination}
                  onValueChange={(next?: number) => setDenomination(next)}
                  min={1}
                  step={1000}
                />
              </Field.Root>
              <Field.Root required hint={`${lines.length}`}>
                <Field.Label>{t('batch.import.codes')}</Field.Label>
                <Textarea
                  value={codesText}
                  onChange={(event: React.ChangeEvent<HTMLTextAreaElement>) =>
                    setCodesText(event.target.value)
                  }
                />
                <Field.Hint />
              </Field.Root>
              <Field.Root>
                <Field.Label>{t('batch.create.note')}</Field.Label>
                <TextInput
                  value={note}
                  onChange={(event: React.ChangeEvent<HTMLInputElement>) => setNote(event.target.value)}
                />
              </Field.Root>
            </Flex>
          )}
        </Modal.Body>
        {!imported ? (
          <Modal.Footer>
            <Modal.Close>
              <Button variant="tertiary">{t('common.cancel')}</Button>
            </Modal.Close>
            <Button loading={busy} disabled={!denomination || lines.length === 0} onClick={() => void submit()}>
              {t('batch.import.submit')}
            </Button>
          </Modal.Footer>
        ) : (
          <Modal.Footer>
            <Modal.Close>
              <Button variant="tertiary">{t('common.close')}</Button>
            </Modal.Close>
          </Modal.Footer>
        )}
      </Modal.Content>
    </Modal.Root>
  );
};

export const BatchList = () => {
  const t = useT();
  const navigate = useNavigate();
  const { get } = useFetchClient();
  const [rows, setRows] = useState<BatchRow[] | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error' | 'forbidden'>('loading');
  const [createOpen, setCreateOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);

  const load = useCallback(async () => {
    try {
      const { data } = await get('/ordering/gift-card-batches');
      setRows((data as { items: BatchRow[] }).items);
      setStatus('ready');
    } catch (error) {
      setStatus(httpStatusOf(error) === 403 ? 'forbidden' : 'error');
    }
  }, [get]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <>
      <Layouts.Header
        title={t('batch.title')}
        subtitle={t('batch.subtitle')}
        navigationAction={
          <Button variant="tertiary" startIcon={<ArrowLeft />} onClick={() => navigate('/plugins/ordering/gift-cards')}>
            {t('card.title')}
          </Button>
        }
        primaryAction={
          <Flex gap={2}>
            <Button variant="secondary" startIcon={<FileCsv />} onClick={() => setImportOpen(true)}>
              {t('batch.import')}
            </Button>
            <Button startIcon={<Plus />} onClick={() => setCreateOpen(true)}>
              {t('batch.add')}
            </Button>
          </Flex>
        }
      />
      <Layouts.Content>
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
            {t('batch.loadFailed')}
          </Alert>
        ) : !rows || rows.length === 0 ? (
          <EmptyStateLayout content={t('batch.empty')} />
        ) : (
          <Table colCount={7} rowCount={rows.length + 1}>
            <Thead>
              <Tr>
                {['code', 'source', 'denomination', 'quantity', 'sold', 'remaining', 'created'].map((column) => (
                  <Th key={column}>
                    <Typography variant="sigma">{t(`batch.col.${column}`)}</Typography>
                  </Th>
                ))}
              </Tr>
            </Thead>
            <Tbody>
              {rows.map((row) => {
                const open = () => navigate(`/plugins/ordering/gift-cards/batches/${row.id}`);
                return (
                  <Tr key={row.id}>
                    <Td onClick={open} style={{ cursor: 'pointer' }}>
                      <Typography fontWeight="semiBold">{row.code}</Typography>
                    </Td>
                    <Td onClick={open} style={{ cursor: 'pointer' }}>
                      <Badge>{t(`batch.source.${row.source}`)}</Badge>
                    </Td>
                    <Td onClick={open} style={{ cursor: 'pointer' }}>
                      <Typography>{formatMoney(row.denominationAmount)}</Typography>
                    </Td>
                    <Td onClick={open} style={{ cursor: 'pointer' }}>
                      <Typography>{row.quantity}</Typography>
                    </Td>
                    <Td onClick={open} style={{ cursor: 'pointer' }}>
                      <Typography>{row.sold}</Typography>
                    </Td>
                    <Td onClick={open} style={{ cursor: 'pointer' }}>
                      <Typography>{row.remaining}</Typography>
                    </Td>
                    <Td>
                      <Typography>{formatDateTime(row.createdAt)}</Typography>
                    </Td>
                  </Tr>
                );
              })}
            </Tbody>
          </Table>
        )}
      </Layouts.Content>
      <CreateBatchModal open={createOpen} onClose={() => setCreateOpen(false)} onCreated={() => void load()} />
      <ImportBatchModal open={importOpen} onClose={() => setImportOpen(false)} onCreated={() => void load()} />
    </>
  );
};

export const BatchDetail = () => {
  const t = useT();
  const navigate = useNavigate();
  const { id } = useParams();
  const { get } = useFetchClient();
  const toastError = useErrorToast();
  const exportBatch = useBatchExport();
  const [data, setData] = useState<{ batch: BatchRow; items: CardRow[]; total: number } | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error' | 'forbidden'>('loading');
  const [exporting, setExporting] = useState(false);

  const load = useCallback(async () => {
    try {
      const { data: body } = await get(`/ordering/gift-card-batches/${id}`);
      setData(body as { batch: BatchRow; items: CardRow[]; total: number });
      setStatus('ready');
    } catch (error) {
      setStatus(httpStatusOf(error) === 403 ? 'forbidden' : 'error');
    }
  }, [get, id]);

  useEffect(() => {
    void load();
  }, [load]);

  if (status === 'loading') {
    return (
      <Flex justifyContent="center" padding={10}>
        <Loader>{t('common.loading')}</Loader>
      </Flex>
    );
  }
  if (status !== 'ready' || !data) {
    return (
      <Layouts.Content>
        <Alert
          variant="danger"
          closeLabel={t('common.close')}
          title={status === 'forbidden' ? t('common.forbidden.title') : t('common.error.title')}
        >
          {t('batch.loadFailed')}
        </Alert>
      </Layouts.Content>
    );
  }
  const { batch } = data;

  return (
    <>
      <Layouts.Header
        title={batch.code}
        subtitle={`${t(`batch.source.${batch.source}`)} · ${formatMoney(batch.denominationAmount)}`}
        navigationAction={
          <Button variant="tertiary" startIcon={<ArrowLeft />} onClick={() => navigate('/plugins/ordering/gift-cards/batches')}>
            {t('batch.title')}
          </Button>
        }
        primaryAction={
          <Button
            variant="secondary"
            startIcon={<FileCsv />}
            loading={exporting}
            onClick={() => {
              setExporting(true);
              void exportBatch(batch.id)
                .catch(toastError)
                .finally(() => setExporting(false));
            }}
          >
            {t('batch.export')}
          </Button>
        }
      />
      <Layouts.Content>
        <Flex direction="column" alignItems="stretch" gap={4}>
          <Section title={t('batch.title')}>
            <Flex direction="column" alignItems="stretch" gap={1}>
              <Flex justifyContent="space-between" paddingBottom={1}>
                <Typography textColor="neutral600">{t('batch.col.created')}</Typography>
                <Typography>{formatDateTime(batch.createdAt)}</Typography>
              </Flex>
              {batch.note ? (
                <Flex justifyContent="space-between" paddingBottom={1}>
                  <Typography textColor="neutral600">{t('card.detail.note')}</Typography>
                  <Typography>{batch.note}</Typography>
                </Flex>
              ) : null}
              <Typography variant="pi" textColor="neutral500">
                {t('batch.export.hint')}
              </Typography>
            </Flex>
          </Section>
          <Section title={t('batch.cards')}>
            {data.items.length === 0 ? (
              <Typography textColor="neutral600">{t('card.ledger.empty')}</Typography>
            ) : (
              <Table colCount={5} rowCount={data.items.length + 1}>
                <Thead>
                  <Tr>
                    {['card', 'denomination', 'balance', 'expiry', 'status'].map((column) => (
                      <Th key={column}>
                        <Typography variant="sigma">{t(`card.col.${column}`)}</Typography>
                      </Th>
                    ))}
                  </Tr>
                </Thead>
                <Tbody>
                  {data.items.map((card) => (
                    <Tr key={card.id}>
                      <Td>
                        <Typography fontWeight="semiBold">{card.masked}</Typography>
                      </Td>
                      <Td>
                        <Typography>{formatMoney(card.initialAmount)}</Typography>
                      </Td>
                      <Td>
                        <Typography>{formatMoney(card.balance)}</Typography>
                      </Td>
                      <Td>
                        <Typography>{formatDateTime(card.expiresAt)}</Typography>
                      </Td>
                      <Td>
                        <StatusBadge status={card.status} />
                      </Td>
                    </Tr>
                  ))}
                </Tbody>
              </Table>
            )}
          </Section>
        </Flex>
      </Layouts.Content>
    </>
  );
};

export default BatchList;
