import { normalizeVietnamesePhone } from '../../../../shared/contact/phone';
import type { AddressSnapshot } from '../../contracts/common';
import { lookupCommune, type AdminUnitCatalog } from '../admin-units/catalog';

export type DeliveryAddressInput = {
  recipientName?: string;
  phone?: string;
  line1?: string;
  wardCode?: string;
  communeCode?: string;
  note?: string;
  /** Ignored. Names are copied from the catalog at placement. */
  provinceName?: string;
  wardName?: string;
};

export type AddressFailure = {
  ok: false;
  reason: 'missing-commune' | 'unknown-commune' | 'phone' | 'recipient' | 'line1';
  field: string;
  message: string;
};

const fail = (reason: AddressFailure['reason'], field: string, message: string): AddressFailure => ({
  ok: false,
  reason,
  field,
  message,
});

/**
 * Delivery address at placement. The commune must exist in the loaded catalog.
 * Province and ward names are the catalog's names, never the client's.
 */
export function snapshotDeliveryAddress(
  raw: DeliveryAddressInput,
  catalog: AdminUnitCatalog,
): { ok: true; address: AddressSnapshot } | AddressFailure {
  const recipientName = raw.recipientName?.trim() ?? '';
  if (recipientName === '') {
    return fail('recipient', 'receiveMethod.address.recipientName', 'recipient name is required');
  }
  const line1 = raw.line1?.trim() ?? '';
  if (line1 === '') {
    return fail('line1', 'receiveMethod.address.line1', 'street address is required');
  }
  const phone = normalizeVietnamesePhone(raw.phone);
  if (!phone.valid) {
    return fail('phone', 'receiveMethod.address.phone', 'address phone must be a Vietnamese phone number');
  }
  const communeCode = (raw.communeCode ?? raw.wardCode ?? '').trim();
  if (communeCode === '') {
    return fail('missing-commune', 'receiveMethod.address.communeCode', 'commune is required');
  }
  const commune = lookupCommune(catalog, communeCode);
  if (!commune) {
    return fail('unknown-commune', 'receiveMethod.address.communeCode', 'commune is not in the catalog');
  }
  const note = raw.note?.trim();
  return {
    ok: true,
    address: {
      recipientName,
      phone: phone.e164,
      line1,
      wardCode: commune.code,
      provinceCode: commune.provinceCode,
      wardName: commune.name,
      provinceName: commune.provinceName,
      ...(note ? { note } : {}),
    },
  };
}
