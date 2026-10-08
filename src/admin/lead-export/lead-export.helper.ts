import { localDateKey } from '../dashboard-widgets/dashboard-widgets.helper';

export type LeadExportKind = 'reservations' | 'contacts' | 'newsletter';

export const LEAD_EXPORT_KIND_LABELS: Record<LeadExportKind, string> = {
  reservations: 'Yêu cầu đặt bàn',
  contacts: 'Tin nhắn liên hệ',
  newsletter: 'Đăng ký nhận tin (newsletter)',
};

export const leadExportPermissions = [{ action: 'admin::lead-export.export', subject: null }];

export const buildLeadExportPath = (kind: LeadExportKind, from: string, to: string): string => {
  const params = new URLSearchParams();
  if (from) params.set('from', from);
  if (to) params.set('to', to);
  const query = params.toString();
  return `/lead-export/${kind}${query ? `?${query}` : ''}`;
};

/** First day of the current month up to today, in the viewer's local calendar. */
export const defaultExportRange = (now: Date): { from: string; to: string } => ({
  from: localDateKey(new Date(now.getFullYear(), now.getMonth(), 1)),
  to: localDateKey(now),
});
