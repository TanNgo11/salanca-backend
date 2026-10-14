import type { Money } from '../domain/money';

/** Common types shared by every contract (contracts doc §3, §21.4). Pure types only. */
export type JsonObject = Record<string, unknown>;
export type Locale = string;

export type AddressSnapshot = {
  recipientName: string;
  phone: string;
  line1: string;
  provinceCode?: string;
  wardCode?: string;
  provinceName?: string;
  wardName?: string;
  note?: string;
};

export type SlotSelection = {
  scheduleRef: string;
  resourceRef?: string;
  startsAt: string;
  endsAt: string;
  timezone: string;
};

export type ReceiveMethod =
  | { kind: 'pickup'; locationRef: string }
  | { kind: 'delivery'; address: AddressSnapshot; providerCode?: string }
  | {
      kind: 'dine-in';
      locationRef: string;
      /** Customer-supplied QR secret at intake; the stored snapshot carries tableId/tableCode. */
      tableToken?: string;
      tableId?: number;
      tableCode?: string;
    }
  | { kind: 'appointment'; locationRef: string; slot: SlotSelection }
  // O9: a gift-card order delivers codes by email, not food. `recipientEmail` is required on
  // the public storefront (staff counter sales may hand a printed card instead). `physicalCodes`
  // (counter sale of preprinted stock) names the inactive batch cards to activate — one per
  // card unit. It is intake only: create stores the resolved `physicalCardIds`, never codes.
  | {
      kind: 'digital';
      recipientEmail?: string;
      recipientName?: string;
      message?: string;
      physicalCodes?: string[];
      physicalCardIds?: number[];
    };

export type ValidationResult =
  | { valid: true }
  | { valid: false; code: string; message: string; details?: JsonObject };

export type SelectedOptionInput = { groupUid: string; optionUid: string; quantity: number };

export type AdapterContext = {
  now: string;
  locationRef?: string;
  /** Price channel: `pickup` | `delivery` | `dine-in` | `staff`. Not the consent channel. */
  channel?: string;
  /** Group codes of a signed-in customer, or of the profile on a staff draft. Empty for a guest. */
  customerGroups?: string[];
  /** Branch IANA zone. Weekday and time-range prices do not match without it. */
  timezone?: string;
};

export type AvailabilityResult = {
  available: boolean;
  reasonCode?: string;
  availableQuantity?: number;
};

export type Hold = { id: string; expiresAt: string; quantity: number; resourceRef?: string };

export type ConsentSnapshot = {
  policyVersion: string;
  acceptedAt: string;
  channel: 'web-checkout' | 'phone-staff';
  actorRef?: string;
  marketingOptIn: boolean;
};

export type Adjustment = {
  code: string;
  label: string;
  amount: Money;
  priority: number;
  taxable: boolean;
};

export type QuoteTotals = {
  subtotal: Money;
  adjustmentTotal: Money;
  fulfillmentTotal: Money;
  taxTotal: Money;
  grandTotal: Money;
};

export type Quote = {
  quoteVersion: string;
  cartHash: string;
  lines: JsonObject[];
  adjustments: Adjustment[];
  totals: QuoteTotals;
};
