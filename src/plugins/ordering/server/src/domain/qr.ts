/**
 * Minimal QR encoder (byte mode, error-correction level M, versions 1–10) used by
 * `GET /tables/:id/qr.svg` so table QR codes need no external service or package (O12).
 * The matrix is verified against the reference `python-qrcode` implementation in tests.
 */

const EXP = new Uint8Array(512);
const LOG = new Uint8Array(256);
(() => {
  let x = 1;
  for (let i = 0; i < 255; i += 1) {
    EXP[i] = x;
    LOG[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= 0x11d;
  }
  for (let i = 255; i < 512; i += 1) EXP[i] = EXP[i - 255];
})();

const mul = (a: number, b: number) => (a === 0 || b === 0 ? 0 : EXP[LOG[a] + LOG[b]]);

/** RS generator polynomial of degree `deg`: ∏(x − αⁱ), descending-order (poly[0] = 1). */
const rsGenerator = (deg: number): number[] => {
  let poly = [1];
  for (let i = 0; i < deg; i += 1) {
    const next = new Array<number>(poly.length + 1).fill(0);
    for (let j = 0; j < poly.length; j += 1) {
      next[j] ^= poly[j];
      next[j + 1] ^= mul(poly[j], EXP[i]);
    }
    poly = next;
  }
  return poly;
};

/** RS remainder of `data` over `gen` (gen[0] == 1). */
const rsRemainder = (data: number[], gen: number[]): number[] => {
  const rem = new Array<number>(gen.length - 1).fill(0);
  for (const byte of data) {
    const factor = byte ^ (rem.shift() as number);
    rem.push(0);
    if (factor !== 0) {
      for (let i = 0; i < gen.length - 1; i += 1) rem[i] ^= mul(gen[i + 1], factor);
    }
  }
  return rem;
};

// Level-M layout tables for versions 1–10 (ISO/IEC 18004).
const ECC_PER_BLOCK = [10, 16, 26, 18, 24, 16, 18, 22, 22, 26];
const NUM_BLOCKS = [1, 1, 1, 2, 2, 4, 4, 4, 5, 5];
const ALIGN_CENTERS: number[][] = [
  [],
  [6, 18],
  [6, 22],
  [6, 26],
  [6, 30],
  [6, 34],
  [6, 22, 38],
  [6, 24, 42],
  [6, 26, 46],
  [6, 28, 50],
];

const rawDataModules = (version: number): number => {
  const result = (16 * version + 128) * version + 64;
  if (version < 2) return result;
  const numAlign = Math.floor(version / 7) + 2;
  return result - ((25 * numAlign - 10) * numAlign - 55) - (version >= 7 ? 36 : 0);
};

const charCountBits = (version: number) => (version <= 9 ? 8 : 16);

const MASKS = [
  (r: number, c: number) => (r + c) % 2 === 0,
  (r: number, _c: number) => r % 2 === 0,
  (r: number, c: number) => c % 3 === 0,
  (r: number, c: number) => (r + c) % 3 === 0,
  (r: number, c: number) => (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0,
  (r: number, c: number) => ((r * c) % 2) + ((r * c) % 3) === 0,
  (r: number, c: number) => (((r * c) % 2) + ((r * c) % 3)) % 2 === 0,
  (r: number, c: number) => (((r + c) % 2) + ((r * c) % 3)) % 2 === 0,
];

type Grid = boolean[][];

const newGrid = (size: number): Grid =>
  Array.from({ length: size }, () => new Array<boolean>(size).fill(false));

const drawFinder = (grid: Grid, mask: Grid, x: number, y: number) => {
  const size = grid.length;
  for (let dy = -4; dy <= 4; dy += 1) {
    for (let dx = -4; dx <= 4; dx += 1) {
      const xx = x + dx;
      const yy = y + dy;
      if (xx < 0 || yy < 0 || xx >= size || yy >= size) continue;
      const dist = Math.max(Math.abs(dx), Math.abs(dy));
      grid[yy][xx] = dist !== 2 && dist !== 4;
      mask[yy][xx] = true;
    }
  }
};

const drawAlign = (grid: Grid, mask: Grid, x: number, y: number) => {
  for (let dy = -2; dy <= 2; dy += 1) {
    for (let dx = -2; dx <= 2; dx += 1) {
      const dist = Math.max(Math.abs(dx), Math.abs(dy));
      grid[y + dy][x + dx] = dist !== 1;
      mask[y + dy][x + dx] = true;
    }
  }
};

const drawFunctionPatterns = (grid: Grid, mask: Grid, version: number) => {
  const size = grid.length;
  drawFinder(grid, mask, 3, 3);
  drawFinder(grid, mask, size - 4, 3);
  drawFinder(grid, mask, 3, size - 4);
  for (const cx of ALIGN_CENTERS[version - 1]) {
    for (const cy of ALIGN_CENTERS[version - 1]) {
      if (mask[cy][cx]) continue;
      drawAlign(grid, mask, cx, cy);
    }
  }
  // Timing lines at row 6 / column 6.
  for (let i = 0; i < size; i += 1) {
    if (!mask[6][i]) {
      grid[6][i] = i % 2 === 0;
      mask[6][i] = true;
    }
    if (!mask[i][6]) {
      grid[i][6] = i % 2 === 0;
      mask[i][6] = true;
    }
  }
  // Reserve format-info cells (around the finders) and the dark module.
  for (let i = 0; i <= 8; i += 1) {
    if (i !== 6) {
      mask[8][i] = true;
      mask[i][8] = true;
    }
  }
  for (let i = size - 8; i < size; i += 1) {
    mask[8][i] = true;
    mask[i][8] = true;
  }
  // The dark module stays light during mask scoring (like python-qrcode's test
  // matrix) and is set on the winning matrix only.
  mask[size - 8][8] = true;
  // Version info (versions ≥ 7) reserves 2×3 blocks.
  if (version >= 7) {
    for (let i = 0; i < 18; i += 1) {
      const r = Math.floor(i / 3);
      const c = (i % 3) + size - 11;
      mask[r][c] = true;
      mask[c][r] = true;
      // Version bits are drawn only for v>=7; compute them below.
    }
  }
};

const BCH_DIVISOR = 0x537;

const drawFormatBits = (grid: Grid, maskIndex: number) => {
  const size = grid.length;
  // Level M = 00; bits = ecc(2) || mask(3), BCH(15,5), XOR 0x5412.
  const data = (0 << 3) | maskIndex;
  const rem = (() => {
    let bits = data << 10;
    while (bits.toString(2).length >= 11) bits ^= BCH_DIVISOR << (bits.toString(2).length - 11);
    return bits;
  })();
  const bits = (((data << 10) | rem) ^ 0x5412) & 0x7fff;
  const bit = (i: number) => ((bits >> (14 - i)) & 1) !== 0;
  for (let i = 0; i <= 5; i += 1) grid[8][i] = bit(i);
  grid[8][7] = bit(6);
  grid[8][8] = bit(7);
  grid[7][8] = bit(8);
  for (let i = 9; i < 15; i += 1) grid[14 - i][8] = bit(i);
  for (let i = 0; i < 7; i += 1) grid[size - 1 - i][8] = bit(i);
  grid[8][size - 8] = bit(7);
  for (let i = 8; i < 15; i += 1) grid[8][size - 15 + i] = bit(i);
};

const drawVersionBits = (grid: Grid, version: number) => {
  if (version < 7) return;
  const size = grid.length;
  // BCH(18,6) with divisor 0x1f25 handled separately from the format remainder.
  let rem = version;
  for (let i = 0; i < 12; i += 1) rem = (rem << 1) ^ ((rem >> 11) * 0x1f25);
  const bits = (version << 12) | rem;
  for (let i = 0; i < 18; i += 1) {
    const bit = ((bits >> i) & 1) !== 0;
    const a = size - 11 + (i % 3);
    const b = Math.floor(i / 3);
    grid[b][a] = bit;
    grid[a][b] = bit;
  }
};

const encode = (text: string): { version: number; data: number[] } | null => {
  const bytes = [...Buffer.from(text, 'utf8')];
  for (let version = 1; version <= 10; version += 1) {
    const totalCodewords = Math.floor(rawDataModules(version) / 8);
    const eccLen = ECC_PER_BLOCK[version - 1];
    const numBlocks = NUM_BLOCKS[version - 1];
    const capacity = totalCodewords - numBlocks * eccLen;
    const bits: number[] = [];
    const push = (value: number, length: number) => {
      for (let i = length - 1; i >= 0; i -= 1) bits.push((value >> i) & 1);
    };
    push(0b0100, 4);
    push(bytes.length, charCountBits(version));
    for (const byte of bytes) push(byte, 8);
    if (bits.length > capacity * 8) continue;
    push(0, Math.min(4, capacity * 8 - bits.length));
    while (bits.length % 8 !== 0) bits.push(0);
    const data = [] as number[];
    for (let i = 0; i < bits.length; i += 8) {
      data.push(bits.slice(i, i + 8).reduce((acc, bit) => (acc << 1) | bit, 0));
    }
    const pads = [0xec, 0x11];
    for (let i = 0; data.length < capacity; i += 1) data.push(pads[i % 2]);
    return { version, data };
  }
  return null;
};

/** Full codeword stream: data interleaved across blocks, then ECC interleaved. */
const interleave = (version: number, data: number[]): number[] => {
  const eccLen = ECC_PER_BLOCK[version - 1];
  const numBlocks = NUM_BLOCKS[version - 1];
  const total = data.length;
  const numLong = total % numBlocks;
  const gen = rsGenerator(eccLen);
  const dataBlocks: number[][] = [];
  const eccBlocks: number[][] = [];
  let offset = 0;
  for (let b = 0; b < numBlocks; b += 1) {
    const size = b < numBlocks - numLong ? Math.floor(total / numBlocks) : Math.ceil(total / numBlocks);
    const block = data.slice(offset, offset + size);
    offset += size;
    dataBlocks.push(block);
    eccBlocks.push(rsRemainder(block, gen));
  }
  const out: number[] = [];
  const maxLen = Math.max(...dataBlocks.map((b) => b.length));
  for (let i = 0; i < maxLen; i += 1) {
    for (const block of dataBlocks) if (i < block.length) out.push(block[i]);
  }
  for (let i = 0; i < eccLen; i += 1) {
    for (const block of eccBlocks) out.push(block[i]);
  }
  return out;
};

const placeCodewords = (grid: Grid, mask: Grid, codewords: number[]) => {
  const size = grid.length;
  let bitIndex = 0;
  const total = codewords.length * 8;
  let right = size - 1;
  while (right >= 1) {
    if (right === 6) right -= 1; // skip the vertical timing column
    for (let vert = 0; vert < size; vert += 1) {
      const upward = ((size - 1 - right) & 2) === 0;
      const y = upward ? size - 1 - vert : vert;
      for (let j = 0; j < 2; j += 1) {
        const x = right - j;
        if (mask[y][x]) continue;
        grid[y][x] = bitIndex < total && ((codewords[bitIndex >> 3] >> (7 - (bitIndex & 7))) & 1) === 1;
        bitIndex += 1;
      }
    }
    right -= 2;
  }
};

const penalty = (grid: Grid): number => {
  const size = grid.length;
  let score = 0;
  // N1: runs of 5+ same color in rows/columns.
  for (const horizontal of [true, false]) {
    for (let i = 0; i < size; i += 1) {
      let runColor = false;
      let runLen = 0;
      for (let j = 0; j < size; j += 1) {
        const color = horizontal ? grid[i][j] : grid[j][i];
        if (color === runColor) {
          runLen += 1;
          if (runLen === 5) score += 3;
          else if (runLen > 5) score += 1;
        } else {
          runColor = color;
          runLen = 1;
        }
      }
    }
  }
  // N2: 2×2 blocks.
  for (let y = 0; y < size - 1; y += 1) {
    for (let x = 0; x < size - 1; x += 1) {
      const c = grid[y][x];
      if (c === grid[y][x + 1] && c === grid[y + 1][x] && c === grid[y + 1][x + 1]) score += 3;
    }
  }
  // N3: 1:1:3:1:1 pattern with a 4-light side — an 11-module window checked with
  // python-qrcode's exact predicate (and its horspool-style skip) so mask
  // selection matches the reference implementation.
  for (const horizontal of [true, false]) {
    for (let i = 0; i < size; i += 1) {
      const get = (k: number) => (horizontal ? grid[i][k] : grid[k][i]);
      for (let j = 0; j <= size - 11; j += 1) {
        const hit =
          !get(j + 1) &&
          get(j + 4) &&
          !get(j + 5) &&
          get(j + 6) &&
          !get(j + 9) &&
          ((get(j) && get(j + 2) && get(j + 3) && !get(j + 7) && !get(j + 8) && !get(j + 10)) ||
            (!get(j) && !get(j + 2) && !get(j + 3) && get(j + 7) && get(j + 8) && get(j + 10)));
        if (hit) score += 40;
        if (get(j + 10)) j += 1;
      }
    }
  }
  // N4: dark-module proportion.
  let dark = 0;
  for (const row of grid) for (const cell of row) if (cell) dark += 1;
  const ratio = (dark * 100) / (size * size);
  score += Math.floor(Math.abs(ratio - 50) / 5) * 10;
  return score;
};

/** Encodes `text` to a QR module matrix (`true` = dark). Null when too long for v10-M. */
export const qrMatrix = (text: string): Grid | null => {
  const encoded = encode(text);
  if (!encoded) return null;
  const size = encoded.version * 4 + 17;
  const base = newGrid(size);
  const reserved = newGrid(size);
  drawFunctionPatterns(base, reserved, encoded.version);
  placeCodewords(base, reserved, interleave(encoded.version, encoded.data));

  // Score each mask on the matrix with format/version/dark-module cells still
  // light (the same test matrix python-qrcode penalizes), then draw them.
  let best: Grid | null = null;
  let bestMask = 0;
  let bestScore = Number.POSITIVE_INFINITY;
  for (let m = 0; m < 8; m += 1) {
    const candidate = base.map((row) => row.slice());
    for (let y = 0; y < size; y += 1) {
      for (let x = 0; x < size; x += 1) {
        if (!reserved[y][x] && MASKS[m](y, x)) candidate[y][x] = !candidate[y][x];
      }
    }
    const score = penalty(candidate);
    if (score < bestScore) {
      bestScore = score;
      best = candidate;
      bestMask = m;
    }
  }
  if (best) {
    drawVersionBits(best, encoded.version);
    best[size - 8][8] = true;
    drawFormatBits(best, bestMask);
  }
  return best;
};

/** A compact `<svg>` of the matrix — dark modules only, quiet zone of `border` modules. */
export const qrSvg = (text: string, border = 2): string | null => {
  const grid = qrMatrix(text);
  if (!grid) return null;
  const size = grid.length;
  const dim = size + border * 2;
  const paths: string[] = [];
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      if (grid[y][x]) paths.push(`M${x + border} ${y + border}h1v1h-1z`);
    }
  }
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${dim} ${dim}" ` +
    `shape-rendering="crispEdges"><rect width="${dim}" height="${dim}" fill="#fff"/>` +
    `<path d="${paths.join('')}" fill="#000"/></svg>`
  );
};
