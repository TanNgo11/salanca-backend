/**
 * Catalog of admin change-log actions (O15). Every `change-log.record` call uses a code from this
 * list; the code fixes the category (screen filter) and the label staff read. Unknown codes are
 * still recorded (category `other`, a warning) — a missing label must never fail a money write —
 * and `actions.test.ts` scans the source tree so new call sites add their code here.
 */
export const AUDIT_CATEGORIES = [
  'money',
  'order',
  'catalog',
  'delivery',
  'config',
  'access',
  'ops',
  'promotion',
  'other',
] as const;
export type AuditCategory = (typeof AUDIT_CATEGORIES)[number];

type ActionDef = { category: AuditCategory; label: [vi: string, en: string] };

/** Catalog content types written through the Document Service middleware (register.ts). */
export const CATALOG_AUDITED_TYPES = [
  ['catalog-category', 'danh mục', 'category'],
  ['catalog-product', 'món', 'product'],
  ['catalog-variant', 'biến thể', 'variant'],
  ['catalog-price', 'giá', 'price'],
  ['catalog-modifier-group', 'nhóm tùy chọn', 'option group'],
  ['catalog-modifier', 'tùy chọn', 'option'],
  ['catalog-availability-window', 'khung giờ bán', 'selling window'],
  ['catalog-location-state', 'trạng thái bán theo chi nhánh', 'branch selling state'],
] as const;

const catalogActions = Object.fromEntries(
  CATALOG_AUDITED_TYPES.flatMap(([type, vi, en]) => [
    [`${type}.create`, { category: 'catalog', label: [`Tạo ${vi}`, `Create ${en}`] }],
    [`${type}.update`, { category: 'catalog', label: [`Sửa ${vi}`, `Update ${en}`] }],
    [`${type}.delete`, { category: 'catalog', label: [`Xóa ${vi}`, `Delete ${en}`] }],
  ]),
) as Record<string, ActionDef>;

export const AUDIT_ACTIONS: Record<string, ActionDef> = {
  ...catalogActions,
  'catalog-category.move': { category: 'catalog', label: ['Đổi vị trí danh mục', 'Move category'] },
  'catalog.daily-limit': {
    category: 'catalog',
    label: ['Sửa giới hạn phần mỗi ngày', 'Update daily portion limit'],
  },
  'catalog-availability.toggle': {
    category: 'catalog',
    label: ['Bật/tắt tạm hết', 'Toggle out of stock'],
  },
  // O10: catalog CSV import (all-or-nothing apply logged with created/updated counts).
  'catalog.import': { category: 'catalog', label: ['Nhập menu từ CSV', 'Import menu CSV'] },
  // Money
  'refund.create': { category: 'money', label: ['Tạo phiếu hoàn', 'Create refund'] },
  'refund.settle': { category: 'money', label: ['Ghi nhận đã hoàn', 'Settle refund'] },
  'payment-manual.record': {
    category: 'money',
    label: ['Ghi chuyển khoản tay', 'Record transfer manually'],
  },
  'payment.cash-capture': { category: 'money', label: ['Thu tiền mặt', 'Collect cash'] },
  'payment-link.issue': { category: 'money', label: ['Tạo link thanh toán', 'Issue payment link'] },
  'payment-review.assign': {
    category: 'money',
    label: ['Gán chuyển khoản vào đơn', 'Assign transfer to order'],
  },
  'payment-review.refund-due': {
    category: 'money',
    label: ['Đánh dấu cần hoàn', 'Mark transfer refund due'],
  },
  'payment-review.ignore': { category: 'money', label: ['Bỏ qua chuyển khoản', 'Ignore transfer'] },
  'payment-review.reopen': { category: 'money', label: ['Mở lại chuyển khoản', 'Reopen transfer'] },
  'cash-closing.close': { category: 'money', label: ['Chốt tiền mặt', 'Close cash'] },
  'cash-closing.adjust': { category: 'money', label: ['Sửa chốt tiền mặt', 'Adjust cash closing'] },
  // Orders
  'order.transition': { category: 'order', label: ['Chuyển bước đơn', 'Move order step'] },
  'order.reject': { category: 'order', label: ['Từ chối đơn', 'Reject order'] },
  'order.cancel': { category: 'order', label: ['Hủy đơn', 'Cancel order'] },
  'order.complete': { category: 'order', label: ['Hoàn tất đơn', 'Complete order'] },
  'order.line-cancel': { category: 'order', label: ['Hủy bớt món', 'Cancel line items'] },
  'order.edit': { category: 'order', label: ['Sửa đơn', 'Edit order'] },
  'rating.hide': { category: 'order', label: ['Ẩn/hiện đánh giá', 'Hide or show rating'] },
  'rating.note': { category: 'order', label: ['Ghi chú đánh giá', 'Rating note'] },
  // O8: own category — campaigns change prices for every new order, apart from config.
  'price-list.create': { category: 'catalog', label: ['Tạo bảng giá', 'Create price list'] },
  'price-list.update': { category: 'catalog', label: ['Sửa bảng giá', 'Update price list'] },
  'price-list.active': { category: 'catalog', label: ['Bật/tắt bảng giá', 'Switch price list'] },
  // Groups decide who pays a price. They sit with promotions (a commercial condition),
  // not with staff access.
  'customer-group.create': { category: 'promotion', label: ['Tạo nhóm khách', 'Create customer group'] },
  'customer-group.update': { category: 'promotion', label: ['Sửa nhóm khách', 'Update customer group'] },
  'customer-group.members': { category: 'promotion', label: ['Sửa thành viên nhóm khách', 'Change customer group members'] },
  'promotion.create': { category: 'promotion', label: ['Tạo khuyến mãi', 'Create promotion'] },
  'promotion.update': { category: 'promotion', label: ['Sửa khuyến mãi', 'Update promotion'] },
  'promotion.active': { category: 'promotion', label: ['Bật/tắt khuyến mãi', 'Switch promotion'] },
  'promotion.code-create': { category: 'promotion', label: ['Thêm mã khuyến mãi', 'Add promotion code'] },
  'promotion.codes-generate': { category: 'promotion', label: ['Sinh mã hàng loạt', 'Generate codes'] },
  'promotion.code-active': { category: 'promotion', label: ['Bật/tắt mã khuyến mãi', 'Switch promotion code'] },
  'promotion.codes-export': { category: 'promotion', label: ['Xuất mã khuyến mãi', 'Export promotion codes'] },
  'order.confirm-draft': {
    category: 'order',
    label: ['Xác nhận đơn hộ khách', 'Confirm phone order'],
  },
  // O9: gift cards — value-bearing, so they live with the other money actions.
  'gift-card.issue': { category: 'money', label: ['Phát hành thẻ quà tặng', 'Issue gift card'] },
  'gift-card.block': { category: 'money', label: ['Khóa thẻ quà tặng', 'Block gift card'] },
  'gift-card.unblock': { category: 'money', label: ['Mở khóa thẻ quà tặng', 'Unblock gift card'] },
  'gift-card.extend': { category: 'money', label: ['Gia hạn thẻ quà tặng', 'Extend gift card'] },
  'gift-card.adjust': {
    category: 'money',
    label: ['Điều chỉnh số dư thẻ quà tặng', 'Adjust gift-card balance'],
  },
  'gift-card.resend': { category: 'money', label: ['Gửi lại thẻ quà tặng', 'Resend gift card'] },
  'gift-card-batch.import': {
    category: 'money',
    label: ['Nhập lô thẻ quà tặng', 'Import gift-card batch'],
  },
  'gift-card-batch.create': {
    category: 'money',
    label: ['Tạo lô thẻ in', 'Create print batch'],
  },
  'gift-card-batch.export': {
    category: 'money',
    label: ['Xuất mã lô thẻ', 'Export batch codes'],
  },
  'gift-card-batch.activate': {
    category: 'money',
    label: ['Kích hoạt thẻ in sẵn', 'Activate preprinted gift cards'],
  },
  // Delivery
  'delivery.dispatch': { category: 'delivery', label: ['Bắt đầu giao', 'Start delivery'] },
  'delivery.fail': { category: 'delivery', label: ['Giao thất bại', 'Delivery failed'] },
  'delivery.retry': { category: 'delivery', label: ['Giao lại', 'Retry delivery'] },
  // Configuration
  'branch.create': { category: 'config', label: ['Tạo chi nhánh', 'Create branch'] },
  'branch.update': { category: 'config', label: ['Sửa chi nhánh', 'Update branch'] },
  'settings.update': { category: 'config', label: ['Sửa cài đặt bán hàng', 'Update sales settings'] },
  'alert-rules.update': { category: 'config', label: ['Sửa ngưỡng cảnh báo', 'Update alert rules'] },
  // O10: outbound webhook endpoints and editable email templates.
  'webhook-endpoint.create': {
    category: 'config',
    label: ['Tạo endpoint webhook', 'Create webhook endpoint'],
  },
  'webhook-endpoint.update': {
    category: 'config',
    label: ['Sửa endpoint webhook', 'Update webhook endpoint'],
  },
  'webhook-endpoint.rotate-secret': {
    category: 'config',
    label: ['Đổi bí mật webhook', 'Rotate webhook secret'],
  },
  'webhook-endpoint.set-active': {
    category: 'config',
    label: ['Bật/tắt endpoint webhook', 'Enable/disable webhook endpoint'],
  },
  'webhook-endpoint.test': {
    category: 'config',
    label: ['Gửi webhook thử', 'Send test webhook'],
  },
  'webhook-delivery.resend': {
    category: 'config',
    label: ['Gửi lại webhook', 'Resend webhook delivery'],
  },
  'notification-template.save': {
    category: 'config',
    label: ['Sửa mẫu email', 'Edit email template'],
  },
  'notification-template.reset': {
    category: 'config',
    label: ['Khôi phục mẫu email', 'Reset email template'],
  },
  // Access
  'scope.update': { category: 'access', label: ['Gán chi nhánh cho nhân viên', 'Update staff scope'] },
  // O11: personal-data requests (Decree 13). entityLabel stays null — no customer data.
  'customer.update': {
    category: 'access',
    label: ['Sửa hồ sơ khách', 'Update customer profile'],
  },
  'customer.reveal-phone': {
    category: 'access',
    label: ['Xem SĐT đầy đủ', 'Reveal full phone number'],
  },
  'customer.export': {
    category: 'access',
    label: ['Xuất dữ liệu khách', 'Export customer data'],
  },
  'data-request.create': {
    category: 'access',
    label: ['Tạo yêu cầu dữ liệu', 'Create data request'],
  },
  'data-request.process': {
    category: 'access',
    label: ['Xử lý yêu cầu dữ liệu', 'Process data request'],
  },
  'data-request.reject': {
    category: 'access',
    label: ['Từ chối yêu cầu dữ liệu', 'Reject data request'],
  },
  // Ops
  'ops.job-run': { category: 'ops', label: ['Chạy job', 'Run job'] },
  'ops.outbox-retry': { category: 'ops', label: ['Gửi lại sự kiện', 'Retry outbox event'] },
};

export const auditActionDef = (action: string): ActionDef | undefined => AUDIT_ACTIONS[action];

export const auditCategoryOf = (action: string): AuditCategory =>
  AUDIT_ACTIONS[action]?.category ?? 'other';

export const auditLabelOf = (action: string, locale: string | null | undefined): string => {
  const def = AUDIT_ACTIONS[action];
  if (!def) return action;
  return locale?.toLowerCase().startsWith('en') ? def.label[1] : def.label[0];
};

/**
 * Staff order-flow audit derived from a timeline event (one place instead of a `record` call in
 * every order service). Returns null when the event is not a staff action worth auditing.
 */
export const auditActionForTimeline = (
  type: string,
  payload: Record<string, unknown> | undefined,
): { action: string; before?: Record<string, unknown>; after?: Record<string, unknown> } | null => {
  const data = payload ?? {};
  if (type === 'fulfillment-group.transitioned') {
    const from = typeof data.from === 'string' ? data.from : null;
    const to = typeof data.to === 'string' ? data.to : null;
    if (!to) return null;
    // Only the reason *code* — free-text reasons/notes may carry customer data.
    const reason = typeof data.reasonCode === 'string' ? data.reasonCode : undefined;
    const action =
      to === 'canceled'
        ? 'order.cancel'
        : to === 'rejected'
          ? 'order.reject'
          : to === 'out-for-delivery'
            ? 'delivery.dispatch'
            : to === 'failed'
              ? 'delivery.fail'
              : from === 'failed' && to === 'ready'
                ? 'delivery.retry'
                : to === 'delivered'
                  ? 'order.complete'
                  : 'order.transition';
    return {
      action,
      before: { status: from },
      after: { status: to, ...(reason ? { reasonCode: reason } : {}) },
    };
  }
  if (type === 'order.line.canceled') {
    return {
      action: 'order.line-cancel',
      after: {
        lineId: data.lineId,
        quantity: data.quantity,
        amount: data.amount,
      },
    };
  }
  if (type === 'payment.captured' && data.providerCode === 'cash') {
    return { action: 'payment.cash-capture', after: { amount: data.amount, paymentId: data.paymentId } };
  }
  if (type === 'order.confirmed') {
    return { action: 'order.confirm-draft' };
  }
  return null;
};
