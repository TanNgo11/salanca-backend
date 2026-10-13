import { z } from '@strapi/utils';

import { deliveryZoneListSchema } from './delivery/zones';

/**
 * Per-branch ordering settings (contracts §19.6 `LocationOrderingSettings`, §21.1; screens S7).
 * Stored as JSON on `branch.fulfillment[kind]`. Every field has a default so rows written by
 * older code or fixtures still resolve; writes from the Admin are validated strictly with the
 * same schema (`validateBranchInput`). Changing settings never rewrites existing orders — each
 * order pins its workflow, business date and amounts at placement.
 */
const localTime = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'expected HH:mm');
const localDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'expected YYYY-MM-DD');

/** `end < start` means the range closes after midnight (22:00–02:00). */
const timeRange = z
  .object({ start: localTime, end: localTime })
  .refine((range) => range.start !== range.end, 'start and end must differ');

const DAY_MINUTES = 24 * 60;

/** Absolute minutes from the opening date's midnight. An overnight range ends after 24:00. */
const absoluteRange = (range: { start: string; end: string }): { from: number; to: number } => {
  const [startHour, startMinute] = range.start.split(':').map(Number);
  const [endHour, endMinute] = range.end.split(':').map(Number);
  const from = startHour * 60 + startMinute;
  const end = endHour * 60 + endMinute;
  return { from, to: end <= from ? end + DAY_MINUTES : end };
};

const rangesOverlap = (ranges: Array<{ start: string; end: string }>): boolean => {
  const sorted = ranges.map(absoluteRange).sort((left, right) => left.from - right.from);
  return sorted.some((range, index) => index > 0 && range.from < sorted[index - 1].to);
};

/**
 * One calendar day that replaces the regular hours. `closed` is exactly "no ranges":
 * a closed day sells nothing, an open day needs 1–6 ranges that do not overlap.
 */
export const specialHourSchema = z
  .object({
    date: localDate,
    closed: z.boolean().default(false),
    ranges: z.array(timeRange).max(6).default([]),
    note: z.string().max(100).optional(),
  })
  .refine((row) => row.closed === (row.ranges.length === 0), 'closed is true exactly when ranges are empty')
  .refine((row) => !rangesOverlap(row.ranges), 'ranges overlap');

export const specialHoursSchema = z
  .array(specialHourSchema)
  .max(366)
  .default([])
  .superRefine((rows, ctx) => {
    const seen = new Map<string, number>();
    rows.forEach((row, index) => {
      const first = seen.get(row.date);
      if (first !== undefined) {
        ctx.addIssue({ code: 'custom', message: 'duplicate special date', path: [index, 'date'] });
      } else {
        seen.set(row.date, index);
      }
    });
  });

export type SpecialHour = z.infer<typeof specialHourSchema>;

export const WEEKDAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const;
export type Weekday = (typeof WEEKDAYS)[number];

const openingHours = z
  .object({
    mode: z.enum(['24_7', 'daily', 'weekly']).default('daily'),
    daily: z.array(timeRange).max(6).default([{ start: '07:00', end: '22:00' }]),
    weekly: z
      .object(
        Object.fromEntries(WEEKDAYS.map((day) => [day, z.array(timeRange).max(6).default([])])) as Record<
          Weekday,
          z.ZodDefault<z.ZodArray<typeof timeRange>>
        >,
      )
      .prefault({}),
  })
  .prefault({});

export const scheduleSchema = z
  .object({
    leadTimeMinutes: z.number().int().min(0).max(10_080).default(180),
    slotLengthMinutes: z.number().int().min(5).max(240).default(15),
    capacity: z.number().int().min(1).max(10_000).default(8),
    maxAdvanceDays: z.number().int().min(0).max(60).default(7),
    bufferMinutes: z.number().int().min(0).max(240).default(0),
    businessDayPolicy: z
      .object({
        cutoffLocalTime: localTime.default('04:00'),
        holidayDates: z.array(localDate).max(366).default([]),
        specialHours: specialHoursSchema,
      })
      .prefault({}),
    openingHours,
  })
  .prefault({});

export const PAYMENT_TIMINGS = ['prepay', 'accept-then-pay', 'pay-on-pickup'] as const;
export type PaymentTiming = (typeof PAYMENT_TIMINGS)[number];

/** Empty/null disables automatic rejection (screens N4 "trống = tắt"). */
const autoRejectSetting = z.number().int().min(1).max(1440).nullable().default(null);

const receiveBase = {
  enabled: z.boolean().default(false),
  orderTiming: z.enum(['asap', 'scheduled', 'both']).default('both'),
  paymentTiming: z.enum(PAYMENT_TIMINGS).default('pay-on-pickup'),
  paymentProviders: z.array(z.string().min(1)).max(10).default(['cash']),
  paymentTimeoutMinutes: z.number().int().min(1).max(1440).default(15),
  minOrderAmount: z.number().int().min(0).max(1_000_000_000).default(0),
  customerCancelBeforeMinutes: z.number().int().min(0).max(10_080).default(30),
  slaMinutes: z.number().int().min(1).max(1440).default(10),
  autoRejectAfterMinutes: autoRejectSetting,
  schedule: scheduleSchema,
} as const;

export const pickupSettingsSchema = z.object(receiveBase).prefault({});

export const deliverySettingsSchema = z
  .object({
    ...receiveBase,
    zones: deliveryZoneListSchema.default([]),
  })
  .prefault({});

/**
 * O12 dine-in (at-table) settings. Same receive rules as pickup plus `sessionPayment`:
 * `at-close` bills all orders of a table when the session closes; `per-order` follows the
 * normal payment flows (prepay before cooking / pay at counter by `paymentTiming`).
 * `autoRejectAfterMinutes` applies to groups stuck in `awaiting-acceptance`.
 */
export const dineInSettingsSchema = z
  .object({
    ...receiveBase,
    sessionPayment: z.enum(['per-order', 'at-close']).default('at-close'),
  })
  .prefault({});

export type PickupSettings = z.infer<typeof pickupSettingsSchema>;
export type DeliverySettings = z.infer<typeof deliverySettingsSchema>;
export type DineInSettings = z.infer<typeof dineInSettingsSchema>;
export type ScheduleSettings = z.infer<typeof scheduleSchema>;
export type TimeRange = z.infer<typeof timeRange>;

/** O12: the receive kinds pause/busy/config surfaces address. */
export const RECEIVE_KINDS = ['pickup', 'delivery', 'dineIn'] as const;
export type ReceiveKind = (typeof RECEIVE_KINDS)[number];

/** receiveMethod.kind ↔ branch settings key ('dine-in' orders read `dineIn`). */
export const receiveKindKey = (kind: string): ReceiveKind | null =>
  kind === 'pickup' ? 'pickup' : kind === 'delivery' ? 'delivery' : kind === 'dine-in' ? 'dineIn' : null;

const isoInstant = z.string().refine((value) => Number.isFinite(new Date(value).getTime()), 'expected ISO datetime');

/**
 * O12 pause entry per receive kind — `{ until, reason?, by }`. `until` is the instant ordering
 * reopens (staff picks the duration; the API stores the deadline). `reason` is staff-facing.
 */
const pauseEntry = z.object({
  until: isoInstant,
  reason: z.string().max(200).optional(),
  by: z.string().max(120).optional(),
});
export const orderingPauseSchema = z
  .object({
    pickup: pauseEntry.nullable().optional(),
    delivery: pauseEntry.nullable().optional(),
    dineIn: pauseEntry.nullable().optional(),
  })
  .nullable();
export type OrderingPause = z.infer<typeof orderingPauseSchema>;
export type PauseEntry = z.infer<typeof pauseEntry>;

/** O12 busy mode: adds `extraMinutes` to every new ASAP lead time until `until`. */
export const busyModeSchema = z
  .object({
    extraMinutes: z.number().int().min(1).max(240),
    until: isoInstant,
    by: z.string().max(120).optional(),
  })
  .nullable();
export type BusyMode = z.infer<typeof busyModeSchema>;

/** O12 fee (service / packaging) configured on the branch (screens N4). */
export const RECEIVE_KIND_VALUES = ['pickup', 'delivery', 'dine-in'] as const;
export const branchFeeSchema = z
  .object({
    code: z.string().regex(/^[a-z0-9-]{2,40}$/),
    label: z.record(z.string(), z.string().max(120)),
    kind: z.enum(['service', 'packaging']),
    amount: z.number().int().min(0).max(1_000_000_000).optional(),
    percent: z.number().min(0).max(100).optional(),
    receiveKinds: z.array(z.enum(RECEIVE_KIND_VALUES)).min(1).max(3),
    taxable: z.boolean().default(true),
    minSubtotal: z.number().int().min(0).max(1_000_000_000).optional(),
  })
  .refine((fee) => (fee.amount === undefined) !== (fee.percent === undefined), 'exactly one of amount or percent');
export const branchFeesSchema = z.array(branchFeeSchema).max(20).nullable();
export type BranchFee = z.infer<typeof branchFeeSchema>;

/** O12 branch print layout (screens N1/N4). */
export const printingSchema = z
  .object({
    width: z.union([z.literal(58), z.literal(80)]).default(80),
    header: z.string().max(200).optional(),
    footer: z.string().max(200).optional(),
    autoKitchenTicket: z.boolean().default(false),
  })
  .nullable();
export type PrintingSettings = z.infer<typeof printingSchema>;

export const cashRoundingSchema = z
  .object({
    enabled: z.boolean(),
    multiple: z.number().int().min(1).max(100_000),
    providerCodes: z.array(z.string().min(1)).default(['cash']),
  })
  .nullable();

const branchCode = z
  .string()
  .regex(/^[A-Za-z0-9][A-Za-z0-9_-]{0,31}$/, 'letters, digits, "-" or "_", max 32');

const localizedName = z.record(z.string(), z.string().max(120)).refine(
  (value) => Object.values(value).some((text) => text.trim() !== ''),
  'at least one locale is required',
);

/** Fields the Admin may write. `code` is accepted on create only (immutable afterwards). */
export const branchInputSchema = z.object({
  code: branchCode.optional(),
  name: localizedName.optional(),
  address: z.record(z.string(), z.unknown()).nullable().optional(),
  phone: z.string().max(32).nullable().optional(),
  email: z.string().email().max(254).nullable().optional().or(z.literal('')),
  timezone: z.string().min(1).optional(),
  isActive: z.boolean().optional(),
  onlineOrdering: z.boolean().optional(),
  cartReminderEnabled: z.boolean().optional(),
  rank: z.number().int().optional(),
  cashRounding: cashRoundingSchema.optional(),
  fees: branchFeesSchema.optional(),
  printing: printingSchema.optional(),
  fulfillment: z
    .object({
      pickup: pickupSettingsSchema.optional(),
      delivery: deliverySettingsSchema.optional(),
      dineIn: dineInSettingsSchema.optional(),
    })
    .loose()
    .optional(),
});

export type BranchInput = z.infer<typeof branchInputSchema>;

export type ValidationIssue = { path: string; message: string };

export const isValidTimezone = (timezone: string): boolean => {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: timezone });
    return true;
  } catch {
    return false;
  }
};

type ReceiveSettings = {
  enabled: boolean;
  paymentTiming: PaymentTiming;
  paymentProviders: string[];
  schedule: ScheduleSettings;
};

const receiveIssues = (
  kind: ReceiveKind,
  settings: ReceiveSettings,
  options: { knownProviders: string[]; onlineProviders: string[] },
): ValidationIssue[] => {
  const issues: ValidationIssue[] = [];
  const base = `fulfillment.${kind}`;
  for (const [index, code] of settings.paymentProviders.entries()) {
    if (!options.knownProviders.includes(code)) {
      issues.push({
        path: `${base}.paymentProviders.${index}`,
        message: `payment provider "${code}" is not enabled`,
      });
    }
  }
  if (settings.enabled && settings.paymentProviders.length === 0) {
    issues.push({ path: `${base}.paymentProviders`, message: 'select at least one payment method' });
  }
  if (settings.paymentTiming !== 'pay-on-pickup') {
    const online = settings.paymentProviders.filter((code) => options.onlineProviders.includes(code));
    if (online.length === 0) {
      issues.push({
        path: `${base}.paymentTiming`,
        message: `${settings.paymentTiming} needs an enabled online payment provider`,
      });
    }
  } else if (!settings.paymentProviders.includes('cash')) {
    issues.push({ path: `${base}.paymentProviders`, message: 'pay-on-pickup needs the cash provider' });
  }
  const hours = settings.schedule.openingHours;
  if (settings.enabled && hours.mode === 'daily' && hours.daily.length === 0) {
    issues.push({ path: `${base}.schedule.openingHours.daily`, message: 'add at least one opening range' });
  }
  return issues;
};

/**
 * Strict Admin-side validation. Returns field-addressed issues (path like
 * `fulfillment.pickup.schedule.leadTimeMinutes`) so the screen can show them under each field.
 * `onlineProviders` are the registered, enabled non-cash payment providers: `prepay` and
 * `accept-then-pay` need at least one (contracts §19.6); `knownProviders` are every enabled code.
 * `knownCommuneCodes` is set when the administrative-unit catalog is loaded; delivery zones
 * may only name communes from that catalog.
 */
export function validateBranchInput(
  raw: unknown,
  options: {
    mode: 'create' | 'update';
    knownProviders: string[];
    onlineProviders: string[];
    catalogAvailable?: boolean;
    knownCommuneCodes?: ReadonlySet<string>;
  },
): { valid: true; value: BranchInput } | { valid: false; issues: ValidationIssue[] } {
  const parsed = branchInputSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      valid: false,
      issues: parsed.error.issues.map((issue) => ({
        path: issue.path.join('.'),
        message: issue.message,
      })),
    };
  }
  const value = parsed.data;
  const issues: ValidationIssue[] = [];
  if (options.mode === 'create') {
    if (!value.code) issues.push({ path: 'code', message: 'code is required' });
    if (!value.name) issues.push({ path: 'name', message: 'name is required' });
  }
  if (value.timezone !== undefined && !isValidTimezone(value.timezone)) {
    issues.push({ path: 'timezone', message: 'unknown IANA timezone' });
  }
  const pickup = value.fulfillment?.pickup;
  if (pickup) issues.push(...receiveIssues('pickup', pickup, options));
  const delivery = value.fulfillment?.delivery;
  if (delivery) {
    issues.push(...receiveIssues('delivery', delivery, options));
    const wantsDelivery = delivery.enabled || delivery.zones.length > 0;
    if (wantsDelivery && options.catalogAvailable === false) {
      issues.push({
        path: 'fulfillment.delivery.zones',
        message: 'administrative-unit catalog is not loaded',
      });
    }
    if (options.knownCommuneCodes) {
      for (const [zoneIndex, zone] of delivery.zones.entries()) {
        for (const [communeIndex, code] of zone.match.communeCodes.entries()) {
          if (!options.knownCommuneCodes.has(code)) {
            issues.push({
              path: `fulfillment.delivery.zones.${zoneIndex}.match.communeCodes.${communeIndex}`,
              message: `commune ${code} is not in the catalog`,
            });
          }
        }
      }
    }
  }
  const dineIn = value.fulfillment?.dineIn;
  if (dineIn) issues.push(...receiveIssues('dineIn', dineIn, options));
  if (value.fees) {
    const codes = value.fees.map((fee) => fee.code);
    if (new Set(codes).size !== codes.length) {
      issues.push({ path: 'fees', message: 'fee codes must be unique' });
    }
  }
  return issues.length > 0 ? { valid: false, issues } : { valid: true, value };
}

/** Lenient read: defaults fill anything missing; malformed stored JSON falls back to defaults. */
export function resolvePickupSettings(raw: unknown): PickupSettings {
  const parsed = pickupSettingsSchema.safeParse(raw ?? {});
  return parsed.success ? parsed.data : pickupSettingsSchema.parse({});
}

export function resolveDeliverySettings(raw: unknown): DeliverySettings {
  const parsed = deliverySettingsSchema.safeParse(raw ?? {});
  return parsed.success ? parsed.data : deliverySettingsSchema.parse({});
}

export function resolveDineInSettings(raw: unknown): DineInSettings {
  const parsed = dineInSettingsSchema.safeParse(raw ?? {});
  return parsed.success ? parsed.data : dineInSettingsSchema.parse({});
}

export function resolveOrderingPause(raw: unknown): OrderingPause {
  const parsed = orderingPauseSchema.safeParse(raw ?? null);
  return parsed.success ? parsed.data : null;
}

export function resolveBusyMode(raw: unknown): BusyMode {
  const parsed = busyModeSchema.safeParse(raw ?? null);
  return parsed.success ? parsed.data : null;
}

export function resolveBranchFees(raw: unknown): BranchFee[] {
  const parsed = branchFeesSchema.safeParse(raw ?? []);
  return parsed.success ? parsed.data ?? [] : [];
}

export function resolvePrinting(raw: unknown): PrintingSettings {
  const parsed = printingSchema.safeParse(raw ?? null);
  return parsed.success ? parsed.data : null;
}

/** Active pause entry for a receive kind at `now`, or null when ordering is open. */
export function activePause(pause: OrderingPause, kind: ReceiveKind, now: Date): PauseEntry | null {
  const entry = pause?.[kind];
  if (!entry) return null;
  return new Date(entry.until).getTime() > now.getTime() ? entry : null;
}

/** Extra lead-time minutes a busy branch adds at `now` (0 when off/expired). */
export function busyExtraMinutes(busy: BusyMode, now: Date): number {
  if (!busy) return 0;
  return new Date(busy.until).getTime() > now.getTime() ? busy.extraMinutes : 0;
}

/** Auto-reject timeout for a receive kind, or null when the job skips this branch. */
export function autoRejectMinutes(settings: { autoRejectAfterMinutes: number | null }): number | null {
  return settings.autoRejectAfterMinutes ?? null;
}
