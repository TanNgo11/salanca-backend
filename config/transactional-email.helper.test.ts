import type { Core } from '@strapi/strapi';
import { describe, expect, it } from 'vitest';

import {
  isTransactionalEmailConfigured,
  resolveTransactionalEmailConfig,
  TransactionalEmailProvider,
} from './transactional-email.helper';

type EnvironmentValues = Readonly<Record<string, string | boolean | undefined>>;

const createEnv = (values: EnvironmentValues): Core.Config.Shared.ConfigParams['env'] => {
  const env = ((key: string, fallback?: string): string | undefined => {
    const value = values[key];
    return typeof value === 'string' ? value : fallback;
  }) as Core.Config.Shared.ConfigParams['env'];

  env.bool = (key: string, fallback?: boolean): boolean => {
    const value = values[key];
    return typeof value === 'boolean' ? value : (fallback ?? false);
  };

  return env;
};

const productionEnvironment: EnvironmentValues = {
  NODE_ENV: 'production',
  EMAIL_PROVIDER: 'nodemailer',
  EMAIL_SMTP_HOST: 'smtp.resend.com',
  EMAIL_SMTP_PORT: '587',
  EMAIL_SMTP_SECURE: false,
  EMAIL_SMTP_REQUIRE_TLS: true,
  EMAIL_SMTP_USER: 'resend',
  EMAIL_SMTP_KEY: 're_placeholder-api-key',
  EMAIL_FROM_NAME: 'Salanca',
  EMAIL_FROM_ADDRESS: 'no-reply@salanca.example',
  EMAIL_REPLY_TO: 'booking@salanca.example',
  EMAIL_SENDER_DOMAIN: 'salanca.example',
};

const captureEnvironment: EnvironmentValues = {
  NODE_ENV: 'development',
  EMAIL_SMTP_HOST: 'localhost',
  EMAIL_SMTP_PORT: '1025',
  EMAIL_FROM_NAME: 'Salanca',
  EMAIL_FROM_ADDRESS: 'no-reply@salanca.local',
  EMAIL_REPLY_TO: 'booking@salanca.local',
};

describe('isTransactionalEmailConfigured', () => {
  it('is true only when EMAIL_SMTP_HOST is non-empty', () => {
    expect(isTransactionalEmailConfigured(createEnv({}))).toBe(false);
    expect(isTransactionalEmailConfigured(createEnv({ EMAIL_SMTP_HOST: '  ' }))).toBe(false);
    expect(
      isTransactionalEmailConfigured(createEnv({ EMAIL_SMTP_HOST: 'localhost' })),
    ).toBe(true);
  });
});

describe('resolveTransactionalEmailConfig', () => {
  it('builds the Resend STARTTLS profile with bounded timeouts', () => {
    expect(resolveTransactionalEmailConfig(createEnv(productionEnvironment))).toEqual({
      provider: TransactionalEmailProvider.Nodemailer,
      providerOptions: {
        host: 'smtp.resend.com',
        port: 587,
        secure: false,
        requireTLS: true,
        auth: { user: 'resend', pass: 're_placeholder-api-key' },
        connectionTimeout: 10_000,
        greetingTimeout: 10_000,
        socketTimeout: 20_000,
      },
      settings: {
        defaultFrom: 'Salanca <no-reply@salanca.example>',
        defaultReplyTo: 'booking@salanca.example',
      },
    });
  });

  it('accepts the approved 2587 fallback port', () => {
    const config = resolveTransactionalEmailConfig(
      createEnv({ ...productionEnvironment, EMAIL_SMTP_PORT: '2587' }),
    );

    expect(config.providerOptions).toMatchObject({ port: 2587, secure: false, requireTLS: true });
  });

  it('accepts the implicit-TLS 465 profile only when secure is true', () => {
    const config = resolveTransactionalEmailConfig(
      createEnv({ ...productionEnvironment, EMAIL_SMTP_PORT: '465', EMAIL_SMTP_SECURE: true }),
    );

    expect(config.providerOptions).toMatchObject({ port: 465, secure: true });

    expect(() =>
      resolveTransactionalEmailConfig(
        createEnv({ ...productionEnvironment, EMAIL_SMTP_PORT: '465' }),
      ),
    ).toThrow('EMAIL_SMTP_SECURE must be true only on port 465');
  });

  it('rejects a non-Nodemailer provider instead of falling back', () => {
    expect(() =>
      resolveTransactionalEmailConfig(
        createEnv({ ...productionEnvironment, EMAIL_PROVIDER: 'sendmail' }),
      ),
    ).toThrow('EMAIL_PROVIDER must be nodemailer');
  });

  it('rejects a production host that is not an approved Resend relay', () => {
    expect(() =>
      resolveTransactionalEmailConfig(
        createEnv({ ...productionEnvironment, EMAIL_SMTP_HOST: 'smtp.attacker.example' }),
      ),
    ).toThrow('EMAIL_SMTP_HOST must be an approved Resend relay host');
  });

  it('rejects a production SMTP user that is not resend', () => {
    expect(() =>
      resolveTransactionalEmailConfig(
        createEnv({ ...productionEnvironment, EMAIL_SMTP_USER: 'other-user' }),
      ),
    ).toThrow('EMAIL_SMTP_USER must be "resend"');
  });

  it('rejects an unsupported port', () => {
    expect(() =>
      resolveTransactionalEmailConfig(
        createEnv({ ...productionEnvironment, EMAIL_SMTP_PORT: '25' }),
      ),
    ).toThrow('EMAIL_SMTP_PORT must be one of: 587, 2587, 465');
  });

  it('rejects STARTTLS being disabled on an insecure port', () => {
    expect(() =>
      resolveTransactionalEmailConfig(
        createEnv({ ...productionEnvironment, EMAIL_SMTP_REQUIRE_TLS: false }),
      ),
    ).toThrow('EMAIL_SMTP_REQUIRE_TLS must be true');
  });

  it('rejects a production sender outside the authenticated domain', () => {
    expect(() =>
      resolveTransactionalEmailConfig(
        createEnv({ ...productionEnvironment, EMAIL_FROM_ADDRESS: 'no-reply@other.example' }),
      ),
    ).toThrow('must belong to EMAIL_SENDER_DOMAIN');
  });

  it('rejects reusing the SMTP login as the sender address', () => {
    expect(() =>
      resolveTransactionalEmailConfig(
        createEnv({
          ...productionEnvironment,
          EMAIL_SMTP_USER: 'resend',
          EMAIL_FROM_ADDRESS: 'resend',
        }),
      ),
    ).toThrow('EMAIL_FROM_ADDRESS');
  });

  it('never repeats a secret value in a validation error', () => {
    try {
      resolveTransactionalEmailConfig(
        createEnv({ ...productionEnvironment, EMAIL_FROM_ADDRESS: 'not-an-email' }),
      );
      expect.unreachable('expected a validation error');
    } catch (error) {
      expect(String(error)).not.toContain('re_placeholder-api-key');
    }
  });

  it('fails production startup when a required setting is missing', () => {
    expect(() =>
      resolveTransactionalEmailConfig(
        createEnv({ ...productionEnvironment, EMAIL_SMTP_KEY: undefined }),
      ),
    ).toThrow('EMAIL_SMTP_KEY is required');
  });

  it('allows an unauthenticated local capture host outside production', () => {
    const config = resolveTransactionalEmailConfig(createEnv(captureEnvironment));

    expect(config.providerOptions.auth).toBeUndefined();
    expect(config.providerOptions.port).toBe(1025);
    expect(config.providerOptions.requireTLS).toBe(false);
    expect(config.providerOptions.secure).toBe(false);
  });

  it('refuses to send outside a capture host in development without an explicit opt-in', () => {
    expect(() =>
      resolveTransactionalEmailConfig(
        createEnv({
          NODE_ENV: 'development',
          EMAIL_SMTP_HOST: 'smtp.resend.com',
          EMAIL_SMTP_PORT: '587',
          EMAIL_SMTP_USER: 'resend',
          EMAIL_SMTP_KEY: 're_placeholder-api-key',
          EMAIL_FROM_NAME: 'Salanca',
          EMAIL_FROM_ADDRESS: 'no-reply@salanca.example',
          EMAIL_REPLY_TO: 'booking@salanca.example',
        }),
      ),
    ).toThrow('EMAIL_ALLOW_EXTERNAL_DELIVERY');
  });
});
