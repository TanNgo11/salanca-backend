import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Badge,
  Box,
  Button,
  Dialog,
  EmptyStateLayout,
  Field,
  Flex,
  Loader,
  Radio,
  Table,
  Tbody,
  Td,
  Th,
  Thead,
  Tr,
  Typography,
} from '@strapi/design-system';
import { CheckCircle, Download, Upload } from '@strapi/icons';
import { Layouts, Page, useFetchClient, useRBAC } from '@strapi/strapi/admin';

import { apiErrorOf, httpStatusOf, useErrorToast } from '../../lib/api';
import { formatDateTime } from '../../lib/format';
import { useT } from '../../lib/i18n';
import { RBAC_CATALOG_MANAGE, RBAC_EXPORT } from '../../lib/permissions';

type Kind = 'products' | 'modifiers';

type ImportReport = {
  errors: { line: number; field?: string; message: string }[];
  created: Record<string, number>;
  updated: Record<string, number>;
};

type ImportRow = {
  documentId: string;
  kind: Kind;
  fileName: string;
  rowCount: number;
  status: 'validated' | 'applied' | 'failed';
  report: ImportReport;
  hasPayload: boolean;
  createdByRef: string | null;
  appliedAt: string | null;
  createdAt: string;
};

/** A blob response hides the Strapi error JSON; read `{ code }` back out (same as order export). */
const blobErrorCode = async (error: unknown): Promise<string | undefined> => {
  const data = (error as { response?: { data?: unknown } } | null)?.response?.data;
  if (!(data instanceof Blob)) return undefined;
  try {
    return (JSON.parse(await data.text()) as { error?: { code?: string } }).error?.code;
  } catch {
    return undefined;
  }
};

const sumOf = (bucket: Record<string, number> | undefined): number =>
  Object.values(bucket ?? {}).reduce((sum, value) => sum + value, 0);

/** Same 2 MB cap the server enforces — reject oversized picks before upload. */
const MAX_IMPORT_BYTES = 2 * 1024 * 1024;

/** X3 "Nhập/xuất menu" — CSV round-trip: export → dry-run → report → apply → history. */
const CatalogImportPage = () => {
  const t = useT();
  const { get, post } = useFetchClient();
  const toastError = useErrorToast();
  const exportRbac = useRBAC(RBAC_EXPORT);
  const canExport = Object.values(exportRbac.allowedActions).some(Boolean);

  const [kind, setKind] = useState<Kind>('products');
  const [file, setFile] = useState<File | null>(null);
  const fileInput = useRef<HTMLInputElement | null>(null);
  const [checking, setChecking] = useState(false);
  const [applying, setApplying] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [result, setResult] = useState<{ import: ImportRow; report: ImportReport } | null>(null);
  const [history, setHistory] = useState<ImportRow[]>([]);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error' | 'scope'>('loading');
  const [stale, setStale] = useState(false);
  const [fileTooBig, setFileTooBig] = useState(false);

  const load = useCallback(async () => {
    try {
      const { data } = await get('/ordering/catalog/imports');
      setHistory((data as { results: ImportRow[] }).results.slice(0, 10));
      setStatus('ready');
    } catch (error) {
      setStatus(httpStatusOf(error) === 403 ? 'scope' : 'error');
    }
  }, [get]);

  useEffect(() => {
    void load();
  }, [load]);

  const download = async (which: Kind) => {
    try {
      const response = await get(`/ordering/catalog/export?kind=${which}`, {
        responseType: 'blob',
      } as never);
      const headers = (response as { headers?: Record<string, unknown> }).headers ?? {};
      const name =
        /filename="([^"]+)"/.exec(String(headers['content-disposition'] ?? ''))?.[1] ??
        `${which}.csv`;
      const url = URL.createObjectURL(
        new Blob([response.data as BlobPart], { type: 'text/csv;charset=utf-8' }),
      );
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = name;
      anchor.click();
      URL.revokeObjectURL(url);
    } catch (error) {
      const code = await blobErrorCode(error);
      toastError(
        code !== undefined
          ? { response: { data: { error: { code } } } }
          : (error as Parameters<typeof toastError>[0]),
      );
    }
  };

  const check = async () => {
    if (!file) return;
    setChecking(true);
    setStale(false);
    setResult(null);
    try {
      const { data } = await post(
        `/ordering/catalog/import?kind=${kind}&dryRun=true&filename=${encodeURIComponent(file.name)}`,
        file,
        { headers: { 'Content-Type': 'application/octet-stream' } } as never,
      );
      setResult(data as { import: ImportRow; report: ImportReport });
    } catch (error) {
      toastError(error);
    } finally {
      setChecking(false);
    }
  };

  const apply = async () => {
    if (!result) return;
    setApplying(true);
    setStale(false);
    try {
      await post(`/ordering/catalog/import/${result.import.documentId}/apply`);
      setResult(null);
      setFile(null);
      if (fileInput.current) fileInput.current.value = '';
      setConfirming(false);
      void load();
    } catch (error) {
      if (apiErrorOf(error).code === 'CATALOG_IMPORT_STALE') {
        setStale(true);
        setConfirming(false);
        setResult(null);
      } else {
        toastError(error);
      }
    } finally {
      setApplying(false);
    }
  };

  const report = result?.report ?? null;
  const failed = result?.import.status === 'failed';
  const errorRows = report?.errors ?? [];
  const canApply = Boolean(result && !failed && result.import.hasPayload);

  return (
    <Page.Protect permissions={RBAC_CATALOG_MANAGE}>
      <Layouts.Header title={t('x3.title')} subtitle={t('x3.subtitle')} />
      <Layouts.Content>
        {status === 'loading' ? (
          <Flex justifyContent="center" padding={8}>
            <Loader />
          </Flex>
        ) : status !== 'ready' ? (
          <EmptyStateLayout content={t('x3.loadFailed')} />
        ) : (
          <Flex direction="column" alignItems="stretch" gap={6}>
            {/* ── Export ── */}
            <Box background="neutral0" padding={5} hasRadius shadow="tableShadow">
              <Typography variant="delta">{t('x3.export.title')}</Typography>
              <Typography textColor="neutral600">{t('x3.export.hint')}</Typography>
              <Flex gap={3} marginTop={3}>
                <Button
                  variant="secondary"
                  startIcon={<Download />}
                  disabled={!canExport}
                  onClick={() => void download('products')}
                >
                  {t('x3.export.products')}
                </Button>
                <Button
                  variant="secondary"
                  startIcon={<Download />}
                  disabled={!canExport}
                  onClick={() => void download('modifiers')}
                >
                  {t('x3.export.modifiers')}
                </Button>
              </Flex>
              {!canExport ? (
                <Typography variant="pi" textColor="neutral600">
                  {t('x3.export.needPermission')}
                </Typography>
              ) : null}
            </Box>

            {/* ── Import ── */}
            <Box background="neutral0" padding={5} hasRadius shadow="tableShadow">
              <Typography variant="delta">{t('x3.import.title')}</Typography>
              <Typography textColor="neutral600">{t('x3.import.hint')}</Typography>
              <Flex direction="column" alignItems="stretch" gap={3} marginTop={3}>
                <Field.Root>
                  <Field.Label>{t('x3.kind')}</Field.Label>
                  <Radio.Group
                    value={kind}
                    onValueChange={(value: string) => setKind(value as Kind)}
                  >
                    <Flex gap={4}>
                      <Radio.Item value="products">{t('x3.kind.products')}</Radio.Item>
                      <Radio.Item value="modifiers">{t('x3.kind.modifiers')}</Radio.Item>
                    </Flex>
                  </Radio.Group>
                </Field.Root>
                <Field.Root>
                  <Field.Label>{t('x3.file')}</Field.Label>
                  <input
                    ref={fileInput}
                    type="file"
                    accept=".csv,text/csv"
                    onChange={(event) => {
                      const picked = event.target.files?.[0] ?? null;
                      setFileTooBig(Boolean(picked && picked.size > MAX_IMPORT_BYTES));
                      setFile(picked);
                      setResult(null);
                      setStale(false);
                    }}
                  />
                  <Typography variant="pi" textColor="neutral600">
                    {t('x3.file.hint')}
                  </Typography>
                  {fileTooBig ? (
                    <Typography variant="pi" textColor="danger600">
                      {t('x3.file.tooBig')}
                    </Typography>
                  ) : null}
                </Field.Root>
                <Flex gap={3}>
                  <Button
                    variant="secondary"
                    startIcon={<CheckCircle />}
                    disabled={!file || fileTooBig || checking}
                    loading={checking}
                    onClick={() => void check()}
                  >
                    {t('x3.check')}
                  </Button>
                  <Button
                    startIcon={<Upload />}
                    disabled={!canApply || applying}
                    loading={applying}
                    onClick={() => setConfirming(true)}
                  >
                    {t('x3.apply')}
                  </Button>
                </Flex>
                {stale ? (
                  <Typography variant="pi" textColor="danger600">
                    {t('x3.stale')}
                  </Typography>
                ) : null}

                {report ? (
                  <Flex direction="column" alignItems="stretch" gap={3}>
                    <Flex gap={4}>
                      <Badge textColor="success700" backgroundColor="success100">
                        {t('x3.report.created', { n: sumOf(report.created) })}
                      </Badge>
                      <Badge textColor="primary700" backgroundColor="primary100">
                        {t('x3.report.updated', { n: sumOf(report.updated) })}
                      </Badge>
                      <Badge
                        textColor={errorRows.length ? 'danger700' : 'neutral700'}
                        backgroundColor={errorRows.length ? 'danger100' : 'neutral100'}
                      >
                        {t('x3.report.errors', { n: errorRows.length })}
                      </Badge>
                    </Flex>
                    {errorRows.length > 0 ? (
                      <Table colCount={3} rowCount={errorRows.length + 1}>
                        <Thead>
                          <Tr>
                            <Th>{t('x3.err.line')}</Th>
                            <Th>{t('x3.err.field')}</Th>
                            <Th>{t('x3.err.message')}</Th>
                          </Tr>
                        </Thead>
                        <Tbody>
                          {errorRows.map((row, index) => (
                            <Tr key={index}>
                              <Td>{row.line}</Td>
                              <Td>{row.field ?? ''}</Td>
                              <Td>{row.message}</Td>
                            </Tr>
                          ))}
                        </Tbody>
                      </Table>
                    ) : null}
                  </Flex>
                ) : null}
              </Flex>
            </Box>

            {/* ── History ── */}
            <Box background="neutral0" padding={5} hasRadius shadow="tableShadow">
              <Typography variant="delta">{t('x3.history.title')}</Typography>
              {history.length === 0 ? (
                <Typography textColor="neutral600">{t('x3.history.empty')}</Typography>
              ) : (
                <Table colCount={5} rowCount={history.length + 1}>
                  <Thead>
                    <Tr>
                      <Th>{t('x3.history.at')}</Th>
                      <Th>{t('x3.history.by')}</Th>
                      <Th>{t('x3.history.kind')}</Th>
                      <Th>{t('x3.history.file')}</Th>
                      <Th>{t('x3.history.result')}</Th>
                    </Tr>
                  </Thead>
                  <Tbody>
                    {history.map((row) => (
                      <Tr key={row.documentId}>
                        <Td>{formatDateTime(row.createdAt)}</Td>
                        <Td>{row.createdByRef ?? '—'}</Td>
                        <Td>{t(`x3.kind.${row.kind}`)}</Td>
                        <Td>
                          {row.fileName} ({row.rowCount})
                        </Td>
                        <Td>
                          <Badge
                            textColor={
                              row.status === 'applied'
                                ? 'success700'
                                : row.status === 'failed'
                                  ? 'danger700'
                                  : 'neutral700'
                            }
                            backgroundColor={
                              row.status === 'applied'
                                ? 'success100'
                                : row.status === 'failed'
                                  ? 'danger100'
                                  : 'neutral100'
                            }
                          >
                            {t(`x3.status.${row.status}`)}
                          </Badge>
                        </Td>
                      </Tr>
                    ))}
                  </Tbody>
                </Table>
              )}
            </Box>
          </Flex>
        )}
      </Layouts.Content>

      <Dialog.Root open={confirming} onOpenChange={(open: boolean) => !open && setConfirming(false)}>
        <Dialog.Content>
          <Dialog.Header>{t('x3.confirm.title')}</Dialog.Header>
          <Dialog.Body>
            <Typography>
              {t('x3.confirm.body', {
                created: sumOf(report?.created),
                updated: sumOf(report?.updated),
              })}
            </Typography>
          </Dialog.Body>
          <Dialog.Footer>
            <Button variant="tertiary" onClick={() => setConfirming(false)}>
              {t('common.cancel')}
            </Button>
            <Button onClick={() => void apply()} loading={applying}>
              {t('x3.apply')}
            </Button>
          </Dialog.Footer>
        </Dialog.Content>
      </Dialog.Root>
    </Page.Protect>
  );
};

export default CatalogImportPage;
