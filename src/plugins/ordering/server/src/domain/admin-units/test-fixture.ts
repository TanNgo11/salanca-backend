import type { AdminUnitFile } from './catalog';

/**
 * TEST FIXTURE ONLY. Every code uses the prefix `XT`, which is not an official
 * Vietnamese administrative code. Do not copy these into
 * `server/src/data/admin-units/`. `resolveCatalog` loads this object only when
 * `testing.builtins` is on and that directory has no versioned JSON file.
 */
export const TEST_ADMIN_UNITS: AdminUnitFile = {
  version: 'test-fixture',
  source: 'TEST FIXTURE — mã giả tiền tố XT, không phải danh mục Tổng cục Thống kê',
  effectiveFrom: '2025-07-01',
  provinces: [
    { code: 'XT01', name: 'Tỉnh Thử Một' },
    { code: 'XT02', name: 'Thành phố Thử Hai' },
  ],
  communes: [
    { code: 'XT01001', name: 'Phường Bến Thử', provinceCode: 'XT01' },
    { code: 'XT01002', name: 'Xã Đồng Thử', provinceCode: 'XT01' },
    { code: 'XT01003', name: 'Xã Đăng Thử', provinceCode: 'XT01' },
    { code: 'XT02001', name: 'Phường Cầu Thử', provinceCode: 'XT02' },
    { code: 'XT02002', name: 'Xã Núi Thử', provinceCode: 'XT02' },
  ],
};
