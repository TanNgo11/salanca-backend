import { describe, expect, it } from 'vitest';

import { buildCatalog } from '../admin-units/catalog';
import { TEST_ADMIN_UNITS } from '../admin-units/test-fixture';
import { snapshotDeliveryAddress } from './address';

const catalog = buildCatalog(TEST_ADMIN_UNITS);

const complete = {
  recipientName: 'Lan',
  phone: '0901234567',
  line1: '12 Đường Bí Mật',
  communeCode: 'xt01002',
  wardName: 'HACKED',
  provinceName: 'HACKED',
};

describe('snapshotDeliveryAddress', () => {
  it('requires a commune', () => {
    const missing = snapshotDeliveryAddress({ ...complete, communeCode: '  ', wardCode: undefined }, catalog);
    expect(missing).toMatchObject({ ok: false, reason: 'missing-commune', field: 'receiveMethod.address.communeCode' });
  });

  it('rejects a code that is not in the catalog', () => {
    const unknown = snapshotDeliveryAddress({ ...complete, communeCode: 'XT99999' }, catalog);
    expect(unknown).toMatchObject({ ok: false, reason: 'unknown-commune' });
    expect(JSON.stringify(unknown)).not.toContain('Bí Mật');
    expect(JSON.stringify(unknown)).not.toContain('HACKED');
  });

  it('stores catalog names and a normalized phone, not the names the client sent', () => {
    const resolved = snapshotDeliveryAddress(complete, catalog);
    expect(resolved).toEqual({
      ok: true,
      address: {
        recipientName: 'Lan',
        phone: '+84901234567',
        line1: '12 Đường Bí Mật',
        wardCode: 'XT01002',
        provinceCode: 'XT01',
        wardName: 'Xã Đồng Thử',
        provinceName: 'Tỉnh Thử Một',
      },
    });
  });
});
