import { lazy, Suspense, useEffect, useState } from 'react';
import { Flex, Loader, SubNav, SubNavHeader, SubNavLink, SubNavSection, SubNavSections } from '@strapi/design-system';
import { Layouts, useFetchClient, useRBAC } from '@strapi/strapi/admin';
import { Navigate, NavLink, Route, Routes, useLocation } from 'react-router-dom';

import { OrderingInboxProvider, useOrderingInbox } from '../inbox/OrderingInboxProvider';
import { useT } from '../lib/i18n';
import {
  RBAC_ALERTS,
  RBAC_AUDIT,
  RBAC_CATALOG_ACCESS,
  RBAC_CATALOG_MANAGE,
  RBAC_OPS,
  RBAC_ORDERS_READ,
  RBAC_PAYMENT_REVIEW,
  RBAC_REPORT,
  RBAC_SCOPE,
  RBAC_SETTINGS,
} from '../lib/permissions';

const OrdersPage = lazy(() => import('./Orders'));
const DeliveriesPage = lazy(() => import('./Deliveries'));
const PaymentReviewPage = lazy(() => import('./PaymentReview'));
const BranchesPage = lazy(() => import('./Branches'));
const StaffPage = lazy(() => import('./Staff'));
const CategoriesPage = lazy(() => import('./Categories'));
const AvailabilityPage = lazy(() => import('./Availability'));
const AlertsPage = lazy(() => import('./Alerts'));
const OpsPage = lazy(() => import('./Ops'));
const CashClosingPage = lazy(() => import('./CashClosing'));
const ReportsPage = lazy(() => import('./Reports'));
const AuditLogPage = lazy(() => import('./AuditLog'));

type Section =
  | 'orders'
  | 'deliveries'
  | 'payment-review'
  | 'alerts'
  | 'ops'
  | 'reports'
  | 'cash-closing'
  | 'categories'
  | 'availability'
  | 'branches'
  | 'staff'
  | 'audit-log';

/**
 * One "Bán hàng" entry in the main menu; every ordering screen lives under it with its own
 * sub-navigation (the Content Manager pattern), grouped as Vận hành / Món / Cấu hình. Links only
 * show for the actions the user holds; the routes still check permissions themselves.
 */
const SideNav = ({
  visible,
  showReviews,
  showAlerts,
}: {
  visible: Record<Section, boolean> & { settings: boolean };
  showReviews: boolean;
  showAlerts: boolean;
}) => {
  const t = useT();
  const { pathname } = useLocation();
  const inbox = useOrderingInbox();
  const { get } = useFetchClient();
  const [openReviews, setOpenReviews] = useState(0);
  const [openAlerts, setOpenAlerts] = useState(0);
  useEffect(() => {
    if (!showReviews) return undefined;
    let live = true;
    void get('/ordering/payment-reviews?status=open&pageSize=1')
      .then(({ data }) => {
        if (live) setOpenReviews((data as { counts?: { open?: number } }).counts?.open ?? 0);
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [get, showReviews]);
  useEffect(() => {
    if (!showAlerts) return undefined;
    let live = true;
    void get('/ordering/alerts?status=open&pageSize=1')
      .then(({ data }) => {
        if (live) setOpenAlerts((data as { total?: number }).total ?? 0);
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [get, showAlerts]);
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
        {visible.orders || visible.deliveries || visible['payment-review'] || visible.alerts || visible.ops ? (
          <SubNavSection label={t('nav.operations')}>
            {visible.orders ? link('orders', t('nav.orders'), inbox?.awaiting) : null}
            {visible.deliveries ? link('deliveries', t('nav.deliveries')) : null}
            {visible['payment-review'] ? link('payment-review', t('nav.paymentReview'), openReviews) : null}
            {visible.alerts ? link('alerts', t('nav.alerts'), openAlerts) : null}
            {visible.ops ? link('ops', t('nav.ops')) : null}
          </SubNavSection>
        ) : null}
        {visible.reports || visible['cash-closing'] ? (
          <SubNavSection label={t('nav.reports')}>
            {visible.reports ? link('reports', t('nav.sales')) : null}
            {visible['cash-closing'] ? link('cash-closing', t('nav.cashClosing')) : null}
          </SubNavSection>
        ) : null}
        {visible.categories || visible.availability ? (
          <SubNavSection label={t('nav.catalog')}>
            {visible.categories ? link('categories', t('nav.categories')) : null}
            {visible.availability ? link('availability', t('nav.availability')) : null}
          </SubNavSection>
        ) : null}
        {visible.branches || visible.staff || visible.settings || visible['audit-log'] ? (
          <SubNavSection label={t('nav.setup')}>
            {visible.branches ? link('branches', t('nav.branches')) : null}
            {visible.staff ? link('staff', t('nav.staff')) : null}
            {visible['audit-log'] ? link('audit-log', t('nav.auditLog')) : null}
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
  const reviews = useRBAC(RBAC_PAYMENT_REVIEW);
  const alerts = useRBAC(RBAC_ALERTS);
  const ops = useRBAC(RBAC_OPS);
  const report = useRBAC(RBAC_REPORT);
  const catalogManage = useRBAC(RBAC_CATALOG_MANAGE);
  const catalogAccess = useRBAC(RBAC_CATALOG_ACCESS);
  const settings = useRBAC(RBAC_SETTINGS);
  const scope = useRBAC(RBAC_SCOPE);
  const audit = useRBAC(RBAC_AUDIT);
  const loading = [orders, reviews, alerts, ops, report, catalogManage, catalogAccess, settings, scope, audit].some(
    (item) => item.isLoading,
  );
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
    deliveries: any(orders.allowedActions),
    'payment-review': any(reviews.allowedActions),
    alerts: any(alerts.allowedActions),
    ops: any(ops.allowedActions),
    reports: any(report.allowedActions),
    'cash-closing': any(report.allowedActions),
    categories: any(catalogManage.allowedActions),
    availability: any(catalogAccess.allowedActions),
    branches: any(settings.allowedActions),
    staff: any(scope.allowedActions),
    'audit-log': any(audit.allowedActions),
    settings: any(settings.allowedActions),
  };
  const first = (
    [
      'orders',
      'deliveries',
      'payment-review',
      'alerts',
      'ops',
      'reports',
      'cash-closing',
      'categories',
      'availability',
      'branches',
      'staff',
      'audit-log',
    ] as Section[]
  ).find((key) => visible[key]);

  return (
    <OrderingInboxProvider>
      <Layouts.Root
        sideNav={<SideNav visible={visible} showReviews={visible['payment-review']} showAlerts={visible.alerts} />}
      >
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
            <Route path="deliveries/*" element={<DeliveriesPage />} />
            <Route path="payment-review/*" element={<PaymentReviewPage />} />
            <Route path="alerts/*" element={<AlertsPage />} />
            <Route path="ops/*" element={<OpsPage />} />
            <Route path="reports/*" element={<ReportsPage />} />
            <Route path="cash-closing/*" element={<CashClosingPage />} />
            <Route path="categories/*" element={<CategoriesPage />} />
            <Route path="availability/*" element={<AvailabilityPage />} />
            <Route path="branches/*" element={<BranchesPage />} />
            <Route path="staff/*" element={<StaffPage />} />
            <Route path="audit-log/*" element={<AuditLogPage />} />
          </Routes>
        </Suspense>
      </Layouts.Root>
    </OrderingInboxProvider>
  );
};

export default OrderingApp;
