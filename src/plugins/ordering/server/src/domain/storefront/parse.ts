import type { AddressSnapshot } from '../../contracts/common';
import { OrderingError } from '../errors';

/**
 * Request parsing for the public storefront API. Only listed fields are read; client-sent amounts,
 * adjustments, fees, statuses or origins are never looked at (contracts §11: the server prices).
 */
export const LIMITS = {
  lines: 50,
  quantity: 99,
  selected: 30,
  lineNote: 200,
  customerNote: 500,
  name: 120,
  email: 254,
  bodyBytes: 32 * 1024,
} as const;

export type CartRequest = {
  locationRef: string;
  locale?: string;
  lines: Array<{
    sellableUid: string;
    quantity: number;
    selected: Array<{ groupUid: string; optionUid: string; quantity: number }>;
    note?: string;
  }>;
  receiveMethod:
    | { kind: 'pickup'; locationRef: string }
    | { kind: 'delivery'; address: AddressSnapshot; providerCode: 'self-delivery' }
    | { kind: 'dine-in'; locationRef: string; tableToken: string };
  pickup: { asap?: boolean; slot?: { startsAt: string } };
  payment?: { providerCode: string };
  promotionCode?: string;
};

export type OrderRequest = CartRequest & {
  contact: { name?: string; phone: string; email?: string };
  consent: { policyVersion: string; marketingOptIn: boolean };
  customerNote?: string;
  expectedCartHash?: string;
  captchaToken?: string;
};

const invalid = (field: string, message: string) =>
  new OrderingError('VALIDATION_ERROR', message, { details: { field } });

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const str = (value: unknown, field: string, max: number, required = false): string | undefined => {
  if (value === undefined || value === null || value === '') {
    if (required) throw invalid(field, `${field} is required`);
    return undefined;
  }
  if (typeof value !== 'string') throw invalid(field, `${field} must be a string`);
  const trimmed = value.trim();
  if (trimmed.length > max) throw invalid(field, `${field} is too long`);
  if (required && trimmed === '') throw invalid(field, `${field} is required`);
  return trimmed === '' ? undefined : trimmed;
};

const int = (value: unknown, field: string, min: number, max: number): number => {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max) {
    throw invalid(field, `${field} must be an integer between ${min} and ${max}`);
  }
  return value;
};

export function parseCartRequest(body: unknown): CartRequest {
  if (!isObject(body)) throw invalid('body', 'request body must be a JSON object');
  const locationRef = str(body.branch, 'branch', 32, true) as string;
  const locale = str(body.locale, 'locale', 10);
  if (!Array.isArray(body.lines) || body.lines.length === 0) {
    throw invalid('lines', 'at least one line is required');
  }
  if (body.lines.length > LIMITS.lines) throw invalid('lines', 'too many lines');
  const lines = body.lines.map((raw, index) => {
    if (!isObject(raw)) throw invalid(`lines.${index}`, 'line must be an object');
    const selected = raw.selected ?? [];
    if (!Array.isArray(selected) || selected.length > LIMITS.selected) {
      throw invalid(`lines.${index}.selected`, 'selected must be a short list');
    }
    return {
      sellableUid: str(raw.sellableUid, `lines.${index}.sellableUid`, 100, true) as string,
      quantity: int(raw.quantity, `lines.${index}.quantity`, 1, LIMITS.quantity),
      selected: selected.map((pick, pickIndex) => {
        const field = `lines.${index}.selected.${pickIndex}`;
        if (!isObject(pick)) throw invalid(field, 'option must be an object');
        return {
          groupUid: str(pick.groupUid, `${field}.groupUid`, 100, true) as string,
          optionUid: str(pick.optionUid, `${field}.optionUid`, 100, true) as string,
          quantity: pick.quantity === undefined ? 1 : int(pick.quantity, `${field}.quantity`, 1, 99),
        };
      }),
      note: str(raw.note, `lines.${index}.note`, LIMITS.lineNote),
    };
  });
  const receive = isObject(body.receiveMethod) ? body.receiveMethod : {};
  const slot = isObject(receive.slot) ? receive.slot : undefined;
  const startsAt = slot ? str(slot.startsAt, 'receiveMethod.slot.startsAt', 40, true) : undefined;
  const pickup = startsAt ? { slot: { startsAt } } : { asap: true };
  let receiveMethod: CartRequest['receiveMethod'];
  if (receive.kind === 'pickup') {
    receiveMethod = { kind: 'pickup', locationRef };
  } else if (receive.kind === 'delivery') {
    const address = isObject(receive.address) ? receive.address : {};
    // Names are filled from the catalog at placement. Client-sent names are ignored.
    const communeCode = str(
      address.communeCode ?? address.wardCode,
      'receiveMethod.address.communeCode',
      16,
      true,
    ) as string;
    if (!/^[0-9A-Za-z]{1,16}$/.test(communeCode)) {
      throw invalid('receiveMethod.address.communeCode', 'receiveMethod.address.communeCode must be a commune code');
    }
    receiveMethod = {
      kind: 'delivery',
      providerCode: 'self-delivery',
      address: {
        recipientName: str(address.recipientName, 'receiveMethod.address.recipientName', LIMITS.name, true) as string,
        phone: str(address.phone, 'receiveMethod.address.phone', 32, true) as string,
        line1: str(address.line1, 'receiveMethod.address.line1', 200, true) as string,
        wardCode: communeCode.toUpperCase(),
        ...(str(address.note, 'receiveMethod.address.note', 200) ? { note: str(address.note, 'receiveMethod.address.note', 200) } : {}),
      },
    };
  } else if (receive.kind === 'dine-in') {
    // O12: the table QR secret. Server resolves it to the table row — the stored order keeps
    // tableId/tableCode, never the token.
    receiveMethod = {
      kind: 'dine-in',
      locationRef,
      tableToken: str(receive.tableToken, 'receiveMethod.tableToken', 200, true) as string,
    };
  } else {
    throw new OrderingError('FULFILLMENT_UNAVAILABLE', 'this receive method is not available', {
      details: { field: 'receiveMethod.kind' },
    });
  }
  const payment = isObject(body.payment)
    ? { providerCode: str(body.payment.providerCode, 'payment.providerCode', 40, true) as string }
    : undefined;
  const promotionCode = str(body.promotionCode, 'promotionCode', 32);
  return {
    locationRef,
    locale,
    lines,
    receiveMethod,
    pickup,
    ...(payment ? { payment } : {}),
    ...(promotionCode ? { promotionCode } : {}),
  };
}

export function parseOrderRequest(body: unknown): OrderRequest {
  const cart = parseCartRequest(body);
  const raw = body as Record<string, unknown>;
  const contact = isObject(raw.contact) ? raw.contact : {};
  const consent = isObject(raw.consent) ? raw.consent : undefined;
  if (!consent || typeof consent.policyVersion !== 'string' || consent.accepted !== true) {
    throw new OrderingError('CONSENT_REQUIRED', 'consent to process personal data is required', {
      details: { field: 'consent' },
    });
  }
  const email = str(contact.email, 'contact.email', LIMITS.email);
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw invalid('contact.email', 'contact.email is not a valid address');
  }
  return {
    ...cart,
    contact: {
      name: str(contact.name, 'contact.name', LIMITS.name),
      phone: str(contact.phone, 'contact.phone', 32, true) as string,
      ...(email ? { email } : {}),
    },
    consent: { policyVersion: consent.policyVersion, marketingOptIn: consent.marketingOptIn === true },
    customerNote: str(raw.customerNote, 'customerNote', LIMITS.customerNote),
    expectedCartHash: str(raw.expectedCartHash, 'expectedCartHash', 128),
    captchaToken: str(raw.captchaToken, 'captchaToken', 4096),
  };
}

/** `Idempotency-Key`: 8–128 visible ASCII characters without spaces. */
export function parseIdempotencyKey(header: unknown): string {
  if (typeof header !== 'string' || !/^[A-Za-z0-9_:.-]{8,128}$/.test(header)) {
    throw invalid('Idempotency-Key', 'Idempotency-Key header is required (8–128 characters)');
  }
  return header;
}
