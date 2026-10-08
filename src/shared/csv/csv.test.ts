import { describe, expect, it } from 'vitest';

import { buildCsv, escapeCsvCell } from './csv';

describe('csv', () => {
  it('starts with a UTF-8 BOM and ends rows with CRLF', () => {
    expect(buildCsv(['A', 'B'], [['1', 'x"y']])).toBe('﻿"A","B"\r\n"1","x""y"\r\n');
  });

  it('neutralises spreadsheet formulas', () => {
    expect(escapeCsvCell('=HYPERLINK("x")')).toBe(`"'=HYPERLINK(""x"")"`);
    expect(escapeCsvCell('+84901')).toBe(`"'+84901"`);
  });
});
