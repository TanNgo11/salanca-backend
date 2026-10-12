import { describe, expect, it } from 'vitest';
import { buildCsv, escapeCsvCell } from './csv';

describe('escapeCsvCell', () => {
  it('quotes every cell and doubles inner quotes', () => {
    expect(escapeCsvCell('Bún bò')).toBe('"Bún bò"');
    expect(escapeCsvCell('nói "to"')).toBe('"nói ""to"""');
  });
  it.each(['=SUM(1)', '+84123456789', '-5', '@user', '\tinjected', '\rinjected'])(
    'prefixes a quote on formula-like %j',
    (value) => {
      expect(escapeCsvCell(value)).toBe(`"'${value.replaceAll('"', '""')}"`);
    },
  );
  it('leaves plain text and numbers alone inside the quotes', () => {
    expect(escapeCsvCell('ORD-000001')).toBe('"ORD-000001"');
    expect(escapeCsvCell('175000')).toBe('"175000"');
  });
});

describe('buildCsv', () => {
  it('emits a UTF-8 BOM, CRLF endings and a trailing newline', () => {
    const csv = buildCsv(['Mã', 'Tên'], [['ORD-1', 'Nguyễn Thị Hằng']]);
    expect(csv.startsWith('﻿')).toBe(true);
    expect(csv).toBe('﻿"Mã","Tên"\r\n"ORD-1","Nguyễn Thị Hằng"\r\n');
  });
});
