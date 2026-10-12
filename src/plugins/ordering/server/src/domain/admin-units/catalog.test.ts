import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  buildCatalog,
  catalogView,
  deliveryCatalogWarning,
  foldAdminUnitName,
  parseAdminUnitFile,
  readAdminUnitDirectory,
  resolveCatalog,
} from './catalog';
import { TEST_ADMIN_UNITS } from './test-fixture';

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const tempDir = (): string => {
  const dir = mkdtempSync(path.join(tmpdir(), 'admin-units-'));
  dirs.push(dir);
  return dir;
};

describe('foldAdminUnitName', () => {
  it('strips Vietnamese diacritics, including đ', () => {
    expect(foldAdminUnitName('Phường Bến Thử')).toBe('phuong ben thu');
    expect(foldAdminUnitName('Xã Đăng Thử')).toBe('xa dang thu');
    expect(foldAdminUnitName('Thành phố Thử Hai')).toBe('thanh pho thu hai');
  });
});

describe('test fixture catalog', () => {
  const catalog = buildCatalog(TEST_ADMIN_UNITS);

  it('counts match the fixture source, and every code is a fake XT code', () => {
    expect(catalog.provinces).toHaveLength(TEST_ADMIN_UNITS.provinces.length);
    expect(catalog.communes).toHaveLength(TEST_ADMIN_UNITS.communes.length);
    expect(catalog.provinces).toHaveLength(2);
    expect(catalog.communes).toHaveLength(5);
    expect(catalog.version).toBe('test-fixture');
    expect(catalog.source).toMatch(/TEST FIXTURE/);
    for (const row of [...catalog.provinces, ...catalog.communes]) {
      expect(row.code.startsWith('XT')).toBe(true);
    }
  });

  it('finds a commune by an unaccented query, scoped to its province', () => {
    const view = catalogView(
      { available: true, origin: 'test-fixture', catalog, message: null, fileName: null },
      { q: 'ben thu', provinceCode: 'xt01', limit: 20 },
    );
    expect(view.communes.map((row) => row.code)).toEqual(['XT01001']);
    expect(view.communes[0]).toMatchObject({ name: 'Phường Bến Thử', provinceName: 'Tỉnh Thử Một' });
  });

  it('matches đ without the accent and does not leak another province', () => {
    const view = catalogView(
      { available: true, origin: 'test-fixture', catalog, message: null, fileName: null },
      { q: 'DANG', provinceCode: 'XT01', limit: 20 },
    );
    expect(view.communes.map((row) => row.name)).toEqual(['Xã Đăng Thử']);
    const other = catalogView(
      { available: true, origin: 'test-fixture', catalog, message: null, fileName: null },
      { q: 'nui thu', provinceCode: 'XT01', limit: 20 },
    );
    expect(other.communes).toEqual([]);
  });

  it('lists provinces only until a province or a query is given', () => {
    const view = catalogView(
      { available: true, origin: 'test-fixture', catalog, message: null, fileName: null },
      { limit: 20 },
    );
    expect(view.provinceCount).toBe(2);
    expect(view.communeCount).toBe(5);
    expect(view.provinces).toHaveLength(2);
    expect(view.communes).toEqual([]);
  });
});

describe('parseAdminUnitFile', () => {
  it('rejects a duplicate commune and a commune whose province is missing', () => {
    const duplicate = parseAdminUnitFile({
      ...TEST_ADMIN_UNITS,
      communes: [
        TEST_ADMIN_UNITS.communes[0],
        { ...TEST_ADMIN_UNITS.communes[0] },
      ],
    });
    expect(duplicate.ok).toBe(false);
    if (!duplicate.ok) expect(duplicate.message).toMatch(/duplicate commune/);

    const orphan = parseAdminUnitFile({
      ...TEST_ADMIN_UNITS,
      communes: [{ code: 'XT99001', name: 'Xã Ma', provinceCode: 'XT99' }],
    });
    expect(orphan.ok).toBe(false);
    if (!orphan.ok) expect(orphan.message).toMatch(/unknown province XT99/);
  });
});

describe('readAdminUnitDirectory', () => {
  it('uses the file counts, not a hardcoded national total', () => {
    const dir = tempDir();
    writeFileSync(
      path.join(dir, '2025-07-01.json'),
      JSON.stringify({
        version: '2025-07-01',
        source: 'owner-supplied-test-file',
        effectiveFrom: '2025-07-01',
        provinces: [{ code: '01', name: 'Một' }],
        communes: [
          { code: '00001', name: 'Xã Một', provinceCode: '01' },
          { code: '00002', name: 'Xã Hai', provinceCode: '01' },
        ],
      }),
    );
    const read = readAdminUnitDirectory(dir);
    expect(read.ok).toBe(true);
    if (!read.ok) return;
    expect(read.catalog.provinces).toHaveLength(1);
    expect(read.catalog.communes).toHaveLength(2);
    expect(read.fileName).toBe('2025-07-01.json');
  });

  it('ignores test-*.json and reports a missing directory', () => {
    const dir = tempDir();
    writeFileSync(path.join(dir, 'test-fixture.json'), '{}');
    const empty = readAdminUnitDirectory(dir);
    expect(empty.ok).toBe(false);
    if (!empty.ok) expect(empty.reason).toBe('missing');
    expect(readAdminUnitDirectory(path.join(dir, 'nope')).ok).toBe(false);
  });

  it('reports an invalid file instead of dropping it', () => {
    const dir = tempDir();
    writeFileSync(path.join(dir, '2025-07-01.json'), '{');
    const read = readAdminUnitDirectory(dir);
    expect(read.ok).toBe(false);
    if (!read.ok) expect(read.reason).toBe('invalid');
  });
});

describe('resolveCatalog', () => {
  const fixture = TEST_ADMIN_UNITS;

  it('loads the test fixture only when builtins are on and no file exists', () => {
    const missing = readAdminUnitDirectory(path.join(tempDir(), 'absent'));
    const withBuiltins = resolveCatalog({ fromDisk: missing, testingBuiltins: true, fixture });
    expect(withBuiltins.origin).toBe('test-fixture');
    expect(withBuiltins.catalog.communes).toHaveLength(5);
    const without = resolveCatalog({ fromDisk: missing, testingBuiltins: false, fixture });
    expect(without.available).toBe(false);
    expect(without.origin).toBe('none');
    expect(without.catalog.communes).toHaveLength(0);
  });

  it('keeps an official file and does not replace an invalid file with the fixture', () => {
    const dir = tempDir();
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      path.join(dir, '2026-01-01.json'),
      JSON.stringify({
        version: '2026-01-01',
        source: 'owner file',
        effectiveFrom: '2026-01-01',
        provinces: [{ code: '79', name: 'Thành phố Hồ Chí Minh' }],
        communes: [{ code: '79001', name: 'Phường Bến Nghé', provinceCode: '79' }],
      }),
    );
    const file = resolveCatalog({
      fromDisk: readAdminUnitDirectory(dir),
      testingBuiltins: true,
      fixture,
    });
    expect(file.origin).toBe('file');
    expect(file.catalog.provinces).toHaveLength(1);
    expect(file.catalog.communes[0]?.code).toBe('79001');

    const badDir = tempDir();
    writeFileSync(path.join(badDir, 'broken.json'), '{');
    const invalid = resolveCatalog({
      fromDisk: readAdminUnitDirectory(badDir),
      testingBuiltins: true,
      fixture,
    });
    expect(invalid.available).toBe(false);
    expect(invalid.origin).toBe('none');
  });
});

describe('deliveryCatalogWarning', () => {
  it('warns only when delivery is on and the catalog is missing', () => {
    const missing = resolveCatalog({
      fromDisk: readAdminUnitDirectory(path.join(tempDir(), 'absent')),
      testingBuiltins: false,
      fixture: TEST_ADMIN_UNITS,
    });
    expect(deliveryCatalogWarning({ deliveryEnabled: false, resolved: missing })).toBeNull();
    expect(deliveryCatalogWarning({ deliveryEnabled: true, resolved: missing })).toMatch(
      /src\/plugins\/ordering\/server\/src\/data\/admin-units/,
    );
    const fixture = resolveCatalog({
      fromDisk: readAdminUnitDirectory(path.join(tempDir(), 'absent')),
      testingBuiltins: true,
      fixture: TEST_ADMIN_UNITS,
    });
    expect(deliveryCatalogWarning({ deliveryEnabled: true, resolved: fixture })).toBeNull();
  });
});
