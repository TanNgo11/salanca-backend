import { describe, expect, it } from 'vitest';

import { buildAuditLogCsv, escapeCsvCell } from './audit-log.export';

describe('audit log CSV', () => {
  it('prefixes a UTF-8 BOM', () => {
    expect(buildAuditLogCsv([]).startsWith('\uFEFF')).toBe(true);
  });

  it('escapes spreadsheet formulas', () => {
    expect(escapeCsvCell('=CMD()')).toBe(`"'=CMD()"`);
    expect(escapeCsvCell('+1+1')).toBe(`"'+1+1"`);
    expect(escapeCsvCell('-2')).toBe(`"'-2"`);
    expect(escapeCsvCell('@SUM(A1)')).toBe(`"'@SUM(A1)"`);
    expect(escapeCsvCell('Nguyễn Văn An')).toBe('"Nguyễn Văn An"');
  });
});
