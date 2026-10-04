const CSV_BOM = '\uFEFF';
const FORMULA_PREFIX = /^[=+\-@\t\r]/;

export const AUDIT_LOG_CSV_HEADERS = [
  'Thời gian',
  'Người thực hiện',
  'Nhóm',
  'Hành động',
  'Đối tượng',
  'Nguồn',
  'Kết quả',
] as const;

export const escapeCsvCell = (value: string): string => {
  const formulaSafe = FORMULA_PREFIX.test(value) ? `'${value}` : value;
  return `"${formulaSafe.split('"').join('""')}"`;
};

export const buildAuditLogCsv = (rows: readonly (readonly string[])[]): string => {
  const lines = [
    AUDIT_LOG_CSV_HEADERS.map((header) => escapeCsvCell(header)).join(','),
    ...rows.map((row) => row.map((cell) => escapeCsvCell(cell)).join(',')),
  ];
  return `${CSV_BOM}${lines.join('\r\n')}\r\n`;
};
