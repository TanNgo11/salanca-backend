import { describe, expect, it } from 'vitest';

import { buildCsv, parseCsv } from './csv';

describe('parseCsv', () => {
  it('parses a plain unquoted sheet', () => {
    expect(parseCsv('a,b,c\n1,2,3\n')).toEqual([
      ['a', 'b', 'c'],
      ['1', '2', '3'],
    ]);
  });

  it('accepts CRLF and LF line ends interchangeably', () => {
    expect(parseCsv('a,b\r\n1,2\n3,4\r\n')).toEqual([
      ['a', 'b'],
      ['1', '2'],
      ['3', '4'],
    ]);
  });

  it('strips a UTF-8 BOM from the first cell', () => {
    expect(parseCsv('﻿name,price\nPhở,55000\n')).toEqual([
      ['name', 'price'],
      ['Phở', '55000'],
    ]);
  });

  it('keeps commas inside quoted cells', () => {
    expect(parseCsv('"a,b",c')).toEqual([['a,b', 'c']]);
  });

  it('keeps newlines inside quoted cells', () => {
    expect(parseCsv('"line1\nline2",x\r\ny,z')).toEqual([
      ['line1\nline2', 'x'],
      ['y', 'z'],
    ]);
  });

  it('keeps CRLF inside quoted cells', () => {
    expect(parseCsv('"line1\r\nline2",x')).toEqual([['line1\r\nline2', 'x']]);
  });

  it('unescapes doubled quotes inside quoted cells', () => {
    expect(parseCsv('"say ""hi""",x')).toEqual([['say "hi"', 'x']]);
  });

  it('round-trips a Vietnamese Excel file produced by buildCsv', () => {
    const headers = ['Tên món', 'Mô tả', 'Giá'];
    const rows = [
      ['Phở bò, tái', 'Nước dùng\nđậm vị', '55000'],
      ['Cà phê "sữa đá"', 'Đá, sữa', '29000'],
    ];
    const csv = buildCsv(headers, rows);
    expect(csv.startsWith('﻿')).toBe(true);
    expect(csv).toContain('\r\n');
    expect(parseCsv(csv)).toEqual([headers, ...rows]);
  });

  it('restores the formula guard written by escapeCsvCell', () => {
    // buildCsv writes '=1+1 as "'=1+1"; parseCsv must give the original value back.
    const csv = buildCsv(['v'], [['=SUM(A1:A2)'], ["'literal"]]);
    expect(parseCsv(csv)).toEqual([['v'], ['=SUM(A1:A2)'], ["'literal"]]);
  });

  it('handles an empty file and a trailing row without terminator', () => {
    expect(parseCsv('')).toEqual([]);
    expect(parseCsv('a,b')).toEqual([['a', 'b']]);
  });

  it('parses the empty-cell edge cases', () => {
    expect(parseCsv('a,,c\n,,')).toEqual([
      ['a', '', 'c'],
      ['', '', ''],
    ]);
  });

  it('reads a header-only file', () => {
    expect(parseCsv('a,b,c\n')).toEqual([['a', 'b', 'c']]);
  });
});
