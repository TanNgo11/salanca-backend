import { buildCsv, escapeCsvCell } from '../../shared/csv/csv';

export { escapeCsvCell };

export const AUDIT_LOG_CSV_HEADERS = [
  'Thời gian',
  'Người thực hiện',
  'Nhóm',
  'Hành động',
  'Đối tượng',
  'Nguồn',
  'Kết quả',
] as const;

export const buildAuditLogCsv = (rows: readonly (readonly string[])[]): string =>
  buildCsv(AUDIT_LOG_CSV_HEADERS, rows);
