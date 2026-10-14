import { describe, expect, it } from 'vitest';

import { qrMatrix, qrSvg } from './qr';

// Golden matrices verified byte-for-byte against python-qrcode (byte mode, ECC-M,
// auto mask). The encoder must reproduce the reference implementation exactly so
// printed table QR codes scan reliably.
const GOLDEN_X = [
  '111111101000001111111',
  '100000100101001000001',
  '101110100101101011101',
  '101110101011001011101',
  '101110101110101011101',
  '100000101111001000001',
  '111111101010101111111',
  '000000001101100000000',
  '100010111001011111001',
  '111100000001100101011',
  '100000111101001111100',
  '111000010100011010100',
  '110110111000111000110',
  '000000001000111000100',
  '111111101000110000010',
  '100000100101100101010',
  '101110101011001111111',
  '101110100001100101011',
  '101110100101001111100',
  '100000100110011010100',
  '111111101010111000101',
];

const GOLDEN_URL = [
  '1111111010001010101111111',
  '1000001001011110001000001',
  '1011101011100101001011101',
  '1011101001001110101011101',
  '1011101001010100001011101',
  '1000001011111010101000001',
  '1111111010101010101111111',
  '0000000000000001000000000',
  '1010001101101011000100101',
  '0010000000010101101101011',
  '0111111011100001001011101',
  '1110110011101010110111000',
  '0100001110111001101100001',
  '0111010101101001101100011',
  '1100011110101111100001101',
  '0010100010011010101111000',
  '1101101100000001111110010',
  '0000000011000001100010001',
  '1111111010110010101010001',
  '1000001000100001100010011',
  '1011101001111001111110001',
  '1011101001001000110010110',
  '1011101010101010000111011',
  '1000001001011010110110000',
  '1111111010101111101001001',
];

const toBits = (grid: boolean[][]) => grid.map((row) => row.map((c) => (c ? '1' : '0')).join(''));

describe('qrMatrix', () => {
  it('encodes a minimal payload as version 1 (reference matrix)', () => {
    expect(toBits(qrMatrix('x') ?? [])).toEqual(GOLDEN_X);
  });

  it('encodes a URL payload as version 2 (reference matrix)', () => {
    expect(toBits(qrMatrix('https://menu.test/t/abc') ?? [])).toEqual(GOLDEN_URL);
  });

  it('scales to larger versions for longer payloads', () => {
    expect(qrMatrix('a'.repeat(100))?.length).toBe(41); // version 6
    expect(qrMatrix('a'.repeat(107))?.length).toBe(45); // version 7
  });

  it('returns null beyond the v10-M byte capacity', () => {
    expect(qrMatrix('a'.repeat(214))).toBeNull();
    expect(qrMatrix('a'.repeat(213))).not.toBeNull();
  });
});

describe('qrSvg', () => {
  it('renders a standalone svg with quiet zone', () => {
    const svg = qrSvg('x') ?? '';
    expect(svg).toContain('<svg xmlns="http://www.w3.org/2000/svg"');
    expect(svg).toContain('viewBox="0 0 25 25"');
    expect(svg).toContain('</svg>');
  });

  it('returns null for oversized input', () => {
    expect(qrSvg('a'.repeat(500))).toBeNull();
  });
});
