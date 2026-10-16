import { describe, expect, it } from 'vitest';

import { issueView } from './validation-issue';

describe('issueView', () => {
  it('keeps the zod code and numeric bounds next to the message', () => {
    expect(
      issueView({ code: 'too_small', path: ['multiplier'], message: 'Too small', minimum: 10 }, 'tier'),
    ).toEqual({ path: 'multiplier', message: 'Too small', code: 'too_small', min: 10 });
  });
  it('falls back to the given path and a generic code', () => {
    expect(issueView(undefined, 'tier')).toEqual({ path: 'tier', message: 'invalid', code: 'invalid' });
  });
  it('turns bigint bounds into numbers', () => {
    expect(issueView({ code: 'too_big', path: ['x'], message: 'm', maximum: 5n }, 'x')).toMatchObject({ max: 5 });
  });
});
