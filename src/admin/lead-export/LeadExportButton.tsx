import { useState, type ChangeEvent } from 'react';

import {
  Button,
  Field,
  Flex,
  Modal,
  SingleSelect,
  SingleSelectOption,
  TextInput,
  Typography,
} from '@strapi/design-system';
import { FileCsv } from '@strapi/icons';
import { useFetchClient, useNotification, useRBAC } from '@strapi/strapi/admin';
import { useParams } from 'react-router-dom';

import {
  buildLeadExportPath,
  defaultExportRange,
  LEAD_EXPORT_KIND_LABELS,
  leadExportKindsForUid,
  leadExportPermissions,
  type LeadExportKind,
} from './lead-export.helper';

const EXPORT_FAILED = 'Không thể xuất dữ liệu lúc này. Vui lòng thử lại.';

/** A blob response hides the Strapi error JSON; read its message back out. */
const readBlobError = async (error: unknown): Promise<string | null> => {
  const data = (error as { response?: { data?: unknown } } | null)?.response?.data;
  if (!(data instanceof Blob)) {
    return null;
  }
  try {
    const parsed = JSON.parse(await data.text()) as { error?: { message?: string } };
    return parsed.error?.message ?? null;
  } catch {
    return null;
  }
};

type LeadExportDialogProps = {
  kinds: LeadExportKind[];
};

const LeadExportDialog = ({ kinds }: LeadExportDialogProps) => {
  const { get } = useFetchClient();
  const { toggleNotification } = useNotification();
  const [initialRange] = useState(() => defaultExportRange(new Date()));
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<LeadExportKind>(kinds[0]);
  const [from, setFrom] = useState(initialRange.from);
  const [to, setTo] = useState(initialRange.to);
  const [exporting, setExporting] = useState(false);

  const onExport = async (): Promise<void> => {
    setExporting(true);
    try {
      const response = await get(buildLeadExportPath(kind, from, to), {
        responseType: 'blob',
      } as never);
      const headers = (response as { headers?: Record<string, unknown> }).headers ?? {};
      const disposition = String(headers['content-disposition'] ?? '');
      const name = /filename="([^"]+)"/.exec(disposition)?.[1] ?? `${kind}.csv`;
      const url = URL.createObjectURL(
        new Blob([response.data as BlobPart], { type: 'text/csv;charset=utf-8' }),
      );
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = name;
      anchor.click();
      URL.revokeObjectURL(url);
      setOpen(false);
    } catch (error: unknown) {
      toggleNotification({
        type: 'danger',
        message: (await readBlobError(error)) ?? EXPORT_FAILED,
      });
    } finally {
      setExporting(false);
    }
  };

  return (
    <Modal.Root onOpenChange={setOpen} open={open}>
      <Modal.Trigger>
        <Button size="S" startIcon={<FileCsv />} variant="secondary">
          Xuất CSV
        </Button>
      </Modal.Trigger>
      <Modal.Content>
        <Modal.Header closeLabel="Đóng">
          <Modal.Title>Xuất CSV</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          <Flex alignItems="stretch" direction="column" gap={4}>
            {kinds.length > 1 ? (
              <Field.Root name="kind">
                <Field.Label>Loại dữ liệu</Field.Label>
                <SingleSelect
                  onChange={(value: string | number) => setKind(value as LeadExportKind)}
                  value={kind}
                >
                  {kinds.map((key) => (
                    <SingleSelectOption key={key} value={key}>
                      {LEAD_EXPORT_KIND_LABELS[key]}
                    </SingleSelectOption>
                  ))}
                </SingleSelect>
              </Field.Root>
            ) : null}
            <Flex gap={4} wrap="wrap">
              <Field.Root name="from">
                <Field.Label>Từ ngày</Field.Label>
                <TextInput
                  onChange={(event: ChangeEvent<HTMLInputElement>) => setFrom(event.target.value)}
                  type="date"
                  value={from}
                />
              </Field.Root>
              <Field.Root name="to">
                <Field.Label>Đến ngày</Field.Label>
                <TextInput
                  onChange={(event: ChangeEvent<HTMLInputElement>) => setTo(event.target.value)}
                  type="date"
                  value={to}
                />
              </Field.Root>
            </Flex>
            <Typography textColor="neutral600" variant="pi">
              Lọc theo ngày khách gửi. Để trống cả hai ngày để xuất toàn bộ. Tối đa 10.000 dòng
              mỗi lần. File mở được bằng Excel.
            </Typography>
          </Flex>
        </Modal.Body>
        <Modal.Footer>
          <Modal.Close>
            <Button variant="tertiary">Huỷ</Button>
          </Modal.Close>
          <Button loading={exporting} onClick={() => void onExport()} startIcon={<FileCsv />}>
            Xuất CSV
          </Button>
        </Modal.Footer>
      </Modal.Content>
    </Modal.Root>
  );
};

/**
 * Injected into every Content Manager list header; renders only on the lead
 * lists and only for admins holding the export permission.
 */
export const LeadExportButton = () => {
  const { slug } = useParams<{ slug: string }>();
  const kinds = leadExportKindsForUid(slug);
  const { allowedActions, isLoading } = useRBAC(leadExportPermissions);

  if (kinds.length === 0 || isLoading || allowedActions.canExport !== true) {
    return null;
  }

  return <LeadExportDialog key={slug} kinds={kinds} />;
};
