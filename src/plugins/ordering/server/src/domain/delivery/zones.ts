import { z } from '@strapi/utils';

/**
 * Delivery zones and fee rules (contracts §19.8; TastyIgniter CoveredArea). Zones with a
 * higher `priority` are examined first. Inside a zone the first matching rule wins.
 * `fee: 'unavailable'` means the branch does not deliver that order. A later, cheaper
 * rule never overrides an earlier match.
 */

export const FEE_WHENS = ['any', 'subtotal-gte', 'subtotal-lt'] as const;

const communeCode = z
  .string()
  .trim()
  .regex(/^[0-9A-Za-z]{1,16}$/, 'commune code must be 1–16 letters or digits')
  .transform((value) => value.toUpperCase());

export const deliveryRuleSchema = z
  .object({
    when: z.enum(FEE_WHENS),
    subtotal: z.number().int().min(0).max(1_000_000_000).optional(),
    fee: z.union([z.number().int().min(0).max(1_000_000_000), z.literal('unavailable')]),
  })
  .superRefine((rule, ctx) => {
    if (rule.when !== 'any' && rule.subtotal === undefined) {
      ctx.addIssue({ code: 'custom', message: 'subtotal is required unless the rule is "any"', path: ['subtotal'] });
    }
  });

export const deliveryZoneSchema = z.object({
  code: z.string().regex(/^[a-z0-9][a-z0-9-]{0,31}$/, 'zone code must be a short slug'),
  label: z.string().trim().min(1).max(80),
  priority: z.number().int().min(0).max(10_000),
  match: z.object({
    kind: z.literal('commune'),
    communeCodes: z.array(communeCode).min(1).max(2_000),
  }),
  rules: z.array(deliveryRuleSchema).min(1).max(20),
  minOrderAmount: z.number().int().min(0).max(1_000_000_000).default(0),
  extraLeadTimeMinutes: z.number().int().min(0).max(1_440).default(0),
});

export const deliveryZoneListSchema = z.array(deliveryZoneSchema).max(50).superRefine((zones, ctx) => {
  const seen = new Set<string>();
  for (const [index, zone] of zones.entries()) {
    if (seen.has(zone.code)) {
      ctx.addIssue({ code: 'custom', message: `duplicate zone code ${zone.code}`, path: [index, 'code'] });
    }
    seen.add(zone.code);
  }
});

export type DeliveryRule = z.infer<typeof deliveryRuleSchema>;
export type DeliveryZone = z.infer<typeof deliveryZoneSchema>;

export type ZoneQuote =
  | {
      available: true;
      zoneCode: string;
      fee: number;
      extraLeadTimeMinutes: number;
      /** Smallest subtotal above the current one where this zone's fee becomes 0. */
      freeFrom: number | null;
    }
  | {
      available: false;
      reason: 'outside' | 'unavailable' | 'below-minimum';
      zoneCode?: string;
      minOrderAmount?: number;
    };

const ruleMatches = (rule: DeliveryRule, subtotal: number): boolean => {
  if (rule.when === 'any') return true;
  const threshold = rule.subtotal ?? 0;
  if (rule.when === 'subtotal-gte') return subtotal >= threshold;
  return subtotal < threshold;
};

/** Higher priority first. Equal priority keeps the earlier array entry. */
export function zonesByPriority(zones: DeliveryZone[]): DeliveryZone[] {
  return zones
    .map((zone, index) => ({ zone, index }))
    .sort((a, b) => b.zone.priority - a.zone.priority || a.index - b.index)
    .map((entry) => entry.zone);
}

const applyRules = (
  zone: DeliveryZone,
  subtotal: number,
): { fee: number } | { blocked: 'unavailable' | 'below-minimum' } => {
  if (zone.minOrderAmount > 0 && subtotal < zone.minOrderAmount) return { blocked: 'below-minimum' };
  const rule = zone.rules.find((candidate) => ruleMatches(candidate, subtotal));
  if (!rule || rule.fee === 'unavailable') return { blocked: 'unavailable' };
  return { fee: rule.fee };
};

/** The next subtotal where the same first-match rules yield a free delivery. */
export function freeDeliveryFrom(zone: DeliveryZone, subtotal: number): number | null {
  const points = new Set<number>();
  if (zone.minOrderAmount > 0) points.add(zone.minOrderAmount);
  for (const rule of zone.rules) {
    if (rule.subtotal !== undefined) points.add(rule.subtotal);
  }
  const sorted = [...points].filter((point) => point > subtotal).sort((a, b) => a - b);
  for (const point of sorted) {
    const applied = applyRules(zone, point);
    if ('fee' in applied && applied.fee === 0) return point;
  }
  return null;
}

/** Admin preview. `zones` quotes a draft; omit it to quote the saved branch. */
export const deliveryQuoteInputSchema = z.object({
  communeCode: z.string().trim().min(1).max(16),
  subtotal: z.number().int().min(0).max(1_000_000_000),
  zones: deliveryZoneListSchema.optional(),
});

/**
 * Quotes one commune against the branch zones. `outside` is no matching zone.
 * `below-minimum` and `unavailable` are both "we do not deliver this order".
 */
export function quoteDelivery(
  zones: DeliveryZone[],
  input: { communeCode: string; subtotal: number },
): ZoneQuote {
  const communeCode = input.communeCode.trim().toUpperCase();
  const zone = zonesByPriority(zones).find((candidate) =>
    candidate.match.communeCodes.includes(communeCode),
  );
  if (!zone) return { available: false, reason: 'outside' };
  const applied = applyRules(zone, input.subtotal);
  if ('blocked' in applied) {
    return {
      available: false,
      reason: applied.blocked,
      zoneCode: zone.code,
      ...(applied.blocked === 'below-minimum' ? { minOrderAmount: zone.minOrderAmount } : {}),
    };
  }
  return {
    available: true,
    zoneCode: zone.code,
    fee: applied.fee,
    extraLeadTimeMinutes: zone.extraLeadTimeMinutes,
    freeFrom: applied.fee === 0 ? null : freeDeliveryFrom(zone, input.subtotal),
  };
}
