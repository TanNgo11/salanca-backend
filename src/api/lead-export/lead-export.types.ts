export enum ApiLeadExportPermission {
  Export = 'admin::lead-export.export',
}

export const LEAD_EXPORT_ROUTE = '/lead-export/:kind';

export const LEAD_EXPORT_KINDS = ['reservations', 'contacts', 'newsletter'] as const;
export type LeadExportKind = (typeof LEAD_EXPORT_KINDS)[number];

export const LEAD_EXPORT_MAX_ROWS = 10_000;

export interface LeadExportQuery {
  kind: LeadExportKind;
  /** YYYY-MM-DD, Vietnam calendar day, inclusive. */
  from?: string;
  /** YYYY-MM-DD, Vietnam calendar day, inclusive. */
  to?: string;
}

export const LEAD_EXPORT_FILE_PREFIX: Record<LeadExportKind, string> = {
  reservations: 'dat-ban',
  contacts: 'lien-he',
  newsletter: 'newsletter',
};
