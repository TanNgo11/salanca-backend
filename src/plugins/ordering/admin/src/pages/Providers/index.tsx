import { useEffect, useState } from 'react';
import {
  Alert,
  Badge,
  Box,
  EmptyStateLayout,
  Flex,
  Loader,
  Typography,
} from '@strapi/design-system';
import { Layouts, Page, useFetchClient } from '@strapi/strapi/admin';

import { useErrorToast } from '../../lib/api';
import { formatDateTime } from '../../lib/format';
import { useT, type Translate } from '../../lib/i18n';
import { PERMISSIONS } from '../../lib/permissions';

type WebhookHealth = {
  lastSuccessAt: string | null;
  lastFailureAt: string | null;
  consecutiveFailures: number;
  state: 'ok' | 'slow' | 'failing';
};

type ProviderCard = {
  code: string;
  group: 'payment' | 'fulfillment' | 'notification';
  state: 'configured' | 'unconfigured' | 'error' | 'not-implemented';
  environment: 'sandbox' | 'production' | null;
  partnerRef: string | null;
  envNeeded: string[];
  webhookPath: string | null;
  webhookUrl: string | null;
  docsPath: string | null;
  webhookHealth: WebhookHealth | null;
};

type Body = {
  now: string;
  publicApiUrl: string;
  groups: Array<{ key: ProviderCard['group']; cards: ProviderCard[] }>;
};

const REFRESH_MS = 30_000;

const cardBox = {
  background: 'neutral0',
  hasRadius: true,
  padding: 4,
  shadow: 'tableShadow',
  style: { flex: '1 1 260px', minWidth: 260, maxWidth: 420 },
} as const;

const stateTone = (state: ProviderCard['state']): Record<string, string> =>
  state === 'configured'
    ? { textColor: 'success700', backgroundColor: 'success100' }
    : state === 'error'
      ? { textColor: 'danger700', backgroundColor: 'danger100' }
      : state === 'not-implemented'
        ? { textColor: 'neutral700', backgroundColor: 'neutral100' }
        : { textColor: 'warning700', backgroundColor: 'warning100' };

const envTone = (environment: ProviderCard['environment']): Record<string, string> =>
  environment === 'production'
    ? { textColor: 'danger700', backgroundColor: 'danger100' }
    : { textColor: 'primary700', backgroundColor: 'primary100' };

const nameOf = (t: Translate, code: string) => {
  const key = `p1.provider.${code}`;
  const label = t(key);
  return label === key ? code : label;
};

/**
 * "Nhà cung cấp" (screens P1): read-only cards grouped Thanh toán / Giao vận / Thông báo.
 * The server only ever returns derived metadata — masked partner ids and env var names; the
 * secrets themselves stay in process env. Refreshes with the same 30 s cadence as Ops.
 */
const ProvidersPage = () => {
  const t = useT();
  const { get } = useFetchClient();
  const toastError = useErrorToast();
  const [body, setBody] = useState<Body | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');

  useEffect(() => {
    let live = true;
    const load = async () => {
      try {
        const { data } = await get('/ordering/providers');
        if (live) {
          setBody(data as Body);
          setStatus('ready');
        }
      } catch {
        if (live) setStatus('error');
      }
    };
    void load();
    const timer = setInterval(load, REFRESH_MS);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    if (status === 'error') toastError('p1.loadFailed');
  }, [status, toastError]);

  return (
    <Page.Protect permissions={PERMISSIONS.settings}>
      <Page.Title>{t('p1.title')}</Page.Title>
      <Page.Main>
        <Layouts.Header title={t('p1.title')} subtitle={t('p1.subtitle')} />
        <Layouts.Content>
          {status === 'loading' ? (
            <Flex justifyContent="center" padding={10}>
              <Loader />
            </Flex>
          ) : !body ? (
            <EmptyStateLayout content={t('p1.loadFailed')} />
          ) : (
            <Flex direction="column" alignItems="stretch" gap={6}>
              {body.groups.map((group) => (
                <Box key={group.key}>
                  <Typography variant="delta" tag="h3">
                    {t(`p1.group.${group.key}`)}
                  </Typography>
                  <Flex gap={4} paddingTop={3} wrap="wrap" alignItems="stretch">
                    {group.cards.map((card) => (
                      <Box {...cardBox} key={card.code}>
                        <Flex justifyContent="space-between" alignItems="center" gap={2}>
                          <Typography variant="omega" fontWeight="bold">
                            {nameOf(t, card.code)}
                          </Typography>
                          <Flex gap={2}>
                            {card.environment ? (
                              <Badge {...envTone(card.environment)}>
                                {t(`p1.env.${card.environment}`)}
                              </Badge>
                            ) : null}
                            <Badge {...stateTone(card.state)}>{t(`p1.state.${card.state}`)}</Badge>
                          </Flex>
                        </Flex>
                        {card.partnerRef ? (
                          <Box paddingTop={2}>
                            <Typography variant="pi" textColor="neutral600">
                              {t('p1.partnerRef', { ref: card.partnerRef })}
                            </Typography>
                          </Box>
                        ) : null}
                        {card.webhookUrl || card.webhookPath ? (
                          <Box paddingTop={2}>
                            <Typography variant="pi" textColor="neutral600">
                              {t('p1.webhookUrl')}
                            </Typography>
                            <br />
                            <Typography variant="pi" style={{ fontFamily: 'monospace' }} textColor="neutral800">
                              {card.webhookUrl ?? `${body.publicApiUrl || '<ORDERING_PUBLIC_API_URL>'}${card.webhookPath}`}
                            </Typography>
                          </Box>
                        ) : null}
                        {card.webhookHealth ? (
                          <Box paddingTop={2}>
                            <Typography variant="pi" textColor="neutral600">
                              {card.webhookHealth.lastSuccessAt
                                ? t('p1.webhook.lastOk', {
                                    at: formatDateTime(card.webhookHealth.lastSuccessAt),
                                  })
                                : t('p1.webhook.never')}
                              {card.webhookHealth.lastFailureAt
                                ? ` · ${t('p1.webhook.lastBad', { at: formatDateTime(card.webhookHealth.lastFailureAt) })}`
                                : ''}
                            </Typography>
                          </Box>
                        ) : null}
                        {card.state !== 'configured' && card.envNeeded.length > 0 ? (
                          <Box paddingTop={2}>
                            <Alert closeLabel={t('common.close')} variant="default" title={t('p1.envNeeded')}>
                              {card.envNeeded.map((name) => (
                                <Typography key={name} variant="pi" style={{ fontFamily: 'monospace' }}>
                                  {name}
                                </Typography>
                              ))}
                            </Alert>
                          </Box>
                        ) : null}
                        {card.docsPath ? (
                          <Box paddingTop={2}>
                            <Typography variant="pi" textColor="neutral600" style={{ fontFamily: 'monospace' }}>
                              {card.docsPath}
                            </Typography>
                          </Box>
                        ) : null}
                      </Box>
                    ))}
                  </Flex>
                </Box>
              ))}
            </Flex>
          )}
        </Layouts.Content>
      </Page.Main>
    </Page.Protect>
  );
};

export default ProvidersPage;
