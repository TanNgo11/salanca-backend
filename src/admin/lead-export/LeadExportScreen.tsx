import { useState, type ChangeEvent } from 'react';

import {
  Box,
  Button,
  Field,
  Flex,
  SingleSelect,
  SingleSelectOption,
  TextInput,
  Typography,
} from '@strapi/design-system';
import { FileCsv } from '@strapi/icons';
import { Layouts, Page, useFetchClient, useNotification } from '@strapi/strapi/admin';

import {
  buildLeadExportPath,
  defaultExportRange,
  LEAD_EXPORT_KIND_LABELS,
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

const LeadExportScreen = () => {
  const { get } = useFetchClient();
  const { toggleNotification } = useNotification();
  const [initialRange] = useState(() => defaultExportRange(new Date()));
  const [kind, setKind] = useState<LeadExportKind>('reservations');
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
    <Page.Protect permissions={leadExportPermissions}>
      <Page.Title>Xuất dữ liệu khách</Page.Title>
      <Page.Main>
        <Layouts.Header
          subtitle="Tải file CSV mở được bằng Excel. Lọc theo ngày khách gửi."
          title="Xuất dữ liệu khách"
        />
        <Layouts.Content>
          <Box background="neutral0" hasRadius padding={6} shadow="tableShadow">
            <Flex alignItems="flex-end" gap={4} wrap="wrap">
              <Field.Root name="kind">
                <Field.Label>Loại dữ liệu</Field.Label>
                <SingleSelect
                  onChange={(value: string | number) => setKind(value as LeadExportKind)}
                  value={kind}
                >
                  {(Object.keys(LEAD_EXPORT_KIND_LABELS) as LeadExportKind[]).map((key) => (
                    <SingleSelectOption key={key} value={key}>
                      {LEAD_EXPORT_KIND_LABELS[key]}
                    </SingleSelectOption>
                  ))}
                </SingleSelect>
              </Field.Root>
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
              <Button loading={exporting} onClick={() => void onExport()} startIcon={<FileCsv />}>
                Xuất CSV
              </Button>
            </Flex>
            <Box paddingTop={4}>
              <Typography textColor="neutral600" variant="pi">
                Để trống cả hai ngày để xuất toàn bộ. Tối đa 10.000 dòng mỗi lần.
              </Typography>
            </Box>
          </Box>
        </Layouts.Content>
      </Page.Main>
    </Page.Protect>
  );
};

export default LeadExportScreen;
