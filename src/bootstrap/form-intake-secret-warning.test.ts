import { describe, expect, it, vi } from 'vitest';

import { warnIfFormIntakeSecretMissing } from './form-intake-secret-warning';

const strapiWith = () => ({ log: { warn: vi.fn() } }) as never;

describe('warnIfFormIntakeSecretMissing', () => {
  it('warns in production without the secret', () => {
    const strapi = strapiWith();
    expect(warnIfFormIntakeSecretMissing(strapi, { NODE_ENV: 'production' })).toBe(true);
    expect((strapi as { log: { warn: ReturnType<typeof vi.fn> } }).log.warn).toHaveBeenCalledOnce();
  });

  it('stays quiet when the secret is set or outside production', () => {
    const strapi = strapiWith();
    expect(
      warnIfFormIntakeSecretMissing(strapi, { NODE_ENV: 'production', FORM_INTAKE_SHARED_SECRET: 's' }),
    ).toBe(false);
    expect(warnIfFormIntakeSecretMissing(strapi, { NODE_ENV: 'development' })).toBe(false);
  });
});
