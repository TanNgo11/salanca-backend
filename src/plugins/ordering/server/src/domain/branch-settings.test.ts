import { describe, expect, it } from 'vitest';

import { resolveDeliverySettings, resolvePickupSettings, validateBranchInput } from './branch-settings';

const options = { mode: 'update' as const, knownProviders: ['cash'], onlineProviders: [] };

describe('resolvePickupSettings', () => {
  it('fills every default for an empty or partial row', () => {
    const settings = resolvePickupSettings({ enabled: true, paymentTiming: 'pay-on-pickup' });
    expect(settings).toMatchObject({
      enabled: true,
      orderTiming: 'both',
      paymentProviders: ['cash'],
      minOrderAmount: 0,
      customerCancelBeforeMinutes: 30,
      slaMinutes: 10,
      schedule: {
        leadTimeMinutes: 180,
        slotLengthMinutes: 15,
        capacity: 8,
        maxAdvanceDays: 7,
        businessDayPolicy: { cutoffLocalTime: '04:00', holidayDates: [], specialHours: [] },
        openingHours: { mode: 'daily', daily: [{ start: '07:00', end: '22:00' }] },
      },
    });
    expect(settings.schedule.openingHours.weekly.mon).toEqual([]);
  });

  it('falls back to defaults for malformed stored JSON', () => {
    expect(resolvePickupSettings({ schedule: { leadTimeMinutes: -5 } }).schedule.leadTimeMinutes).toBe(180);
    expect(resolvePickupSettings(null).enabled).toBe(false);
  });
});

describe('validateBranchInput', () => {
  it('accepts a past-midnight opening range', () => {
    const result = validateBranchInput(
      {
        fulfillment: {
          pickup: {
            enabled: true,
            schedule: { openingHours: { mode: 'daily', daily: [{ start: '22:00', end: '02:00' }] } },
          },
        },
      },
      options,
    );
    expect(result.valid).toBe(true);
  });

  it('reports field paths for negative lead time and zero-length ranges', () => {
    const result = validateBranchInput(
      {
        fulfillment: {
          pickup: {
            schedule: {
              leadTimeMinutes: -1,
              openingHours: { mode: 'daily', daily: [{ start: '08:00', end: '08:00' }] },
            },
          },
        },
      },
      options,
    );
    expect(result.valid).toBe(false);
    if (!result.valid) {
      const paths = result.issues.map((issue) => issue.path);
      expect(paths).toContain('fulfillment.pickup.schedule.leadTimeMinutes');
      expect(paths).toContain('fulfillment.pickup.schedule.openingHours.daily.0');
    }
  });

  it('rejects unknown providers and online timings without an online provider', () => {
    const unknown = validateBranchInput(
      { fulfillment: { pickup: { paymentProviders: ['sepay'] } } },
      options,
    );
    expect(unknown.valid).toBe(false);
    if (!unknown.valid) {
      expect(unknown.issues.map((issue) => issue.path)).toContain('fulfillment.pickup.paymentProviders.0');
    }
    const prepay = validateBranchInput(
      { fulfillment: { pickup: { paymentTiming: 'prepay' } } },
      options,
    );
    expect(prepay.valid).toBe(false);
    if (!prepay.valid) {
      expect(prepay.issues[0].path).toBe('fulfillment.pickup.paymentTiming');
    }
    const withOnline = validateBranchInput(
      { fulfillment: { pickup: { paymentTiming: 'prepay', paymentProviders: ['cash', 'sepay'] } } },
      { ...options, knownProviders: ['cash', 'sepay'], onlineProviders: ['sepay'] },
    );
    expect(withOnline.valid).toBe(true);
  });

  it('rejects duplicate zone codes, unknown communes, and delivery without a catalog', () => {
    const zone = {
      code: 'near',
      label: 'Gần',
      priority: 10,
      match: { kind: 'commune' as const, communeCodes: ['XT01001'] },
      rules: [{ when: 'any' as const, fee: 0 }],
    };
    const known = { ...options, catalogAvailable: true, knownCommuneCodes: new Set(['XT01001']) };
    const duplicate = validateBranchInput(
      { fulfillment: { delivery: { enabled: true, zones: [zone, { ...zone }] } } },
      known,
    );
    expect(duplicate.valid).toBe(false);
    if (!duplicate.valid) {
      expect(duplicate.issues.some((issue) => issue.path === 'fulfillment.delivery.zones.1.code')).toBe(true);
    }
    const unknown = validateBranchInput(
      {
        fulfillment: {
          delivery: { zones: [{ ...zone, match: { kind: 'commune' as const, communeCodes: ['NOPE'] } }] },
        },
      },
      known,
    );
    expect(unknown.valid).toBe(false);
    if (!unknown.valid) {
      expect(unknown.issues[0]?.path).toBe('fulfillment.delivery.zones.0.match.communeCodes.0');
    }
    const missing = validateBranchInput(
      { fulfillment: { delivery: { enabled: true, zones: [] } } },
      { ...options, catalogAvailable: false },
    );
    expect(missing.valid).toBe(false);
    if (!missing.valid) {
      expect(missing.issues.map((issue) => issue.path)).toContain('fulfillment.delivery.zones');
    }
    expect(resolveDeliverySettings(undefined).zones).toEqual([]);
  });

  it('rejects a duplicated special date, overlapping ranges, and a closed day that still has ranges', () => {
    const duplicated = validateBranchInput(
      {
        fulfillment: {
          pickup: {
            schedule: {
              businessDayPolicy: {
                specialHours: [
                  { date: '2026-02-17', closed: false, ranges: [{ start: '10:00', end: '14:00' }] },
                  { date: '2026-02-17', closed: true, ranges: [] },
                ],
              },
            },
          },
        },
      },
      options,
    );
    expect(duplicated.valid).toBe(false);
    if (!duplicated.valid) {
      expect(duplicated.issues).toContainEqual({
        path: 'fulfillment.pickup.schedule.businessDayPolicy.specialHours.1.date',
        message: 'duplicate special date',
        code: 'duplicate_date',
      });
    }

    const overlapping = validateBranchInput(
      {
        fulfillment: {
          pickup: {
            schedule: {
              businessDayPolicy: {
                specialHours: [
                  {
                    date: '2026-02-17',
                    ranges: [
                      { start: '10:00', end: '14:00' },
                      { start: '13:00', end: '16:00' },
                    ],
                  },
                ],
              },
            },
          },
        },
      },
      options,
    );
    expect(overlapping.valid).toBe(false);
    if (!overlapping.valid) {
      expect(overlapping.issues.some((issue) => issue.message === 'ranges overlap' && issue.code === 'ranges_overlap')).toBe(true);
    }

    const closedWithRanges = validateBranchInput(
      {
        fulfillment: {
          pickup: {
            schedule: {
              businessDayPolicy: {
                specialHours: [
                  { date: '2026-02-17', closed: true, ranges: [{ start: '10:00', end: '14:00' }] },
                ],
              },
            },
          },
        },
      },
      options,
    );
    expect(closedWithRanges.valid).toBe(false);
  });

  it('requires code and name on create and a real timezone', () => {
    const result = validateBranchInput({ timezone: 'Mars/Olympus' }, { ...options, mode: 'create' });
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.issues.map((issue) => issue.path).sort()).toEqual(['code', 'name', 'timezone']);
    }
  });

  it('gives each rule a code the Admin can translate', () => {
    const codes = (raw: unknown, opts: Parameters<typeof validateBranchInput>[1] = options) => {
      const result = validateBranchInput(raw, opts);
      return result.valid ? [] : result.issues.map((issue) => `${issue.path}=${issue.code}`);
    };
    const create = { ...options, mode: 'create' as const };
    expect(codes({ timezone: 'Mars/Olympus' }, create).sort()).toEqual(['code=required', 'name=required', 'timezone=invalid_timezone']);
    // the branch code allows capitals, so it must not borrow the loyalty-tier "lowercase only" text
    expect(codes({ code: 'bad code!', name: { vi: 'x' } }, create)).toContain('code=branch_code_format');
    expect(codes({ name: { vi: ' ' } })).toContain('name=locale_required');
    expect(codes({ fulfillment: { pickup: { paymentProviders: ['sepay'] } } })).toContain('fulfillment.pickup.paymentProviders.0=provider_disabled');
    expect(codes({ fulfillment: { pickup: { enabled: true, paymentProviders: [] } } })).toContain('fulfillment.pickup.paymentProviders=payment_required');
    expect(codes({ fulfillment: { pickup: { paymentTiming: 'prepay' } } })).toContain('fulfillment.pickup.paymentTiming=online_provider_required');
    expect(codes({ fulfillment: { pickup: { paymentProviders: ['sepay'], paymentTiming: 'pay-on-pickup' } } }, { ...options, knownProviders: ['cash', 'sepay'] })).toContain('fulfillment.pickup.paymentProviders=cash_required');
    expect(codes({ fulfillment: { delivery: { enabled: true, zones: [] } } }, { ...options, catalogAvailable: false })).toContain('fulfillment.delivery.zones=catalog_not_loaded');
    const fee = { code: 'svc', label: { vi: 'Phí' }, kind: 'service' as const, amount: 1000, receiveKinds: ['pickup' as const] };
    expect(codes({ fees: [fee, { ...fee }] })).toContain('fees=not_unique');
    expect(codes({ fees: [{ ...fee, percent: 5 }] })).toContain('fees.0=amount_or_percent');
    expect(codes({ fulfillment: { pickup: { schedule: { leadTimeMinutes: -1 } } } })).toContain('fulfillment.pickup.schedule.leadTimeMinutes=too_small');
  });
});
