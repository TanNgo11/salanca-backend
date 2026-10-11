import { describe, expect, it } from 'vitest';

import { resolvePickupSettings, validateBranchInput } from './branch-settings';

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
        businessDayPolicy: { cutoffLocalTime: '04:00', holidayDates: [] },
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

  it('requires code and name on create and a real timezone', () => {
    const result = validateBranchInput({ timezone: 'Mars/Olympus' }, { ...options, mode: 'create' });
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.issues.map((issue) => issue.path).sort()).toEqual(['code', 'name', 'timezone']);
    }
  });
});
