import { describe, expect, it } from 'vitest';

import { browserOffsetLabel, offsetLabel } from './zone';

describe('offsetLabel', () => {
  it.each([
    [420, 'GMT+07:00'],
    [0, 'GMT+00:00'],
    [-300, 'GMT-05:00'],
    [330, 'GMT+05:30'],
    [-210, 'GMT-03:30'],
  ])('%i minutes east is %s', (minutes, label) => {
    expect(offsetLabel(minutes)).toBe(label);
  });
});

describe('browserOffsetLabel', () => {
  it('reads the offset of the given date in the runtime zone', () => {
    const date = new Date('2026-10-17T00:00:00Z');
    expect(browserOffsetLabel(date)).toBe(offsetLabel(-date.getTimezoneOffset()));
  });
});
