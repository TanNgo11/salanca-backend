import { lazy, Suspense, useEffect, useState } from 'react';
import { Flex, Loader, SubNav, SubNavHeader, SubNavLink, SubNavSection, SubNavSections } from '@strapi/design-system';
import { Layouts, useFetchClient, useRBAC } from '@strapi/strapi/admin';
import { Navigate, NavLink, Route, Routes, useLocation } from 'react-router-dom';

import { OrderingInboxProvider, useOrderingInbox } from '../inbox/OrderingInboxProvider';
import { useT } from '../lib/i18n';
import {
  PERMISSIONS,
  RBAC_ALERTS,
  RBAC_AUDIT,
  RBAC_CATALOG_ACCESS,
  RBAC_CATALOG_MANAGE,
  RBAC_CUSTOMERS,
  RBAC_DATA_REQUESTS,
  RBAC_OPS,
  RBAC_ORDERS_READ,
  RBAC_PAYMENT_REVIEW,
  RBAC_REPORT,
  RBAC_SCOPE,
  RBAC_SETTINGS,
  RBAC_WEBHOOK,
} from '../lib/permissions';

const OrdersPage = lazy(() => import('./Orders'));
const CustomersPage = lazy(() => import('./Customers'));
const DataRequestsPage = lazy(() => import('./DataRequests'));
const DeliveriesPage = lazy(() => import('./Deliveries'));
const CourierPage = lazy(() => import('./Courier'));
const PaymentReviewPage = lazy(() => import('./PaymentReview'));
const BranchesPage = lazy(() => import('./Branches'));
const StaffPage = lazy(() => import('./Staff'));
const CategoriesPage = lazy(() => import('./Categories'));
const CatalogImportPage = lazy(() => import('./CatalogImport'));
const AvailabilityPage = lazy(() => import('./Availability'));
const AlertsPage = lazy(() => import('./Alerts'));
const OpsPage = lazy(() => import('./Ops'));
const CashClosingPage = lazy(() => import('./CashClosing'));
const ReportsPage = lazy(() => import('./Reports'));
const AuditLogPage = lazy(() => import('./AuditLog'));
const WebhooksPage = lazy(() => import('./Webhooks'));
const ApiDocsPage = lazy(() => import('./ApiDocs'));

type Section =
  | 'orders'
  | 'customers'
  | 'data-requests'
  | 'deliveries'
  | 'courier'
  | 'payment-review'
  | 'alerts'
  | 'ops'
  | 'reports'
  | 'cash-closing'
  | 'categories'
  | 'catalog-import'
  | 'availability'
  | 'branches'
  | 'staff'
  | 'audit-log'
  | 'webhooks'
  | 'api-docs';

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
        {visible.orders ||
        visible.customers ||
        visible.deliveries ||
        visible.courier ||
        visible['payment-review'] ||
        visible.alerts ||
        visible.ops ? (
          <SubNavSection label={t('nav.operations')}>
            {visible.orders ? link('orders', t('nav.orders'), inbox?.awaiting) : null}
            {visible.customers ? link('customers', t('nav.customers')) : null}
            {visible.deliveries ? link('deliveries', t('nav.deliveries')) : null}
            {visible.courier ? link('courier', t('nav.courier')) : null}
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
        {visible.categories || visible['catalog-import'] || visible.availability ? (
          <SubNavSection label={t('nav.catalog')}>
            {visible.categories ? link('categories', t('nav.categories')) : null}
            {visible['catalog-import'] ? link('catalog-import', t('nav.catalogImport')) : null}
            {visible.availability ? link('availability', t('nav.availability')) : null}
          </SubNavSection>
        ) : null}
        {visible.branches || visible.staff || visible.settings || visible['audit-log'] || visible.webhooks || visible['api-docs'] || visible['data-requests'] ? (
          <SubNavSection label={t('nav.setup')}>
            {visible.branches ? link('branches', t('nav.branches')) : null}
            {visible.staff ? link('staff', t('nav.staff')) : null}
            {visible['data-requests'] ? link('data-requests', t('nav.dataRequests')) : null}
            {visible.webhooks ? link('webhooks', t('nav.webhooks')) : null}
            {visible['api-docs'] ? link('api-docs', t('nav.apiDocs')) : null}
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
  const process = useRBAC(PERMISSIONS.process);
  const recordCash = useRBAC(PERMISSIONS.recordCash);
  const reviews = useRBAC(RBAC_PAYMENT_REVIEW);
  const alerts = useRBAC(RBAC_ALERTS);
  const ops = useRBAC(RBAC_OPS);
  const report = useRBAC(RBAC_REPORT);
  const catalogManage = useRBAC(RBAC_CATALOG_MANAGE);
  const catalogAccess = useRBAC(RBAC_CATALOG_ACCESS);
  const settings = useRBAC(RBAC_SETTINGS);
  const scope = useRBAC(RBAC_SCOPE);
  const { get } = useFetchClient();
  const canProcess = !process.isLoading && process.allowedActions.canProcess === true;
  const canRecordCash = !recordCash.isLoading && recordCash.allowedActions.canRecordCash === true;
  const [hasAssigned, setHasAssigned] = useState(false);
  useEffect(() => {
    if (!canProcess || canRecordCash) return undefined;
    let live = true;
    void get('/ordering/courier/deliveries?view=active')
      .then(({ data }) => {
        const count = (data as { counts?: { active?: number } }).counts?.active ?? 0;
        if (live) setHasAssigned(count > 0);
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [canProcess, canRecordCash, get]);
  const audit = useRBAC(RBAC_AUDIT);
  const webhook = useRBAC(RBAC_WEBHOOK);
  const customers = useRBAC(RBAC_CUSTOMERS);
  const dataRequests = useRBAC(RBAC_DATA_REQUESTS);
  const loading = [orders, process, recordCash, reviews, alerts, ops, report, catalogManage, catalogAccess, settings, scope, audit, webhook, customers, dataRequests].some(
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
    customers: any(customers.allowedActions),
    'data-requests': any(dataRequests.allowedActions),
    deliveries: any(orders.allowedActions),
    courier: (canProcess && canRecordCash) || hasAssigned,
    'payment-review': any(reviews.allowedActions),
    alerts: any(alerts.allowedActions),
    ops: any(ops.allowedActions),
    reports: any(report.allowedActions),
    'cash-closing': any(report.allowedActions),
    categories: any(catalogManage.allowedActions),
    'catalog-import': any(catalogManage.allowedActions),
    availability: any(catalogAccess.allowedActions),
    branches: any(settings.allowedActions),
    staff: any(scope.allowedActions),
    'audit-log': any(audit.allowedActions),
    webhooks: any(webhook.allowedActions),
    'api-docs': any(settings.allowedActions),
    settings: any(settings.allowedActions),
  };
  const first = (
    [
      'orders',
      'customers',
      'deliveries',
      'courier',
      'payment-review',
      'alerts',
      'ops',
      'reports',
      'cash-closing',
      'categories',
      'catalog-import',
      'availability',
      'branches',
      'staff',
      'data-requests',
      'audit-log',
      'webhooks',
      'api-docs',
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
            <Route path="customers/*" element={<CustomersPage />} />
            <Route path="data-requests/*" element={<DataRequestsPage />} />
            <Route path="deliveries/*" element={<DeliveriesPage />} />
            <Route path="courier/*" element={<CourierPage />} />
            <Route path="payment-review/*" element={<PaymentReviewPage />} />
            <Route path="alerts/*" element={<AlertsPage />} />
            <Route path="ops/*" element={<OpsPage />} />
            <Route path="reports/*" element={<ReportsPage />} />
            <Route path="cash-closing/*" element={<CashClosingPage />} />
            <Route path="categories/*" element={<CategoriesPage />} />
            <Route path="catalog-import/*" element={<CatalogImportPage />} />
            <Route path="availability/*" element={<AvailabilityPage />} />
            <Route path="branches/*" element={<BranchesPage />} />
            <Route path="staff/*" element={<StaffPage />} />
            <Route path="audit-log/*" element={<AuditLogPage />} />
            <Route path="webhooks/*" element={<WebhooksPage />} />
            <Route path="api-docs/*" element={<ApiDocsPage />} />
          </Routes>
        </Suspense>
      </Layouts.Root>
    </OrderingInboxProvider>
  );
};

export default OrderingApp;
