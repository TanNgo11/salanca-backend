import { lazy, Suspense } from 'react';
import { Flex, Loader, SubNav, SubNavHeader, SubNavLink, SubNavSection, SubNavSections } from '@strapi/design-system';
import { Layouts, useRBAC } from '@strapi/strapi/admin';
import { Navigate, NavLink, Route, Routes, useLocation } from 'react-router-dom';

import { OrderingInboxProvider, useOrderingInbox } from '../inbox/OrderingInboxProvider';
import { useT } from '../lib/i18n';
import {
  RBAC_CATALOG_ACCESS,
  RBAC_CATALOG_MANAGE,
  RBAC_ORDERS_READ,
  RBAC_SCOPE,
  RBAC_SETTINGS,
} from '../lib/permissions';

const OrdersPage = lazy(() => import('./Orders'));
const BranchesPage = lazy(() => import('./Branches'));
const StaffPage = lazy(() => import('./Staff'));
const CategoriesPage = lazy(() => import('./Categories'));
const AvailabilityPage = lazy(() => import('./Availability'));

type Section = 'orders' | 'categories' | 'availability' | 'branches' | 'staff';

/**
 * One "Bán hàng" entry in the main menu; every ordering screen lives under it with its own
 * sub-navigation (the Content Manager pattern), grouped as Vận hành / Món / Cấu hình. Links only
 * show for the actions the user holds; the routes still check permissions themselves.
 */
const SideNav = ({ visible }: { visible: Record<Section, boolean> & { settings: boolean } }) => {
  const t = useT();
  const { pathname } = useLocation();
  const inbox = useOrderingInbox();
  const link = (to: Section, label: string, badge?: number) => (
    <SubNavLink
      tag={NavLink}
      to={to}
      active={pathname.includes(`/plugins/ordering/${to}`)}
    >
      {badge ? `${label} (${badge})` : label}
    </SubNavLink>
  );
  return (
    <SubNav aria-label={t('nav.title')}>
      <SubNavHeader label={t('nav.title')} />
      <SubNavSections>
        {visible.orders ? (
          <SubNavSection label={t('nav.operations')}>
            {link('orders', t('nav.orders'), inbox?.awaiting)}
          </SubNavSection>
        ) : null}
        {visible.categories || visible.availability ? (
          <SubNavSection label={t('nav.catalog')}>
            {visible.categories ? link('categories', t('nav.categories')) : null}
            {visible.availability ? link('availability', t('nav.availability')) : null}
          </SubNavSection>
        ) : null}
        {visible.branches || visible.staff || visible.settings ? (
          <SubNavSection label={t('nav.setup')}>
            {visible.branches ? link('branches', t('nav.branches')) : null}
            {visible.staff ? link('staff', t('nav.staff')) : null}
            {visible.settings ? (
              <SubNavLink tag={NavLink} to="/settings/ordering">
                {t('nav.settings')}
              </SubNavLink>
            ) : null}
          </SubNavSection>
        ) : null}
      </SubNavSections>
    </SubNav>
  );
};

const OrderingApp = () => {
  const orders = useRBAC(RBAC_ORDERS_READ);
  const catalogManage = useRBAC(RBAC_CATALOG_MANAGE);
  const catalogAccess = useRBAC(RBAC_CATALOG_ACCESS);
  const settings = useRBAC(RBAC_SETTINGS);
  const scope = useRBAC(RBAC_SCOPE);
  const loading = [orders, catalogManage, catalogAccess, settings, scope].some((item) => item.isLoading);
  if (loading) {
    return (
      <Flex justifyContent="center" padding={10}>
        <Loader />
      </Flex>
    );
  }
  const any = (actions: Record<string, boolean>) => Object.values(actions).some(Boolean);
  const visible = {
    orders: any(orders.allowedActions),
    categories: any(catalogManage.allowedActions),
    availability: any(catalogAccess.allowedActions),
    branches: any(settings.allowedActions),
    staff: any(scope.allowedActions),
    settings: any(settings.allowedActions),
  };
  const first = (['orders', 'categories', 'availability', 'branches', 'staff'] as Section[]).find((key) => visible[key]);

  return (
    <OrderingInboxProvider>
      <Layouts.Root sideNav={<SideNav visible={visible} />}>
        <Suspense
          fallback={
            <Flex justifyContent="center" padding={10}>
              <Loader />
            </Flex>
          }
        >
          <Routes>
            <Route index element={first ? <Navigate to={first} replace /> : null} />
            <Route path="orders/*" element={<OrdersPage />} />
            <Route path="categories/*" element={<CategoriesPage />} />
            <Route path="availability/*" element={<AvailabilityPage />} />
            <Route path="branches/*" element={<BranchesPage />} />
            <Route path="staff/*" element={<StaffPage />} />
          </Routes>
        </Suspense>
      </Layouts.Root>
    </OrderingInboxProvider>
  );
};

export default OrderingApp;
