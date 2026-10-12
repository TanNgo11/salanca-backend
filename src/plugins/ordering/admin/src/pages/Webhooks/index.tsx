import { useCallback, useEffect, useState } from 'react';
import {
  Alert,
  Badge,
  Button,
  EmptyStateLayout,
  Flex,
  Loader,
  Switch,
  Table,
  Tbody,
  Td,
  Th,
  Thead,
  Tooltip,
  Tr,
  Typography,
} from '@strapi/design-system';
import { Plus } from '@strapi/icons';
import { Layouts, Page, useFetchClient } from '@strapi/strapi/admin';
import { Route, Routes, useNavigate } from 'react-router-dom';

import { httpStatusOf, useErrorToast } from '../../lib/api';
import { useT } from '../../lib/i18n';
import { PERMISSIONS } from '../../lib/permissions';
import { WebhookEditor } from './WebhookEditor';

export type EndpointRow = {
  id: number;
  url: string;
  description: string | null;
  events: string[];
  active: boolean;
  includeCustomer: boolean;
  consecutiveFailures: number;
  disabledAt: string | null;
  disabledReason: string | null;
  stats24h?: { succeeded: number; failed: number };
};

/** Display URL arrives without a query string already; also cut the middle of long hosts/paths. */
export const truncateMiddle = (value: string, max = 48): string => {
  if (value.length <= max) return value;
  const head = Math.ceil((max - 1) / 2);
  const tail = Math.floor((max - 1) / 2);
  return `${value.slice(0, head)}…${value.slice(value.length - tail)}`;
};

const StatusBadge = ({ row }: { row: EndpointRow }) => {
  const t = useT();
  if (row.active) {
    return <Badge textColor="success700" backgroundColor="success100">{t('webhook.status.on')}</Badge>;
  }
  if (row.disabledReason && row.disabledReason !== 'manual') {
    return (
      <Tooltip label={row.disabledReason}>
        <Badge textColor="danger700" backgroundColor="danger100">{t('webhook.status.auto')}</Badge>
      </Tooltip>
    );
  }
  return <Badge>{t('webhook.status.off')}</Badge>;
};

const WebhookList = () => {
  const t = useT();
  const navigate = useNavigate();
  const { get, post } = useFetchClient();
  const toastError = useErrorToast();
  const [rows, setRows] = useState<EndpointRow[] | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error' | 'scope'>('loading');

  const load = useCallback(async () => {
    try {
      const { data } = await get('/ordering/webhooks');
      setRows((data as { results: EndpointRow[] }).results);
      setStatus('ready');
    } catch (error) {
      setStatus(httpStatusOf(error) === 403 ? 'scope' : 'error');
    }
  }, [get]);

  useEffect(() => {
    void load();
  }, [load]);

  const setActive = async (row: EndpointRow, active: boolean) => {
    try {
      await post(`/ordering/webhooks/${row.id}/active`, { active });
      void load();
    } catch (error) {
      toastError(error);
    }
  };

  return (
    <>
      <Layouts.Header
        title={t('webhook.title')}
        subtitle={t('webhook.subtitle')}
        primaryAction={
          <Button startIcon={<Plus />} onClick={() => navigate('new')}>
            {t('webhook.add')}
          </Button>
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
            title={status === 'scope' ? t('common.forbidden.title') : t('common.error.title')}
            action={status === 'error' ? <Button onClick={() => void load()}>{t('common.retry')}</Button> : undefined}
          >
            {status === 'scope' ? t('orders.noScope') : t('webhook.loadFailed')}
          </Alert>
        ) : !rows || rows.length === 0 ? (
          <EmptyStateLayout content={t('webhook.empty')} />
        ) : (
          <Table colCount={6} rowCount={rows.length + 1}>
            <Thead>
              <Tr>
                {['url', 'description', 'events', 'day', 'status', 'active'].map((column) => (
                  <Th key={column}>
                    <Typography variant="sigma">{t(`webhook.col.${column}`)}</Typography>
                  </Th>
                ))}
              </Tr>
            </Thead>
            <Tbody>
              {rows.map((row) => (
                <Tr key={row.id}>
                  <Td onClick={() => navigate(String(row.id))} style={{ cursor: 'pointer' }}>
                    <Typography title={row.url}>{truncateMiddle(row.url)}</Typography>
                  </Td>
                  <Td onClick={() => navigate(String(row.id))} style={{ cursor: 'pointer' }}>
                    <Typography>{row.description ?? '—'}</Typography>
                  </Td>
                  <Td>
                    <Tooltip label={row.events.join(', ')}>
                      <Typography>{row.events.length}</Typography>
                    </Tooltip>
                  </Td>
                  <Td>
                    <Typography>
                      {t('webhook.stats', {
                        ok: row.stats24h?.succeeded ?? 0,
                        failed: row.stats24h?.failed ?? 0,
                      })}
                    </Typography>
                  </Td>
                  <Td>
                    <StatusBadge row={row} />
                  </Td>
                  <Td>
                    <Switch
                      checked={row.active}
                      onCheckedChange={(value: boolean) => void setActive(row, value)}
                      aria-label={t('webhook.col.active')}
                    />
                  </Td>
                </Tr>
              ))}
            </Tbody>
          </Table>
        )}
      </Layouts.Content>
    </>
  );
};

/** `/plugins/ordering/webhooks/*` (screens X1). */
const WebhooksPage = () => {
  const t = useT();
  return (
    <Page.Protect permissions={PERMISSIONS.webhook}>
      <Page.Title>{t('webhook.title')}</Page.Title>
      <Page.Main>
        <Routes>
          <Route index element={<WebhookList />} />
          <Route path="new" element={<WebhookEditor />} />
          <Route path=":id" element={<WebhookEditor />} />
        </Routes>
      </Page.Main>
    </Page.Protect>
  );
};

export default WebhooksPage;
