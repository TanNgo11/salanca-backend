import { describe, expect, it } from 'vitest';

import { SKIP_REASON, SKIP_REASONS, skipReasonLabel } from './skip-reasons';

describe('skip reasons', () => {
  it('labels every code a sender can write', () => {
    for (const code of Object.values(SKIP_REASON)) {
      expect(SKIP_REASONS[code], `missing label for ${code}`).toBeDefined();
      expect(SKIP_REASONS[code][0]).not.toBe('');
      expect(SKIP_REASONS[code][1]).not.toBe('');
    }
    expect(Object.keys(SKIP_REASONS).sort()).toEqual(Object.values(SKIP_REASON).sort());
  });

  it('returns VI by default and EN when asked', () => {
    expect(skipReasonLabel(SKIP_REASON.emailDisabled)).toBe('Email chưa bật (chưa cấu hình SMTP)');
    expect(skipReasonLabel(SKIP_REASON.emailDisabled, 'en')).toBe('Email is off (SMTP not configured)');
    expect(skipReasonLabel(SKIP_REASON.notAllowlisted, 'en-US')).toContain('allowlist');
  });

  it('returns null for an unknown or missing code', () => {
    expect(skipReasonLabel('mystery')).toBeNull();
    expect(skipReasonLabel(null)).toBeNull();
    expect(skipReasonLabel(undefined)).toBeNull();
  });
});
