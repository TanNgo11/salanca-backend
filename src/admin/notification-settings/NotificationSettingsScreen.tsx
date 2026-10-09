import { useEffect, useState } from 'react';

import { Alert, Box, Button, Flex, Typography } from '@strapi/design-system';
import { Check, PaperPlane } from '@strapi/icons';
import { Layouts, Page, useFetchClient, useNotification } from '@strapi/strapi/admin';

import { EmailChipInput } from './EmailChipInput';
import {
  canSaveSettings,
  hasOverLimitFallback,
  initialDrafts,
  MAX_RECIPIENTS_PER_KIND,
  mergePendingRecipients,
  NOTIFICATION_KIND_LABELS_VI,
  NOTIFICATION_KINDS,
  NOTIFICATION_SETTINGS_PATH,
  notificationSettingsPermissions,
  notificationTestPath,
  type NotificationKind,
  type NotificationSettingsView,
  type PendingRecipientText,
  type RecipientDrafts,
} from './notification-settings.helper';

const LOAD_FAILED = 'Không tải được cài đặt email. Vui lòng thử lại.';
const SAVE_FAILED = 'Không lưu được. Vui lòng thử lại.';

const readError = (error: unknown, fallback: string): string =>
  (error as { response?: { data?: { error?: { message?: string } } } } | null)?.response?.data
    ?.error?.message ?? fallback;

const emptyDrafts = (): RecipientDrafts =>
  Object.fromEntries(NOTIFICATION_KINDS.map((kind) => [kind, []])) as RecipientDrafts;

const NotificationSettingsScreen = () => {
  const { get, put, post } = useFetchClient();
  const { toggleNotification } = useNotification();
  const [view, setView] = useState<NotificationSettingsView | null>(null);
  const [drafts, setDrafts] = useState(emptyDrafts);
  const [pending, setPending] = useState<PendingRecipientText>({});
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<NotificationKind, string>>>({});
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState<NotificationKind | null>(null);

  const apply = (next: NotificationSettingsView): void => {
    setView(next);
    setDrafts(initialDrafts(next));
    setPending({});
    setFieldErrors({});
  };

  useEffect(() => {
    get<{ data: NotificationSettingsView }>(NOTIFICATION_SETTINGS_PATH)
      .then((response) => apply(response.data.data))
      .catch(() => toggleNotification({ type: 'danger', message: LOAD_FAILED }));
  }, []);

  const canSave = canSaveSettings(view, drafts, pending);
  // Test mail goes to the saved list, so it waits until there is nothing to save.
  const canTest = view !== null && view.saved && !canSave;

  const onSave = async (): Promise<void> => {
    // Text typed without Enter still counts: turn it into chips first.
    const { lists, invalid } = mergePendingRecipients(drafts, pending);
    setDrafts(lists);
    const invalidKinds = NOTIFICATION_KINDS.filter((kind) => invalid[kind]);
    if (invalidKinds.length > 0) {
      setPending(
        Object.fromEntries(invalidKinds.map((kind) => [kind, invalid[kind]!.join(' ')])),
      );
      setFieldErrors(
        Object.fromEntries(
          invalidKinds.map((kind) => [kind, `Email không hợp lệ: ${invalid[kind]!.join(', ')}`]),
        ),
      );
      toggleNotification({
        type: 'danger',
        message: 'Còn email không hợp lệ. Sửa hoặc xoá rồi bấm Lưu lại.',
      });
      return;
    }
    setPending({});
    setSaving(true);
    try {
      const response = await put<{ data: NotificationSettingsView }>(NOTIFICATION_SETTINGS_PATH, {
        recipients: lists,
      });
      apply(response.data.data);
      toggleNotification({ type: 'success', message: 'Đã lưu email thông báo.' });
    } catch (error: unknown) {
      toggleNotification({ type: 'danger', message: readError(error, SAVE_FAILED) });
    } finally {
      setSaving(false);
    }
  };

  const onTest = async (kind: NotificationKind): Promise<void> => {
    setTesting(kind);
    try {
      const response = await post<{ data: { recipientCount: number } }>(
        notificationTestPath(kind),
      );
      toggleNotification({
        type: 'success',
        message: `Đã gửi email thử tới ${response.data.data.recipientCount} địa chỉ. Kiểm tra hộp thư (cả mục Spam).`,
      });
    } catch (error: unknown) {
      toggleNotification({ type: 'danger', message: readError(error, 'Gửi thử thất bại.') });
    } finally {
      setTesting(null);
    }
  };

  return (
    <Page.Protect permissions={notificationSettingsPermissions}>
      <Page.Title>Email thông báo</Page.Title>
      <Page.Main>
        <Layouts.Header
          primaryAction={
            <Button
              disabled={!canSave}
              loading={saving}
              onClick={() => void onSave()}
              startIcon={<Check />}
            >
              Lưu
            </Button>
          }
          subtitle="Email nhận thông báo khi khách gửi form trên website."
          title="Email thông báo"
        />
        <Layouts.Content>
          <Flex alignItems="stretch" direction="column" gap={4}>
            {view && !view.smtpConfigured ? (
              <Alert closeLabel="Đóng" title="Chưa gửi được email" variant="danger">
                Máy chủ chưa cấu hình gửi email (EMAIL_SMTP_HOST). Danh sách vẫn lưu được nhưng chưa
                có email nào được gửi. Liên hệ kỹ thuật.
              </Alert>
            ) : null}
            {view && !view.saved ? (
              <Alert closeLabel="Đóng" title="Đang dùng giá trị mặc định" variant="default">
                Danh sách dưới đây lấy từ cấu hình máy chủ. Bấm Lưu một lần để quản lý tại đây.
              </Alert>
            ) : null}
            {view && hasOverLimitFallback(view) ? (
              <Alert closeLabel="Đóng" title="Danh sách mặc định quá dài" variant="warning">
                Cấu hình máy chủ có hơn {MAX_RECIPIENTS_PER_KIND} email. Chỉ {MAX_RECIPIENTS_PER_KIND}{' '}
                email đầu được giữ lại khi bấm Lưu.
              </Alert>
            ) : null}
            {NOTIFICATION_KINDS.map((kind) => (
              <Box
                background="neutral0"
                hasRadius
                key={kind}
                padding={6}
                shadow="tableShadow"
              >
                <EmailChipInput
                  disabled={view === null}
                  hint={`Tối đa ${MAX_RECIPIENTS_PER_KIND} email. Không có email nào thì mục này không gửi thông báo.`}
                  id={`recipients-${kind}`}
                  draft={pending[kind] ?? ''}
                  externalError={fieldErrors[kind]}
                  label={NOTIFICATION_KIND_LABELS_VI[kind]}
                  onChange={(next) => setDrafts((current) => ({ ...current, [kind]: next }))}
                  onDraftChange={(next) => {
                    setPending((current) => ({ ...current, [kind]: next }));
                    setFieldErrors((current) => ({ ...current, [kind]: undefined }));
                  }}
                  value={drafts[kind]}
                />
                <Flex justifyContent="space-between" paddingTop={3}>
                  <Typography textColor="neutral600" variant="pi">
                    {view !== null && !canTest
                      ? 'Lưu trước khi gửi thử. Email thử đi tới danh sách đã lưu.'
                      : ''}
                  </Typography>
                  <Button
                    disabled={!canTest}
                    loading={testing === kind}
                    onClick={() => void onTest(kind)}
                    startIcon={<PaperPlane />}
                    variant="secondary"
                  >
                    Gửi thử
                  </Button>
                </Flex>
              </Box>
            ))}
          </Flex>
        </Layouts.Content>
      </Page.Main>
    </Page.Protect>
  );
};

export default NotificationSettingsScreen;
