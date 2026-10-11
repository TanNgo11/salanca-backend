import { useCallback, useEffect, useState } from 'react';
import {
  Alert,
  Badge,
  Button,
  EmptyStateLayout,
  Flex,
  Loader,
  Table,
  Tbody,
  Td,
  Th,
  Thead,
  Tr,
  Typography,
} from '@strapi/design-system';
import { Plus } from '@strapi/icons';
import { Layouts, Page, useFetchClient } from '@strapi/strapi/admin';
import { Route, Routes, useNavigate } from 'react-router-dom';

import { localized } from '../../lib/format';
import { useLocale, useT } from '../../lib/i18n';
import { PERMISSIONS } from '../../lib/permissions';
import { BranchEditor } from './BranchEditor';

type Row = {
  code: string;
  name: Record<string, string>;
  onlineOrdering: boolean;
  isActive: boolean;
  fulfillment: { pickup: { enabled: boolean } };
};

const BranchList = () => {
  const t = useT();
  const locale = useLocale();
  const navigate = useNavigate();
  const { get } = useFetchClient();
  const [rows, setRows] = useState<Row[] | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error' | 'scope'>('loading');

  const load = useCallback(async () => {
    try {
      const { data } = await get('/ordering/branches');
      setRows((data as { results: Row[] }).results);
      setStatus('ready');
    } catch (error) {
      setStatus((error as { response?: { status?: number } })?.response?.status === 403 ? 'scope' : 'error');
    }
  }, [get]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <>
      <Layouts.Header
        title={t('branch.title')}
        subtitle={t('branch.subtitle')}
        primaryAction={
          <Button startIcon={<Plus />} onClick={() => navigate('new')}>
            {t('branch.add')}
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
            {status === 'scope' ? t('orders.noScope') : t('branch.loadFailed')}
          </Alert>
        ) : !rows || rows.length === 0 ? (
          <EmptyStateLayout content={t('branch.empty')} />
        ) : (
          <Table colCount={4} rowCount={rows.length + 1}>
            <Thead>
              <Tr>
                {['name', 'code', 'online', 'receive'].map((column) => (
                  <Th key={column}>
                    <Typography variant="sigma">{t(`branch.col.${column}`)}</Typography>
                  </Th>
                ))}
              </Tr>
            </Thead>
            <Tbody>
              {rows.map((row) => (
                <Tr key={row.code} onClick={() => navigate(row.code)} style={{ cursor: 'pointer' }}>
                  <Td>
                    <Typography fontWeight="semiBold">{localized(row.name, locale) || row.code}</Typography>
                  </Td>
                  <Td>
                    <Typography>{row.code}</Typography>
                  </Td>
                  <Td>
                    <Badge {...(row.onlineOrdering ? { textColor: 'success700', backgroundColor: 'success100' } : {})}>
                      {row.onlineOrdering ? t('branch.online.on') : t('branch.online.off')}
                    </Badge>
                  </Td>
                  <Td>
                    <Typography>{row.fulfillment.pickup.enabled ? t('receive.pickup') : '—'}</Typography>
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

/** `/plugins/ordering/branches/*` (screens S7). */
const BranchesPage = () => {
  const t = useT();
  return (
    <Page.Protect permissions={PERMISSIONS.settings}>
      <Page.Title>{t('branch.title')}</Page.Title>
      <Page.Main>
        <Routes>
          <Route index element={<BranchList />} />
          <Route path="new" element={<BranchEditor />} />
          <Route path=":code" element={<BranchEditor />} />
        </Routes>
      </Page.Main>
    </Page.Protect>
  );
};

export default BranchesPage;
