import { useEffect, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Field,
  Flex,
  Modal,
  TextInput,
  Typography,
} from '@strapi/design-system';
import { FileCsv } from '@strapi/icons';
import { useFetchClient, useNotification } from '@strapi/strapi/admin';

import {
  ORDER_EXPORT_MAX_DAYS,
  ORDER_EXPORT_MAX_ROWS,
} from '../../../shared/export-limits';
import { localized } from '../lib/format';
import { useLocale, useT } from '../lib/i18n';

export type ExportBranchOption = {
  code: string;
  name: Record<string, string>;
  businessDateToday?: string;
};

type Props = {
  open: boolean;
  onClose: () => void;
  branches: ExportBranchOption[];
  initialBranch?: string;
  initialFrom?: string;
  initialTo?: string;
};

/** A blob response hides the Strapi error JSON; read the {code,message} back out. */
const readBlobError = async (error: unknown): Promise<{ code?: string; message?: string }> => {
  const data = (error as { response?: { data?: unknown } } | null)?.response?.data;
  if (!(data instanceof Blob)) return {};
  try {
    const parsed = JSON.parse(await data.text()) as { error?: { code?: string; message?: string } };
    return parsed.error ?? {};
  } catch {
    return {};
  }
};

/**
 * "Xuất CSV đơn" dialog (screens V5): from/to business dates, optional branch. A native
 * <select> is used inside the modal because the design-system SingleSelect does not pop
 * over Modal.Content. The file contains customer PII — the warning stays on screen.
 */
export const OrderExportModal = ({ open, onClose, branches, initialBranch, initialFrom, initialTo }: Props) => {
  const t = useT();
  const locale = useLocale();
  const { get } = useFetchClient();
  const { toggleNotification } = useNotification();
  const [branch, setBranch] = useState(initialBranch ?? '');
  const [from, setFrom] = useState(initialFrom ?? '');
  const [to, setTo] = useState(initialTo ?? '');
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Re-seed from the caller's filters each time the dialog opens.
  useEffect(() => {
    if (open) {
      setBranch(initialBranch ?? '');
      setFrom(initialFrom ?? '');
      setTo(initialTo ?? '');
      setError(null);
    }
  }, [open]);

  const download = async () => {
    setExporting(true);
    setError(null);
    try {
      const params = new URLSearchParams({ from, to });
      if (branch) params.set('branch', branch);
      const response = await get(`/ordering/orders/export?${params.toString()}`, {
        responseType: 'blob',
      } as never);
      const headers = (response as { headers?: Record<string, unknown> }).headers ?? {};
      const name =
        /filename="([^"]+)"/.exec(String(headers['content-disposition'] ?? ''))?.[1] ??
        `don-hang-${from}_${to}.csv`;
      const url = URL.createObjectURL(
        new Blob([response.data as BlobPart], { type: 'text/csv;charset=utf-8' }),
      );
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = name;
      anchor.click();
      URL.revokeObjectURL(url);
      toggleNotification({ type: 'success', message: t('export.done') });
      onClose();
    } catch (caught) {
      const api = await readBlobError(caught);
      const known = api.code ? t(`error.${api.code}`, undefined, '') : '';
      const message = known || api.message || t('export.failed');
      setError(message);
      toggleNotification({ type: 'danger', message });
    } finally {
      setExporting(false);
    }
  };

  return (
    <Modal.Root open={open} onOpenChange={(next: boolean) => (!next && !exporting ? onClose() : undefined)}>
      <Modal.Content>
        <Modal.Header>
          <Modal.Title>{t('export.title')}</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          <Flex direction="column" alignItems="stretch" gap={4}>
            {error ? (
              <Alert variant="danger" closeLabel={t('common.close')} title={t('common.error.title')}>
                {error}
              </Alert>
            ) : null}
            <Flex gap={4} wrap="wrap">
              <Field.Root>
                <Field.Label>{t('export.field.from')}</Field.Label>
                <TextInput
                  type="date"
                  value={from}
                  onChange={(event: React.ChangeEvent<HTMLInputElement>) => setFrom(event.target.value)}
                />
              </Field.Root>
              <Field.Root>
                <Field.Label>{t('export.field.to')}</Field.Label>
                <TextInput
                  type="date"
                  value={to}
                  onChange={(event: React.ChangeEvent<HTMLInputElement>) => setTo(event.target.value)}
                />
              </Field.Root>
            </Flex>
            {branches.length > 0 ? (
              <Field.Root>
                <Field.Label>{t('export.field.branch')}</Field.Label>
                <Box>
                  <select
                    value={branch}
                    onChange={(event: React.ChangeEvent<HTMLSelectElement>) =>
                      setBranch(event.target.value)
                    }
                    style={{
                      width: '100%',
                      padding: '8px 12px',
                      borderRadius: '4px',
                      border: '1px solid #dcdce4',
                      font: 'inherit',
                    }}
                  >
                    <option value="">{t('export.field.allBranches')}</option>
                    {branches.map((option) => (
                      <option key={option.code} value={option.code}>
                        {localized(option.name, locale) || option.code}
                      </option>
                    ))}
                  </select>
                </Box>
              </Field.Root>
            ) : null}
            <Typography variant="pi" textColor="warning700">
              {t('export.warning', {
                rows: ORDER_EXPORT_MAX_ROWS.toLocaleString('vi-VN'),
                days: ORDER_EXPORT_MAX_DAYS,
              })}
            </Typography>
          </Flex>
        </Modal.Body>
        <Modal.Footer>
          <Modal.Close>
            <Button variant="tertiary" disabled={exporting}>
              {t('common.cancel')}
            </Button>
          </Modal.Close>
          <Button
            startIcon={<FileCsv />}
            loading={exporting}
            disabled={!from || !to}
            onClick={() => void download()}
          >
            {t('export.download')}
          </Button>
        </Modal.Footer>
      </Modal.Content>
    </Modal.Root>
  );
};
