import { Page } from '@strapi/strapi/admin';
import { Route, Routes } from 'react-router-dom';

import { useT } from '../../lib/i18n';
import { PERMISSIONS } from '../../lib/permissions';
import { BatchDetail, BatchList } from './Batches';
import CardDetail from './CardDetail';
import CardList from './CardList';

/** `/plugins/ordering/gift-cards/*` (screens G1–G3 + paper batches). */
const GiftCardsPage = () => {
  const t = useT();
  return (
    <Page.Protect permissions={PERMISSIONS.giftCardManage}>
      <Page.Title>{t('card.title')}</Page.Title>
      <Page.Main>
        <Routes>
          <Route index element={<CardList />} />
          <Route path="batches" element={<BatchList />} />
          <Route path="batches/:id" element={<BatchDetail />} />
          <Route path=":id" element={<CardDetail />} />
        </Routes>
      </Page.Main>
    </Page.Protect>
  );
};

export default GiftCardsPage;
