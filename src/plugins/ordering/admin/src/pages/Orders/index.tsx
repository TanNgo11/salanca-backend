import { Page } from '@strapi/strapi/admin';
import { Route, Routes } from 'react-router-dom';

import { OrderingInboxProvider } from '../../inbox/OrderingInboxProvider';
import { useT } from '../../lib/i18n';
import { PERMISSIONS } from '../../lib/permissions';
import { CreateOrderPage } from './CreateOrderPage';
import { OrderDetailPage } from './OrderDetailPage';
import { OrdersList } from './OrdersList';

/** `/plugins/ordering/orders/*`: inbox (S1), "Tạo đơn hộ" (S6) and order detail (S4). */
const OrdersPage = () => {
  const t = useT();
  return (
    <Page.Protect permissions={PERMISSIONS.read}>
      <Page.Title>{t('orders.title')}</Page.Title>
      <OrderingInboxProvider>
        <Page.Main>
          <Routes>
            <Route index element={<OrdersList />} />
            <Route path="new" element={<CreateOrderPage />} />
            <Route path=":id" element={<OrderDetailPage />} />
          </Routes>
        </Page.Main>
      </OrderingInboxProvider>
    </Page.Protect>
  );
};

export default OrdersPage;
