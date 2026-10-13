import { z } from '@strapi/utils';

import { OrderingError } from '../errors';

const WEEKDAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const;
const clock = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);

const localizedName = z
  .object({
    vi: z.string().trim().min(1).max(120),
    en: z.string().trim().max(120).optional(),
  })
  .strict();

/**
 * Admin create/update body for a promotion. Codes are a separate resource.
 * `free-delivery` has no `value`. A product or category target needs at least one ref.
 */
export const promotionInputSchema = z
  .object({
    name: localizedName,
    internalNote: z.string().trim().max(2000).nullable().optional(),
    kind: z.enum(['code', 'auto']),
    discountType: z.enum(['percent', 'amount', 'free-delivery', 'delivery-amount']),
    value: z.number().int().positive().nullable().optional(),
    maxDiscount: z.number().int().positive().nullable().optional(),
    target: z
      .object({
        kind: z.enum(['order', 'products', 'categories']),
        refs: z.array(z.string().trim().min(1).max(120)).max(200).default([]),
      })
      .strict(),
    minSubtotal: z.number().int().min(0).default(0),
    locationRefs: z.array(z.string().trim().min(1).max(64)).max(50).nullable().optional(),
    receiveKinds: z.array(z.enum(['pickup', 'delivery', 'digital'])).min(1).max(3),
    startsAt: z.string().datetime(),
    endsAt: z.string().datetime().nullable().optional(),
    weekdays: z.array(z.enum(WEEKDAYS)).max(7).default([]),
    timeRanges: z
      .array(z.object({ start: clock, end: clock }).strict())
      .max(8)
      .default([]),
    firstOrderOnly: z.boolean().default(false),
    usageLimit: z.number().int().positive().nullable().optional(),
    perCustomerLimit: z.number().int().positive().nullable().optional(),
    stackable: z.boolean().default(false),
    priority: z.number().int().min(0).max(1000).default(0),
    active: z.boolean().default(true),
  })
  .strict();

export type PromotionInput = z.infer<typeof promotionInputSchema>;

const fail = (path: string, message: string): never => {
  throw new OrderingError('VALIDATION_ERROR', 'promotion is invalid', {
    details: { issues: [{ path, message }] },
  });
};

export const parsePromotionInput = (raw: unknown): PromotionInput => {
  const parsed = promotionInputSchema.safeParse(raw);
  if (!parsed.success || parsed.data === undefined) {
    const issue = parsed.success ? undefined : parsed.error.issues[0];
    throw new OrderingError('VALIDATION_ERROR', 'promotion is invalid', {
      details: { issues: [{ path: issue?.path.join('.') || 'promotion', message: issue?.message ?? 'invalid' }] },
    });
  }
  const input = parsed.data;
  if (input.endsAt && Date.parse(input.endsAt) <= Date.parse(input.startsAt)) {
    fail('endsAt', 'endsAt must be after startsAt');
  }
  for (const range of input.timeRanges) {
    if (range.start === range.end) fail('timeRanges', 'a time range must not be empty');
  }
  if (input.target.kind === 'order' && input.target.refs.length > 0) {
    fail('target.refs', 'an order target has no refs');
  }
  if (input.target.kind !== 'order' && input.target.refs.length === 0) {
    fail('target.refs', 'choose at least one product or category');
  }
  if (new Set(input.target.refs).size !== input.target.refs.length) {
    fail('target.refs', 'refs must be unique');
  }
  if (new Set(input.weekdays).size !== input.weekdays.length) {
    fail('weekdays', 'weekdays must be unique');
  }
  if (new Set(input.receiveKinds).size !== input.receiveKinds.length) {
    fail('receiveKinds', 'receive kinds must be unique');
  }
  if (input.discountType === 'free-delivery') {
    if (input.value != null) fail('value', 'free delivery has no value');
    if (input.maxDiscount != null) fail('maxDiscount', 'free delivery has no cap');
  } else if (input.value == null) {
    fail('value', 'value is required');
  } else if (input.discountType === 'percent' && input.value > 100) {
    fail('value', 'percent must be from 1 to 100');
  } else if (input.discountType !== 'percent' && input.maxDiscount != null) {
    fail('maxDiscount', 'only a percent discount has a cap');
  }
  return input;
};
