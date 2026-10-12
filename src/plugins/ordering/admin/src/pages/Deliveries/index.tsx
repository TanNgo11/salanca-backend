import { Page } from '@strapi/strapi/admin';
import { Route, Routes } from 'react-router-dom';

import { OrderingInboxProvider } from '../../inbox/OrderingInboxProvider';
import { useT } from '../../lib/i18n';
import { PERMISSIONS } from '../../lib/permissions';
import { DeliveriesList } from './DeliveriesList';

/** `/plugins/ordering/deliveries/*`: the "Đơn giao" board (screens D2). */
const DeliveriesPage = () => {
  const t = useT();
  return (
    <Page.Protect permissions={PERMISSIONS.read}>
      <Page.Title>{t('deliveries.title')}</Page.Title>
      <OrderingInboxProvider>
        <Page.Main>
          <Routes>
            <Route index element={<DeliveriesList />} />
          </Routes>
        </Page.Main>
      </OrderingInboxProvider>
    </Page.Protect>
  );
};

export default DeliveriesPage;
