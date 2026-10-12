const CSV_BOM = '﻿';
/** Cells opening with these characters are executed as formulas by spreadsheet apps. */
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

/**
 * RFC 4180 reader for catalog imports (O10). Accepts a UTF-8 BOM, CRLF or LF line ends, quoted
 * cells carrying commas/newlines/`""`-escaped quotes, and bare cells. A leading `'` — the
 * formula guard `escapeCsvCell` writes on quoted cells — is undone when the rest of the cell
 * would execute as a formula, so an exported `=x` round-trips back to `=x` while a real `'abc`
 * value keeps its apostrophe.
 */
export const parseCsv = (text: string): string[][] => {
  const input = text.startsWith(CSV_BOM) ? text.slice(1) : text;
  const rows: string[][] = [];
  let cell = '';
  let row: string[] = [];
  let inQuotes = false;
  let quotedCell = false;
  let index = 0;
  const pushCell = () => {
    if (
      quotedCell &&
      cell.startsWith("'") &&
      cell.length > 1 &&
      FORMULA_PREFIX.test(cell.slice(1))
    ) {
      cell = cell.slice(1);
    }
    row.push(cell);
    cell = '';
    quotedCell = false;
  };
  const pushRow = () => {
    pushCell();
    rows.push(row);
    row = [];
  };
  while (index < input.length) {
    const char = input[index];
    if (inQuotes) {
      if (char === '"') {
        if (input[index + 1] === '"') {
          cell += '"';
          index += 2;
        } else {
          inQuotes = false;
          index += 1;
        }
      } else {
        cell += char;
        index += 1;
      }
      continue;
    }
    if (char === '"' && cell.length === 0) {
      inQuotes = true;
      quotedCell = true;
      index += 1;
      continue;
    }
    if (char === ',') {
      pushCell();
      index += 1;
      continue;
    }
    if (char === '\r' || char === '\n') {
      if (char === '\r' && input[index + 1] === '\n') index += 1;
      pushRow();
      index += 1;
      continue;
    }
    cell += char;
    index += 1;
  }
  if (cell.length > 0 || row.length > 0 || inQuotes) pushRow();
  return rows;
};
