import { Page } from '@strapi/strapi/admin';
import { Route, Routes } from 'react-router-dom';

import { useT } from '../../lib/i18n';
import { RBAC_CUSTOMERS } from '../../lib/permissions';
import { CustomerDetailPage } from './CustomerDetailPage';
import { CustomersList } from './CustomersList';

/** `/plugins/ordering/customers/*`: the C1 directory and the C2 profile. */
const CustomersPage = () => {
  const t = useT();
  return (
    <Page.Protect permissions={RBAC_CUSTOMERS}>
      <Page.Title>{t('customers.title')}</Page.Title>
      <Page.Main>
        <Routes>
          <Route index element={<CustomersList />} />
          <Route path=":id" element={<CustomerDetailPage />} />
        </Routes>
      </Page.Main>
    </Page.Protect>
  );
};

export default CustomersPage;
