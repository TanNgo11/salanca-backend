import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Alert,
  Badge,
  Box,
  Button,
  Dialog,
  Divider,
  Field,
  Flex,
  Loader,
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
import { ArrowsCounterClockwise, CheckCircle, Mail, Pencil } from '@strapi/icons';
import { useFetchClient, useNotification } from '@strapi/strapi/admin';

import { apiErrorOf, useErrorToast } from '../../lib/api';
import { useLocale, type Translate } from '../../lib/i18n';

type TemplateLocale = 'vi' | 'en';

type TemplateVar = {
  name: string;
  line?: boolean;
  markdown?: boolean;
  description: [vi: string, en: string];
};

type TemplateDetail = {
  code: string;
  locale: string;
  name: [vi: string, en: string];
  audience: 'staff' | 'customer';
  subject: string;
  body: string;
  customized: boolean;
  defaults: { subject: string; body: string };
  variables: TemplateVar[];
  updatedBy: string | null;
  updatedAt: string | null;
};

type ListRow = {
  code: string;
  name: [vi: string, en: string];
  audience: 'staff' | 'customer';
  locales: Record<TemplateLocale, { customized: boolean }>;
};

type Rendered = { subject: string; text: string; html: string };

/** vi|en label from a `[vi, en]` pair — server keeps both so the admin needs no locale branch. */
const pick = (pair: [string, string], locale: string) => (locale === 'en' ? pair[1] : pair[0]);

/** X4 "Mẫu email" — template list; a selected row opens the inline editor below. */
const EmailTemplatesBlock = ({ t }: { t: Translate }) => {
  const { get, put, post, del } = useFetchClient();
  const { toggleNotification } = useNotification();
  const toastError = useErrorToast();
  const uiLocale = useLocale();

  const [rows, setRows] = useState<ListRow[] | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [selected, setSelected] = useState<{ code: string; locale: TemplateLocale } | null>(null);
  const [detail, setDetail] = useState<TemplateDetail | null>(null);
  const [draft, setDraft] = useState<{ subject: string; body: string }>({ subject: '', body: '' });
  const [preview, setPreview] = useState<Rendered | null>(null);
  const [unknownVars, setUnknownVars] = useState<string[]>([]);
  const [busy, setBusy] = useState<'idle' | 'saving' | 'testing' | 'previewing' | 'resetting'>('idle');
  const [confirmReset, setConfirmReset] = useState(false);
  const bodyRef = useRef<HTMLTextAreaElement | null>(null);

  const load = useCallback(async () => {
    try {
      const { data } = await get('/ordering/notification-templates');
      setRows((data as { results: ListRow[] }).results);
      setState('ready');
    } catch {
      setState('error');
    }
  }, [get]);

  useEffect(() => {
    void load();
  }, [load]);

  const open = useCallback(
    async (code: string, locale: TemplateLocale) => {
      setSelected({ code, locale });
      setDetail(null);
      setPreview(null);
      setUnknownVars([]);
      try {
        const { data } = await get(`/ordering/notification-templates/${code}/${locale}`);
        const next = data as TemplateDetail;
        setDetail(next);
        setDraft({ subject: next.subject, body: next.body });
      } catch (error) {
        setSelected(null);
        toastError(error);
      }
    },
    [get, toastError],
  );

  const knownError = useCallback(
    (error: unknown): boolean => {
      const api = apiErrorOf(error);
      if (api.code === 'TEMPLATE_VARIABLE_UNKNOWN') {
        const vars = api.details?.variables;
        setUnknownVars(Array.isArray(vars) ? (vars as string[]) : []);
        return false;
      }
      setUnknownVars([]);
      return true;
    },
    [],
  );

  const save = async () => {
    if (!selected || busy !== 'idle') return;
    setBusy('saving');
    try {
      const { data } = await put(
        `/ordering/notification-templates/${selected.code}/${selected.locale}`,
        draft,
      );
      const next = data as TemplateDetail;
      setDetail(next);
      setDraft({ subject: next.subject, body: next.body });
      setUnknownVars([]);
      toggleNotification({ type: 'success', message: t('x4.saved') });
      void load();
    } catch (error) {
      if (knownError(error)) toastError(error);
    } finally {
      setBusy('idle');
    }
  };

  const runPreview = async () => {
    if (!selected || busy !== 'idle') return;
    setBusy('previewing');
    try {
      const { data } = await post(
        `/ordering/notification-templates/${selected.code}/${selected.locale}/preview`,
        draft,
      );
      setPreview((data as { rendered: Rendered }).rendered);
      setUnknownVars([]);
    } catch (error) {
      if (knownError(error)) toastError(error);
    } finally {
      setBusy('idle');
    }
  };

  const sendTest = async () => {
    if (!selected || busy !== 'idle') return;
    setBusy('testing');
    try {
      await post(`/ordering/notification-templates/${selected.code}/${selected.locale}/test`, {});
      toggleNotification({ type: 'success', message: t('x4.test.sent') });
    } catch (error) {
      toastError(error);
    } finally {
      setBusy('idle');
    }
  };

  const reset = async () => {
    if (!selected || busy !== 'idle') return;
    setBusy('resetting');
    try {
      await del(`/ordering/notification-templates/${selected.code}/${selected.locale}`);
      setConfirmReset(false);
      toggleNotification({ type: 'success', message: t('x4.reset.done') });
      await open(selected.code, selected.locale);
      void load();
    } catch (error) {
      toastError(error);
    } finally {
      setBusy('idle');
    }
  };

  /** Insert `{{name}}` at the textarea caret (or the end when it isn't focused). */
  const insertVar = (name: string) => {
    const token = `{{${name}}}`;
    const area = bodyRef.current;
    setDraft((current) => {
      if (!area) return { ...current, body: current.body + token };
      const start = area.selectionStart ?? current.body.length;
      const end = area.selectionEnd ?? start;
      const body = `${current.body.slice(0, start)}${token}${current.body.slice(end)}`;
      requestAnimationFrame(() => {
        area.focus();
        area.setSelectionRange(start + token.length, start + token.length);
      });
      return { ...current, body };
    });
  };

  const dirty =
    detail !== null && (draft.subject !== detail.subject || draft.body !== detail.body);

  return (
    <Flex direction="column" alignItems="stretch" gap={4}>
      <Box>
        <Typography variant="delta" tag="h2">
          {t('x4.title')}
        </Typography>
        <Box paddingTop={1}>
          <Typography variant="pi" textColor="neutral600">
            {t('x4.subtitle')}
          </Typography>
        </Box>
      </Box>
      {state === 'loading' ? (
        <Flex justifyContent="center" padding={6}>
          <Loader>{t('common.loading')}</Loader>
        </Flex>
      ) : state === 'error' || !rows ? (
        <Alert
          variant="danger"
          closeLabel={t('common.close')}
          title={t('common.error.title')}
          action={<Button onClick={() => void load()}>{t('common.retry')}</Button>}
        >
          {t('x4.loadFailed')}
        </Alert>
      ) : (
        <Table colCount={5} rowCount={rows.length + 1}>
          <Thead>
            <Tr>
              <Th><Typography variant="sigma">{t('x4.col.name')}</Typography></Th>
              <Th><Typography variant="sigma">{t('x4.col.audience')}</Typography></Th>
              <Th><Typography variant="sigma">VI</Typography></Th>
              <Th><Typography variant="sigma">EN</Typography></Th>
              <Th><Typography variant="sigma">{t('x4.col.action')}</Typography></Th>
            </Tr>
          </Thead>
          <Tbody>
            {rows.map((row) => (
              <Tr key={row.code}>
                <Td><Typography variant="pi">{pick(row.name, uiLocale)}</Typography></Td>
                <Td>
                  <Badge>{t(`x4.audience.${row.audience}`)}</Badge>
                </Td>
                {(['vi', 'en'] as const).map((locale) => (
                  <Td key={locale}>
                    <Badge
                      {...(row.locales[locale].customized
                        ? { textColor: 'primary700', backgroundColor: 'primary100' }
                        : {})}
                    >
                      {row.locales[locale].customized ? t('x4.customized') : t('x4.default')}
                    </Badge>
                  </Td>
                ))}
                <Td>
                  <Flex gap={1}>
                    <Button size="S" variant="tertiary" startIcon={<Pencil />} onClick={() => void open(row.code, 'vi')}>
                      VI
                    </Button>
                    <Button size="S" variant="tertiary" startIcon={<Pencil />} onClick={() => void open(row.code, 'en')}>
                      EN
                    </Button>
                  </Flex>
                </Td>
              </Tr>
            ))}
          </Tbody>
        </Table>
      )}

      {selected ? (
        <>
          <Divider />
          {!detail ? (
            <Flex justifyContent="center" padding={6}>
              <Loader>{t('common.loading')}</Loader>
            </Flex>
          ) : (
            <Flex direction="column" alignItems="stretch" gap={4}>
              <Flex justifyContent="space-between" alignItems="center">
                <Typography variant="delta" tag="h3">
                  {t('x4.editing', { name: pick(detail.name, uiLocale), locale: selected.locale.toUpperCase() })}
                </Typography>
                <Flex gap={2}>
                  <Button size="S" variant="secondary" onClick={() => void open(selected.code, 'vi')} disabled={selected.locale === 'vi'}>
                    VI
                  </Button>
                  <Button size="S" variant="secondary" onClick={() => void open(selected.code, 'en')} disabled={selected.locale === 'en'}>
                    EN
                  </Button>
                </Flex>
              </Flex>
              <Flex gap={4} alignItems="flex-start">
                <Flex direction="column" alignItems="stretch" gap={4} grow={1}>
                  <Field.Root name="subject" required>
                    <Field.Label>{t('x4.field.subject')}</Field.Label>
                    <TextInput
                      value={draft.subject}
                      onChange={(event: React.ChangeEvent<HTMLInputElement>) =>
                        setDraft({ ...draft, subject: event.target.value })
                      }
                    />
                  </Field.Root>
                  <Field.Root name="body" required hint={t('x4.field.body.hint')}>
                    <Field.Label>{t('x4.field.body')}</Field.Label>
                    <Textarea
                      ref={bodyRef}
                      value={draft.body}
                      onChange={(event: React.ChangeEvent<HTMLTextAreaElement>) =>
                        setDraft({ ...draft, body: event.target.value })
                      }
                      style={{ fontFamily: 'monospace', minHeight: '14rem' }}
                    />
                    <Field.Hint />
                  </Field.Root>
                  {unknownVars.length > 0 ? (
                    <Alert variant="danger" closeLabel={t('common.close')} title={t('error.TEMPLATE_VARIABLE_UNKNOWN')}>
                      {unknownVars.map((name) => `{{${name}}}`).join(', ')}
                    </Alert>
                  ) : null}
                  <Flex gap={2}>
                    <Button loading={busy === 'saving'} disabled={!dirty} onClick={() => void save()}>
                      {t('common.save')}
                    </Button>
                    <Button
                      variant="secondary"
                      startIcon={<CheckCircle />}
                      loading={busy === 'previewing'}
                      onClick={() => void runPreview()}
                    >
                      {t('x4.preview')}
                    </Button>
                    <Button
                      variant="secondary"
                      startIcon={<Mail />}
                      loading={busy === 'testing'}
                      onClick={() => void sendTest()}
                    >
                      {t('x4.test')}
                    </Button>
                    {detail.customized ? (
                      <Button
                        variant="danger-light"
                        startIcon={<ArrowsCounterClockwise />}
                        onClick={() => setConfirmReset(true)}
                      >
                        {t('x4.reset')}
                      </Button>
                    ) : null}
                  </Flex>
                  <Typography variant="pi" textColor="neutral600">
                    {detail.updatedBy
                      ? t('x4.lastEdit', { by: detail.updatedBy, at: detail.updatedAt ?? '' })
                      : t('x4.default.note')}
                  </Typography>
                </Flex>
                <Box width="320px" shrink={0}>
                  <Typography variant="sigma" textColor="neutral600">
                    {t('x4.vars')}
                  </Typography>
                  <Flex direction="column" alignItems="stretch" gap={1} paddingTop={2}>
                    {detail.variables.map((variable) => (
                      <button
                        key={variable.name}
                        type="button"
                        onClick={() => insertVar(variable.name)}
                        style={{
                          background: 'none',
                          border: 'none',
                          cursor: 'pointer',
                          padding: '4px 8px',
                          textAlign: 'left',
                        }}
                        title={t('x4.vars.insert')}
                      >
                        <Typography variant="pi" fontWeight="semiBold">{`{{${variable.name}}}`}</Typography>
                        <Typography variant="pi" textColor="neutral600" display="block">
                          {pick(variable.description, uiLocale)}
                        </Typography>
                      </button>
                    ))}
                  </Flex>
                </Box>
              </Flex>
              {preview ? (
                <Box background="neutral100" padding={4} hasRadius>
                  <Typography variant="sigma" textColor="neutral600">
                    {t('x4.preview')}
                  </Typography>
                  <Box paddingTop={2}>
                    <Typography variant="omega" fontWeight="semiBold">
                      {preview.subject}
                    </Typography>
                  </Box>
                  <Box
                    background="neutral0"
                    marginTop={2}
                    padding={4}
                    hasRadius
                    borderColor="neutral200"
                  >
                    <iframe
                      title={t('x4.preview')}
                      sandbox=""
                      srcDoc={preview.html}
                      style={{ border: 0, width: '100%', minHeight: '16rem' }}
                    />
                  </Box>
                </Box>
              ) : null}
            </Flex>
          )}
        </>
      ) : null}

      <Dialog.Root open={confirmReset} onOpenChange={(openState: boolean) => !openState && setConfirmReset(false)}>
        <Dialog.Content>
          <Dialog.Header>{t('x4.reset.title')}</Dialog.Header>
          <Dialog.Body>
            <Flex direction="column" alignItems="stretch" gap={2}>
              <Typography>{t('x4.reset.body')}</Typography>
            </Flex>
          </Dialog.Body>
          <Dialog.Footer>
            <Button variant="tertiary" onClick={() => setConfirmReset(false)}>
              {t('common.cancel')}
            </Button>
            <Button variant="danger" loading={busy === 'resetting'} onClick={() => void reset()}>
              {t('x4.reset')}
            </Button>
          </Dialog.Footer>
        </Dialog.Content>
      </Dialog.Root>
    </Flex>
  );
};

export default EmailTemplatesBlock;
