const CSV_BOM = '﻿';
const FORMULA_PREFIX = /^[=+\-@\t\r]/;

/** Quotes a cell and defuses spreadsheet formula injection. */
export const escapeCsvCell = (value: string): string => {
  const formulaSafe = FORMULA_PREFIX.test(value) ? `'${value}` : value;
  return `"${formulaSafe.split('"').join('""')}"`;
};

/** Excel-friendly CSV: UTF-8 BOM, every cell quoted, CRLF line ends. */
export const buildCsv = (
  headers: readonly string[],
  rows: readonly (readonly string[])[],
): string => {
  const lines = [headers, ...rows].map((row) => row.map(escapeCsvCell).join(','));
  return `${CSV_BOM}${lines.join('\r\n')}\r\n`;
};
