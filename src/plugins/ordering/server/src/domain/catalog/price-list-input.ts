import { z } from '@strapi/utils';

import { OrderingError } from '../errors';
import { issueView } from '../validation-issue';
import { PRICE_CHANNELS, PRICE_WEEKDAYS, type CatalogPriceRules } from './price-selection';

const clock = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);

const localizedName = z
  .object({
    vi: z.string().trim().min(1).max(120),
    en: z.string().trim().max(120).optional(),
  })
  .strict();

const rulesSchema = z
  .object({
    channels: z.array(z.enum(PRICE_CHANNELS)).max(4).default([]),
    locationRefs: z.array(z.string().trim().min(1).max(64)).max(50).default([]),
    customerGroups: z.array(z.string().trim().min(1).max(64)).max(30).default([]),
    weekdays: z.array(z.enum(PRICE_WEEKDAYS)).max(7).default([]),
    timeRanges: z.array(z.object({ start: clock, end: clock }).strict()).max(3).default([]),
  })
  .strict();

const lineSchema = z
  .object({
    variantId: z.string().trim().min(1).max(128),
    amount: z.number().int().nonnegative(),
    compareAtAmount: z.number().int().nonnegative().nullable().optional(),
  })
  .strict();

const adjustSchema = z
  .object({
    type: z.enum(['percent', 'amount']),
    value: z.number().int().positive(),
    target: z
      .object({
        kind: z.enum(['all', 'categories', 'products']),
        refs: z.array(z.string().trim().min(1).max(128)).max(200).default([]),
      })
      .strict(),
  })
  .strict();

export const priceListInputSchema = z
  .object({
    name: localizedName,
    kind: z.enum(['override', 'adjust']),
    rules: rulesSchema.default({
      channels: [],
      locationRefs: [],
      customerGroups: [],
      weekdays: [],
      timeRanges: [],
    }),
    adjust: adjustSchema.nullable().optional(),
    lines: z.array(lineSchema).max(200).default([]),
    priority: z.number().int().min(0).max(1000).default(0),
    active: z.boolean().default(true),
    validFrom: z.string().trim().min(1).nullable().optional(),
    validTo: z.string().trim().min(1).nullable().optional(),
  })
  .strict();

export type PriceListInput = z.infer<typeof priceListInputSchema>;

const fail = (path: string, message: string, code: string, bounds: { min?: number; max?: number } = {}): never => {
  throw new OrderingError('PRICE_LIST_INVALID', 'price list is invalid', {
    details: { issues: [{ path, message, code, ...bounds }] },
  });
};

const unique = (values: string[], path: string) => {
  if (new Set(values).size !== values.length) fail(path, 'values must be unique', 'not_unique');
};

/** Parsed admin body. `override` keeps lines and no adjust; `adjust` keeps one discount and no lines. */
export const parsePriceListInput = (raw: unknown): PriceListInput => {
  const parsed = priceListInputSchema.safeParse(raw);
  if (!parsed.success || parsed.data === undefined) {
    const issue = parsed.success ? undefined : parsed.error.issues[0];
    throw new OrderingError('PRICE_LIST_INVALID', 'price list is invalid', {
      details: { issues: [issueView(issue, 'priceList')] },
    });
  }
  const input = parsed.data;
  unique(input.rules.channels, 'rules.channels');
  unique(input.rules.locationRefs, 'rules.locationRefs');
  unique(input.rules.customerGroups, 'rules.customerGroups');
  unique(input.rules.weekdays, 'rules.weekdays');
  for (const range of input.rules.timeRanges) {
    if (range.start === range.end) fail('rules.timeRanges', 'a time range must not be empty', 'empty_range');
  }
  if (input.validFrom && Number.isNaN(Date.parse(input.validFrom))) fail('validFrom', 'invalid date', 'invalid_date');
  if (input.validTo && Number.isNaN(Date.parse(input.validTo))) fail('validTo', 'invalid date', 'invalid_date');
  if (input.validFrom && input.validTo && Date.parse(input.validTo) <= Date.parse(input.validFrom)) {
    fail('validTo', 'validTo must be after validFrom', 'range_order');
  }
  if (input.kind === 'override') {
    if (input.lines.length === 0) fail('lines', 'choose at least one variant', 'no_variant');
    unique(input.lines.map((line) => line.variantId), 'lines');
    const combinations =
      Math.max(1, input.rules.channels.length) *
      Math.max(1, input.rules.locationRefs.length) *
      Math.max(1, input.rules.customerGroups.length) *
      input.lines.length;
    if (combinations > 2000) fail('lines', 'too many price rows; narrow the conditions', 'too_many_rows');
    if (input.adjust) fail('adjust', 'an override list has no adjust', 'adjust_mismatch');
  } else {
    if (!input.adjust) fail('adjust', 'an adjust list needs a discount', 'adjust_mismatch');
    const adjust = input.adjust as NonNullable<PriceListInput['adjust']>;
    if (adjust.type === 'percent' && adjust.value > 100) {
      fail('adjust.value', 'percent must be from 1 to 100', 'too_big', { max: 100 });
    }
    if (adjust.target.kind !== 'all' && adjust.target.refs.length === 0) {
      fail('adjust.target.refs', 'choose at least one category or product', 'no_target');
    }
    if (adjust.target.kind === 'all' && adjust.target.refs.length > 0) {
      fail('adjust.target.refs', 'an all-items discount has no refs', 'refs_not_allowed');
    }
    unique(adjust.target.refs, 'adjust.target.refs');
    if (input.lines.length > 0) fail('lines', 'an adjust list has no variant prices', 'lines_not_allowed');
  }
  return input;
};

export const rulesOf = (input: PriceListInput): CatalogPriceRules => ({
  channels: input.rules.channels,
  locationRefs: input.rules.locationRefs,
  customerGroups: input.rules.customerGroups,
  weekdays: input.rules.weekdays,
  timeRanges: input.rules.timeRanges,
});

const autoSchema = z
  .object({
    minTotalSpent: z.number().int().nonnegative().optional(),
    minOrderCount: z.number().int().nonnegative().optional(),
    sinceDays: z.number().int().min(1).max(3650).optional(),
  })
  .strict();

export const customerGroupInputSchema = z
  .object({
    code: z
      .string()
      .trim()
      .min(1)
      .max(64)
      .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
    name: localizedName,
    auto: autoSchema.nullable().optional(),
    active: z.boolean().default(true),
  })
  .strict();

export type CustomerGroupInput = z.infer<typeof customerGroupInputSchema>;

export const parseCustomerGroupInput = (raw: unknown, opts: { codeFrozen?: boolean } = {}): CustomerGroupInput => {
  const parsed = customerGroupInputSchema.safeParse(raw);
  if (!parsed.success || parsed.data === undefined) {
    const issue = parsed.success ? undefined : parsed.error.issues[0];
    throw new OrderingError('VALIDATION_ERROR', 'customer group is invalid', {
      details: { issues: [issueView(issue, 'customerGroup')] },
    });
  }
  const input = parsed.data;
  if (opts.codeFrozen) {
    // Code is checked by the caller against the stored row; the field may be repeated.
  }
  if (input.auto && input.auto.minTotalSpent === undefined && input.auto.minOrderCount === undefined && input.auto.sinceDays === undefined) {
    failGroup('auto', 'an automatic group needs a condition', 'no_condition');
  }
  return input;
};

const failGroup = (path: string, message: string, code: string): never => {
  throw new OrderingError('VALIDATION_ERROR', 'customer group is invalid', {
    details: { issues: [{ path, message, code }] },
  });
};

export const membersInputSchema = z
  .object({
    add: z.array(z.string().trim().min(1).max(128)).max(100).default([]),
    remove: z.array(z.string().trim().min(1).max(128)).max(100).default([]),
  })
  .strict();

export const parseMembersInput = (raw: unknown): { add: string[]; remove: string[] } => {
  const parsed = membersInputSchema.safeParse(raw);
  if (!parsed.success || parsed.data === undefined) {
    throw new OrderingError('VALIDATION_ERROR', 'members are invalid', {
      details: { issues: [{ path: 'members', message: 'invalid' }] },
    });
  }
  return parsed.data;
};
