import { Fragment, useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Badge,
  Box,
  Button,
  Checkbox,
  Dialog,
  Field,
  Flex,
  Grid,
  IconButton,
  Loader,
  SingleSelect,
  SingleSelectOption,
  Table,
  Tabs,
  Tbody,
  Td,
  TextInput,
  Th,
  Thead,
  Tr,
  Typography,
  VisuallyHidden,
} from '@strapi/design-system';
import { ArrowLeft, Duplicate } from '@strapi/icons';
import { Layouts, useFetchClient, useNotification } from '@strapi/strapi/admin';
import { useLocation, useNavigate, useParams } from 'react-router-dom';

import { apiErrorOf, fieldErrors, useErrorToast } from '../../lib/api';
import { formatDateTime } from '../../lib/format';
import { useLocale, useT } from '../../lib/i18n';
import type { EndpointRow } from './index';

type CatalogEvent = {
  type: string;
  group: string;
  description: Record<string, string>;
  orderScoped: boolean;
  sample: Record<string, unknown>;
};

type DeliveryRow = {
  id: number;
  eventType: string;
  status: 'pending' | 'succeeded' | 'failed';
  attempts: number;
  nextAttemptAt: string | null;
  lastStatusCode: number | null;
  lastError: string | null;
  lastDurationMs: number | null;
  createdAt: string;
  orderCode: string | null;
  payload: Record<string, unknown>;
};

type TestResult = { ok: boolean; statusCode: number | null; durationMs: number; error: string | null };

const GROUP_ORDER = ['order', 'payment', 'refund', 'fulfillment', 'ops', 'promotion', 'gift-card', 'rating'];

const SecretBox = ({ secret }: { secret: string }) => {
  const t = useT();
  const { toggleNotification } = useNotification();
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(secret);
      toggleNotification({ type: 'success', message: t('webhook.secret.copied') });
    } catch {
      toggleNotification({ type: 'warning', message: secret });
    }
  };
  return (
    <Alert variant="warning" closeLabel={t('common.close')} title={t('webhook.secret.title')}>
      <Flex direction="column" alignItems="stretch" gap={2}>
        <Flex gap={2} alignItems="center">
          <Box
            background="neutral100"
            padding={3}
            hasRadius
            style={{ fontFamily: 'monospace', wordBreak: 'break-all', flex: 1 }}
          >
            {secret}
          </Box>
          <Button variant="secondary" startIcon={<Duplicate />} onClick={() => void copy()}>
            {t('webhook.secret.copy')}
          </Button>
        </Flex>
        <Typography variant="pi">{t('webhook.secret.once')}</Typography>
        <Typography variant="pi">{t('webhook.secret.grace')}</Typography>
      </Flex>
    </Alert>
  );
};

const DeliveriesTab = ({ endpointId }: { endpointId: number }) => {
  const t = useT();
  const { get, post } = useFetchClient();
  const { toggleNotification } = useNotification();
  const toastError = useErrorToast();
  const [status, setStatus] = useState('');
  const [rows, setRows] = useState<DeliveryRow[] | null>(null);
  const [error, setError] = useState(false);
  const [open, setOpen] = useState<number | null>(null);

  const load = useCallback(async () => {
    try {
      const { data } = await get(
        `/ordering/webhooks/${endpointId}/deliveries${status ? `?status=${status}` : ''}`,
      );
      setRows((data as { results: DeliveryRow[] }).results);
      setError(false);
    } catch {
      setError(true);
    }
  }, [endpointId, get, status]);

  useEffect(() => {
    void load();
  }, [load]);

  const resend = async (id: number) => {
    try {
      await post(`/ordering/webhook-deliveries/${id}/resend`);
      toggleNotification({ type: 'success', message: t('webhook.delivery.resent') });
      void load();
    } catch (err) {
      toastError(err);
    }
  };

  if (error) {
    return (
      <Alert variant="danger" closeLabel={t('common.close')} title={t('common.error.title')}>
        {t('webhook.delivery.loadFailed')}
      </Alert>
    );
  }
  if (!rows) {
    return (
      <Flex justifyContent="center" padding={8}>
        <Loader>{t('common.loading')}</Loader>
      </Flex>
    );
  }
  return (
    <Flex direction="column" alignItems="stretch" gap={4}>
      <Box maxWidth="240px">
        <SingleSelect
          aria-label={t('webhook.col.status')}
          value={status}
          onChange={(value: string | number) => setStatus(String(value))}
        >
          {['', 'pending', 'succeeded', 'failed'].map((value) => (
            <SingleSelectOption key={value || 'all'} value={value}>
              {t(`webhook.deliveries.filter.${value || 'all'}`)}
            </SingleSelectOption>
          ))}
        </SingleSelect>
      </Box>
      {rows.length === 0 ? (
        <Typography>{t('webhook.deliveries.empty')}</Typography>
      ) : (
        <Table colCount={7} rowCount={rows.length + 1}>
          <Thead>
            <Tr>
              {['at', 'event', 'order', 'result', 'attempts', 'next'].map((column) => (
                <Th key={column}>
                  <Typography variant="sigma">{t(`webhook.delivery.col.${column}`)}</Typography>
                </Th>
              ))}
              <Th><VisuallyHidden>{t('webhook.delivery.resend')}</VisuallyHidden></Th>
            </Tr>
          </Thead>
          <Tbody>
            {rows.map((row) => (
              <Fragment key={row.id}>
                <Tr onClick={() => setOpen(open === row.id ? null : row.id)} style={{ cursor: 'pointer' }}>
                  <Td>
                    <Typography>{formatDateTime(row.createdAt)}</Typography>
                  </Td>
                  <Td>
                    <Typography>{row.eventType}</Typography>
                  </Td>
                  <Td>
                    <Typography>{row.orderCode ?? '—'}</Typography>
                  </Td>
                  <Td>
                    {row.lastStatusCode ? (
                      <Badge {...(row.status === 'succeeded' ? { textColor: 'success700', backgroundColor: 'success100' } : { textColor: 'danger700', backgroundColor: 'danger100' })}>
                        {`HTTP ${row.lastStatusCode}`}
                      </Badge>
                    ) : (
                      <Badge {...(row.status === 'pending' ? {} : { textColor: 'danger700', backgroundColor: 'danger100' })}>
                        {row.lastError ?? row.status}
                      </Badge>
                    )}
                  </Td>
                  <Td>
                    <Typography>{row.attempts}</Typography>
                  </Td>
                  <Td>
                    <Typography>{row.status === 'pending' ? formatDateTime(row.nextAttemptAt) : '—'}</Typography>
                  </Td>
                  <Td>
                    {row.status === 'failed' ? (
                      <Button
                        size="S"
                        variant="tertiary"
                        onClick={(event: React.MouseEvent) => {
                          event.stopPropagation();
                          void resend(row.id);
                        }}
                      >
                        {t('webhook.delivery.resend')}
                      </Button>
                    ) : null}
                  </Td>
                </Tr>
                {open === row.id ? (
                  <Tr>
                    <Td colSpan={7}>
                      <Box background="neutral100" padding={4} hasRadius>
                        <Typography variant="pi" fontWeight="bold">
                          {t('webhook.delivery.payload')}
                        </Typography>
                        <Box tag="pre" marginTop={2} style={{ overflowX: 'auto', fontSize: '12px' }}>
                          {JSON.stringify(row.payload, null, 2)}
                        </Box>
                      </Box>
                    </Td>
                  </Tr>
                ) : null}
              </Fragment>
            ))}
          </Tbody>
        </Table>
      )}
    </Flex>
  );
};

/**
 * "Webhook" editor (screens X1): create/edit on a dedicated page. The signing secret returned by
 * create/rotate is rendered exactly once and never re-fetched. "Gửi thử" posts a synthetic
 * `ordering.ping` and shows the result inline. The deliveries tab lists attempts with resend.
 */
export const WebhookEditor = () => {
  const t = useT();
  const locale = useLocale();
  const navigate = useNavigate();
  const location = useLocation();
  const { id } = useParams();
  const creating = id === undefined;
  const { get, post, put } = useFetchClient();
  const { toggleNotification } = useNotification();
  const toastError = useErrorToast();

  const [endpoint, setEndpoint] = useState<EndpointRow | null>(null);
  const [catalog, setCatalog] = useState<CatalogEvent[] | null>(null);
  const [url, setUrl] = useState('');
  const [description, setDescription] = useState('');
  const [events, setEvents] = useState<string[]>([]);
  const [includeCustomer, setIncludeCustomer] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>(creating ? 'ready' : 'loading');
  const [saving, setSaving] = useState(false);
  const [piiAsk, setPiiAsk] = useState(false);
  const [sampleOpen, setSampleOpen] = useState<string | null>(null);
  const [rotateAsk, setRotateAsk] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<TestResult | null>(null);
  const [secret, setSecret] = useState<string | null>(
    (location.state as { secret?: string } | null)?.secret ?? null,
  );

  const load = useCallback(async () => {
    try {
      const [{ data: item }, { data: cat }] = await Promise.all([
        get(`/ordering/webhooks/${id}`),
        get('/ordering/webhooks/events'),
      ]);
      const row = (item as { item: EndpointRow }).item;
      setEndpoint(row);
      setUrl(row.url);
      setDescription(row.description ?? '');
      setEvents(row.events);
      setIncludeCustomer(row.includeCustomer);
      setCatalog((cat as { results: CatalogEvent[] }).results);
      setStatus('ready');
    } catch {
      setStatus('error');
    }
  }, [id, get]);

  useEffect(() => {
    if (creating) {
      void get('/ordering/webhooks/events')
        .then(({ data }) => setCatalog((data as { results: CatalogEvent[] }).results))
        .catch(() => undefined);
    } else {
      void load();
    }
  }, [creating, get, load]);

  const groups = useMemo(() => {
    const map = new Map<string, CatalogEvent[]>();
    for (const spec of catalog ?? []) {
      map.set(spec.group, [...(map.get(spec.group) ?? []), spec]);
    }
    return [...map.entries()].sort(
      (a, b) => GROUP_ORDER.indexOf(a[0]) - GROUP_ORDER.indexOf(b[0]),
    );
  }, [catalog]);

  if (status === 'loading') {
    return (
      <Flex justifyContent="center" padding={10}>
        <Loader>{t('common.loading')}</Loader>
      </Flex>
    );
  }
  if (status === 'error' || (!creating && !endpoint)) {
    return (
      <Layouts.Content>
        <Alert
          variant="danger"
          closeLabel={t('common.close')}
          title={t('common.error.title')}
          action={<Button onClick={() => void load()}>{t('common.retry')}</Button>}
        >
          {t('webhook.loadFailed')}
        </Alert>
      </Layouts.Content>
    );
  }

  const toggleEvent = (type: string) =>
    setEvents((current) => (current.includes(type) ? current.filter((item) => item !== type) : [...current, type]));

  const urlError = (error: unknown): string | null => {
    const apiError = apiErrorOf(error);
    if (apiError.code !== 'WEBHOOK_URL_INVALID') return null;
    const reason = typeof apiError.details?.reason === 'string' ? apiError.details.reason : 'invalid';
    return t(`error.WEBHOOK_URL_INVALID.${reason}`, undefined, t('error.WEBHOOK_URL_INVALID'));
  };

  const save = async () => {
    setSaving(true);
    setErrors({});
    const payload = { url, description: description || null, events, includeCustomer };
    try {
      const { data } = creating
        ? await post('/ordering/webhooks', payload)
        : await put(`/ordering/webhooks/${id}`, payload);
      const result = data as { endpoint: EndpointRow; secret?: string };
      toggleNotification({ type: 'success', message: t('webhook.saved') });
      if (creating) {
        navigate(`../${result.endpoint.id}`, { state: { secret: result.secret ?? null }, replace: true });
      } else {
        setEndpoint(result.endpoint);
      }
    } catch (error) {
      const urlErr = urlError(error);
      if (urlErr) {
        setErrors({ url: urlErr });
      } else {
        const fields = fieldErrors(error);
        setErrors(fields);
        if (Object.keys(fields).length === 0) toastError(error);
      }
    } finally {
      setSaving(false);
    }
  };

  const rotate = async () => {
    setRotateAsk(false);
    try {
      const { data } = await post(`/ordering/webhooks/${id}/rotate-secret`);
      setSecret((data as { secret?: string }).secret ?? null);
    } catch (error) {
      toastError(error);
    }
  };

  const sendTest = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const { data } = await post(`/ordering/webhooks/${id}/test`);
      setTestResult(data as TestResult);
    } catch (error) {
      toastError(error);
    } finally {
      setTesting(false);
    }
  };

  const settingsTab = (
    <Flex direction="column" alignItems="stretch" gap={4}>
      {secret ? <SecretBox secret={secret} /> : null}
      <Grid.Root gap={4}>
        <Grid.Item col={8} s={12}>
          <Field.Root required error={errors.url} hint={t('webhook.field.url.hint')}>
            <Field.Label>{t('webhook.field.url')}</Field.Label>
            <TextInput
              value={url}
              placeholder="https://example.com/webhooks/ordering"
              onChange={(event: React.ChangeEvent<HTMLInputElement>) => setUrl(event.target.value)}
            />
            <Field.Hint />
            <Field.Error />
          </Field.Root>
        </Grid.Item>
        <Grid.Item col={8} s={12}>
          <Field.Root error={errors.description}>
            <Field.Label>{t('webhook.field.description')}</Field.Label>
            <TextInput
              value={description}
              onChange={(event: React.ChangeEvent<HTMLInputElement>) => setDescription(event.target.value)}
            />
            <Field.Error />
          </Field.Root>
        </Grid.Item>
      </Grid.Root>
      <Field.Root error={errors.events}>
        <Field.Label>{t('webhook.field.events')}</Field.Label>
        <Flex direction="column" alignItems="stretch" gap={4} marginTop={2}>
          {groups.map(([group, specs]) => (
            <Box key={group}>
              <Typography variant="sigma">{t(`webhook.group.${group}`)}</Typography>
              <Flex direction="column" alignItems="stretch" gap={2} marginTop={2}>
                {specs.map((spec) => (
                  <Flex key={spec.type} direction="column" alignItems="stretch" gap={1}>
                    <Flex gap={2} alignItems="center">
                      <Checkbox
                        checked={events.includes(spec.type)}
                        onCheckedChange={() => toggleEvent(spec.type)}
                        aria-label={spec.type}
                      />
                      <Typography fontWeight="semiBold">{spec.type}</Typography>
                      <Button
                        size="S"
                        variant="ghost"
                        onClick={() => setSampleOpen(sampleOpen === spec.type ? null : spec.type)}
                      >
                        {t('webhook.samplePayload')}
                      </Button>
                    </Flex>
                    <Typography variant="pi" textColor="neutral600">
                      {spec.description[locale] ?? spec.description.vi}
                    </Typography>
                    {sampleOpen === spec.type ? (
                      <Box
                        tag="pre"
                        background="neutral100"
                        padding={3}
                        hasRadius
                        style={{ overflowX: 'auto', fontSize: '12px' }}
                      >
                        {JSON.stringify(
                          {
                            id: '123',
                            type: spec.type,
                            apiVersion: '2026-10',
                            occurredAt: '2026-10-12T09:30:00.000Z',
                            data: spec.sample,
                          },
                          null,
                          2,
                        )}
                      </Box>
                    ) : null}
                  </Flex>
                ))}
              </Flex>
            </Box>
          ))}
        </Flex>
        <Field.Error />
      </Field.Root>
      <Flex gap={2} alignItems="center">
        <Checkbox
          checked={includeCustomer}
          onCheckedChange={(value: boolean) => (value ? setPiiAsk(true) : setIncludeCustomer(false))}
          aria-label={t('webhook.field.includeCustomer')}
        />
        <Typography>{t('webhook.field.includeCustomer')}</Typography>
      </Flex>
    </Flex>
  );

  return (
    <>
      <Layouts.Header
        navigationAction={
          <IconButton label={t('common.back')} variant="ghost" onClick={() => navigate('..')}>
            <ArrowLeft />
          </IconButton>
        }
        title={creating ? t('webhook.new') : endpoint?.description || t('webhook.edit')}
        subtitle={creating ? undefined : endpoint?.url}
        primaryAction={
          <Flex gap={2}>
            {!creating ? (
              <>
                <Button variant="tertiary" loading={testing} onClick={() => void sendTest()}>
                  {t('webhook.test')}
                </Button>
                <Button variant="secondary" onClick={() => setRotateAsk(true)}>
                  {t('webhook.rotate')}
                </Button>
              </>
            ) : null}
            <Button loading={saving} onClick={() => void save()}>
              {t('common.save')}
            </Button>
          </Flex>
        }
      />
      <Layouts.Content>
        {testResult ? (
          <Box marginBottom={4}>
            <Alert
              variant={testResult.ok ? 'success' : 'danger'}
              closeLabel={t('common.close')}
              title={t('webhook.test')}
              onClose={() => setTestResult(null)}
            >
              {testResult.ok
                ? t('webhook.test.ok', { code: testResult.statusCode ?? 0, ms: testResult.durationMs })
                : t('webhook.test.fail', { error: testResult.error ?? 'error', ms: testResult.durationMs })}
            </Alert>
          </Box>
        ) : null}
        {creating ? (
          <Box background="neutral0" padding={6} hasRadius shadow="tableShadow">
            {settingsTab}
          </Box>
        ) : (
          <Tabs.Root defaultValue="settings">
            <Tabs.List aria-label={t('webhook.title')}>
              <Tabs.Trigger value="settings">{t('webhook.tab.settings')}</Tabs.Trigger>
              <Tabs.Trigger value="deliveries">{t('webhook.tab.deliveries')}</Tabs.Trigger>
            </Tabs.List>
            <Box background="neutral0" padding={6} hasRadius shadow="tableShadow" marginTop={4}>
              <Tabs.Content value="settings">{settingsTab}</Tabs.Content>
              <Tabs.Content value="deliveries">
                <DeliveriesTab endpointId={endpoint!.id} />
              </Tabs.Content>
            </Box>
          </Tabs.Root>
        )}
      </Layouts.Content>
      <Dialog.Root open={piiAsk} onOpenChange={(open: boolean) => !open && setPiiAsk(false)}>
        <Dialog.Content>
          <Dialog.Header>{t('webhook.pii.title')}</Dialog.Header>
          <Dialog.Body>{t('webhook.pii.body')}</Dialog.Body>
          <Dialog.Footer>
            <Dialog.Cancel>
              <Button variant="tertiary">{t('common.cancel')}</Button>
            </Dialog.Cancel>
            <Dialog.Action>
              <Button
                variant="danger"
                onClick={() => {
                  setIncludeCustomer(true);
                  setPiiAsk(false);
                }}
              >
                {t('webhook.pii.confirm')}
              </Button>
            </Dialog.Action>
          </Dialog.Footer>
        </Dialog.Content>
      </Dialog.Root>
      <Dialog.Root open={rotateAsk} onOpenChange={(open: boolean) => !open && setRotateAsk(false)}>
        <Dialog.Content>
          <Dialog.Header>{t('webhook.rotate')}</Dialog.Header>
          <Dialog.Body>{t('webhook.rotate.confirm')}</Dialog.Body>
          <Dialog.Footer>
            <Dialog.Cancel>
              <Button variant="tertiary">{t('common.cancel')}</Button>
            </Dialog.Cancel>
            <Dialog.Action>
              <Button variant="secondary" onClick={() => void rotate()}>
                {t('webhook.rotate')}
              </Button>
            </Dialog.Action>
          </Dialog.Footer>
        </Dialog.Content>
      </Dialog.Root>
    </>
  );
};
