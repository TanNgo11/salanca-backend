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
  RBAC_GIFT_CARD,
  RBAC_KITCHEN,
  RBAC_LOYALTY,
  RBAC_OPS,
  RBAC_ORDERS_READ,
  RBAC_PAYMENT_REVIEW,
  RBAC_PRICE,
  RBAC_PROMOTION,
  RBAC_REPORT,
  RBAC_SCOPE,
  RBAC_SETTINGS,
  RBAC_TABLES,
  RBAC_WEBHOOK,
} from '../lib/permissions';

const OrdersPage = lazy(() => import('./Orders'));
const PrintPage = lazy(() => import('./Print'));
const SessionPrintPage = lazy(() => import('./Print/Session'));
const KitchenPage = lazy(() => import('./Kitchen'));
const TablesPage = lazy(() => import('./Tables'));
const TableSessionsPage = lazy(() => import('./TableSessions'));
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
const ProvidersPage = lazy(() => import('./Providers'));
const ApiDocsPage = lazy(() => import('./ApiDocs'));
const PromotionsPage = lazy(() => import('./Promotions'));
const PriceListsPage = lazy(() => import('./PriceLists'));
const CustomerGroupsPage = lazy(() => import('./CustomerGroups'));
const RatingsPage = lazy(() => import('./Ratings'));
const GiftCardsPage = lazy(() => import('./GiftCards'));
const LoyaltyPage = lazy(() => import('./Loyalty'));

type Section =
  | 'orders'
  | 'kitchen'
  | 'table-sessions'
  | 'customers'
  | 'data-requests'
  | 'deliveries'
  | 'courier'
  | 'payment-review'
  | 'ratings'
  | 'alerts'
  | 'ops'
  | 'reports'
  | 'cash-closing'
  | 'promotions'
  | 'gift-cards'
  | 'loyalty'
  | 'price-lists'
  | 'customer-groups'
  | 'categories'
  | 'catalog-import'
  | 'availability'
  | 'branches'
  | 'tables'
  | 'staff'
  | 'audit-log'
  | 'webhooks'
  | 'providers'
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
        visible.kitchen ||
        visible['table-sessions'] ||
        visible.customers ||
        visible['customer-groups'] ||
        visible.deliveries ||
        visible.courier ||
        visible['payment-review'] ||
        visible.ratings ||
        visible.alerts ||
        visible.ops ? (
          <SubNavSection label={t('nav.operations')}>
            {visible.orders ? link('orders', t('nav.orders'), inbox?.awaiting) : null}
            {visible.kitchen ? link('kitchen', t('nav.kitchen')) : null}
            {visible['table-sessions'] ? link('table-sessions', t('nav.tableSessions')) : null}
            {visible.customers ? link('customers', t('nav.customers')) : null}
            {visible['customer-groups'] ? link('customer-groups', t('nav.customerGroups')) : null}
            {visible.deliveries ? link('deliveries', t('nav.deliveries')) : null}
            {visible.courier ? link('courier', t('nav.courier')) : null}
            {visible['payment-review'] ? link('payment-review', t('nav.paymentReview'), openReviews) : null}
            {visible.ratings ? link('ratings', t('nav.ratings')) : null}
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
        {visible.promotions || visible['gift-cards'] || visible.loyalty ? (
          <SubNavSection label={t('nav.promotionsGroup')}>
            {visible.promotions ? link('promotions', t('nav.promotions')) : null}
            {visible['gift-cards'] ? link('gift-cards', t('nav.giftCards')) : null}
            {visible.loyalty ? link('loyalty', t('nav.loyalty')) : null}
          </SubNavSection>
        ) : null}
        {visible.categories || visible['catalog-import'] || visible.availability || visible['price-lists'] ? (
          <SubNavSection label={t('nav.catalog')}>
            {visible['price-lists'] ? link('price-lists', t('nav.priceLists')) : null}
            {visible.categories ? link('categories', t('nav.categories')) : null}
            {visible['catalog-import'] ? link('catalog-import', t('nav.catalogImport')) : null}
            {visible.availability ? link('availability', t('nav.availability')) : null}
          </SubNavSection>
        ) : null}
        {visible.branches || visible.tables || visible.staff || visible.settings || visible['audit-log'] || visible.webhooks || visible.providers || visible['api-docs'] || visible['data-requests'] ? (
          <SubNavSection label={t('nav.setup')}>
            {visible.branches ? link('branches', t('nav.branches')) : null}
            {visible.tables ? link('tables', t('nav.tables')) : null}
            {visible.staff ? link('staff', t('nav.staff')) : null}
            {visible['data-requests'] ? link('data-requests', t('nav.dataRequests')) : null}
            {visible.webhooks ? link('webhooks', t('nav.webhooks')) : null}
            {visible.providers ? link('providers', t('nav.providers')) : null}
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
  const kitchen = useRBAC(RBAC_KITCHEN);
  const tables = useRBAC(RBAC_TABLES);
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
  const { pathname } = useLocation();
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
  const promotion = useRBAC(RBAC_PROMOTION);
  const giftCards = useRBAC(RBAC_GIFT_CARD);
  const loyalty = useRBAC(RBAC_LOYALTY);
  const price = useRBAC(RBAC_PRICE);
  const customers = useRBAC(RBAC_CUSTOMERS);
  const dataRequests = useRBAC(RBAC_DATA_REQUESTS);
  const loading = [orders, kitchen, tables, process, recordCash, reviews, alerts, ops, report, catalogManage, catalogAccess, settings, scope, audit, webhook, customers, dataRequests, promotion, giftCards, loyalty, price].some(
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
    kitchen: any(kitchen.allowedActions),
    'table-sessions': any(tables.allowedActions),
    tables: any(tables.allowedActions),
    customers: any(customers.allowedActions),
    'customer-groups': any(price.allowedActions),
    'data-requests': any(dataRequests.allowedActions),
    deliveries: any(orders.allowedActions),
    courier: (canProcess && canRecordCash) || hasAssigned,
    'payment-review': any(reviews.allowedActions),
    ratings: any(orders.allowedActions),
    alerts: any(alerts.allowedActions),
    ops: any(ops.allowedActions),
    reports: any(report.allowedActions),
    'cash-closing': any(report.allowedActions),
    promotions: any(promotion.allowedActions),
    'gift-cards': any(giftCards.allowedActions),
    loyalty: any(loyalty.allowedActions),
    'price-lists': any(price.allowedActions),
    categories: any(catalogManage.allowedActions),
    'catalog-import': any(catalogManage.allowedActions),
    availability: any(catalogAccess.allowedActions),
    branches: any(settings.allowedActions),
    staff: any(scope.allowedActions),
    'audit-log': any(audit.allowedActions),
    webhooks: any(webhook.allowedActions),
    providers: any(settings.allowedActions),
    'api-docs': any(settings.allowedActions),
    settings: any(settings.allowedActions),
  };
  const first = (
    [
      'orders',
      'kitchen',
      'table-sessions',
      'customers',
      'customer-groups',
      'deliveries',
      'courier',
      'payment-review',
      'ratings',
      'alerts',
      'ops',
      'reports',
      'cash-closing',
      'promotions',
      'gift-cards',
      'loyalty',
      'price-lists',
      'categories',
      'catalog-import',
      'availability',
      'branches',
      'tables',
      'staff',
      'data-requests',
      'audit-log',
      'webhooks',
      'providers',
      'api-docs',
    ] as Section[]
  ).find((key) => visible[key]);

  // N1 print pages render raw — no Admin frame, no inbox/SSE. They run inside hidden
  // auto-print iframes on counter machines, so anything heavy would print twice.
  if (pathname.includes('/plugins/ordering/print')) {
    return (
      <Suspense
        fallback={
          <Flex justifyContent="center" padding={10}>
            <Loader />
          </Flex>
        }
      >
        <Routes>
          <Route path="print/:orderId" element={<PrintPage />} />
          <Route path="print/session/:sessionId" element={<SessionPrintPage />} />
        </Routes>
      </Suspense>
    );
  }

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
            <Route path="kitchen/*" element={<KitchenPage />} />
            <Route path="table-sessions/*" element={<TableSessionsPage />} />
            <Route path="tables/*" element={<TablesPage />} />
            <Route path="customers/*" element={<CustomersPage />} />
            <Route path="customer-groups/*" element={<CustomerGroupsPage />} />
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
            <Route path="providers/*" element={<ProvidersPage />} />
            <Route path="api-docs/*" element={<ApiDocsPage />} />
            <Route path="promotions/*" element={<PromotionsPage />} />
            <Route path="gift-cards/*" element={<GiftCardsPage />} />
            <Route path="loyalty/*" element={<LoyaltyPage />} />
            <Route path="price-lists/*" element={<PriceListsPage />} />
            <Route path="ratings/*" element={<RatingsPage />} />
          </Routes>
        </Suspense>
      </Layouts.Root>
    </OrderingInboxProvider>
  );
};

export default OrderingApp;
