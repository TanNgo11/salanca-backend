import { z } from '@strapi/utils';

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
      })
      .prefault({}),
    openingHours,
  })
  .prefault({});

export const PAYMENT_TIMINGS = ['prepay', 'accept-then-pay', 'pay-on-pickup'] as const;
export type PaymentTiming = (typeof PAYMENT_TIMINGS)[number];

export const pickupSettingsSchema = z
  .object({
    enabled: z.boolean().default(false),
    orderTiming: z.enum(['asap', 'scheduled', 'both']).default('both'),
    paymentTiming: z.enum(PAYMENT_TIMINGS).default('pay-on-pickup'),
    paymentProviders: z.array(z.string().min(1)).max(10).default(['cash']),
    paymentTimeoutMinutes: z.number().int().min(1).max(1440).default(15),
    minOrderAmount: z.number().int().min(0).max(1_000_000_000).default(0),
    customerCancelBeforeMinutes: z.number().int().min(0).max(10_080).default(30),
    slaMinutes: z.number().int().min(1).max(1440).default(10),
    schedule: scheduleSchema,
  })
  .prefault({});

export type PickupSettings = z.infer<typeof pickupSettingsSchema>;
export type ScheduleSettings = z.infer<typeof scheduleSchema>;
export type TimeRange = z.infer<typeof timeRange>;

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
  rank: z.number().int().optional(),
  cashRounding: cashRoundingSchema.optional(),
  fulfillment: z
    .object({ pickup: pickupSettingsSchema.optional() })
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

/**
 * Strict Admin-side validation. Returns field-addressed issues (path like
 * `fulfillment.pickup.schedule.leadTimeMinutes`) so the screen can show them under each field.
 * `onlineProviders` are the registered, enabled non-cash payment providers: `prepay` and
 * `accept-then-pay` need at least one (contracts §19.6); `knownProviders` are every enabled code.
 */
export function validateBranchInput(
  raw: unknown,
  options: { mode: 'create' | 'update'; knownProviders: string[]; onlineProviders: string[] },
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
  if (pickup) {
    for (const [index, code] of pickup.paymentProviders.entries()) {
      if (!options.knownProviders.includes(code)) {
        issues.push({
          path: `fulfillment.pickup.paymentProviders.${index}`,
          message: `payment provider "${code}" is not enabled`,
        });
      }
    }
    if (pickup.enabled && pickup.paymentProviders.length === 0) {
      issues.push({
        path: 'fulfillment.pickup.paymentProviders',
        message: 'select at least one payment method',
      });
    }
    if (pickup.paymentTiming !== 'pay-on-pickup') {
      const online = pickup.paymentProviders.filter((code) => options.onlineProviders.includes(code));
      if (online.length === 0) {
        issues.push({
          path: 'fulfillment.pickup.paymentTiming',
          message: `${pickup.paymentTiming} needs an enabled online payment provider`,
        });
      }
    } else if (!pickup.paymentProviders.includes('cash')) {
      issues.push({
        path: 'fulfillment.pickup.paymentProviders',
        message: 'pay-on-pickup needs the cash provider',
      });
    }
    const hours = pickup.schedule.openingHours;
    if (pickup.enabled && hours.mode === 'daily' && hours.daily.length === 0) {
      issues.push({
        path: 'fulfillment.pickup.schedule.openingHours.daily',
        message: 'add at least one opening range',
      });
    }
  }
  return issues.length > 0 ? { valid: false, issues } : { valid: true, value };
}

/** Lenient read: defaults fill anything missing; malformed stored JSON falls back to defaults. */
export function resolvePickupSettings(raw: unknown): PickupSettings {
  const parsed = pickupSettingsSchema.safeParse(raw ?? {});
  return parsed.success ? parsed.data : pickupSettingsSchema.parse({});
}
