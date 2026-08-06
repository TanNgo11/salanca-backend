/**
 * Resend SMTP transport config for Strapi Email plugin (BDS pattern).
 *
 * Deliberate surface area: BDS parity for production host allowlist, local
 * capture hosts, and fail-closed startup validation — not a thin Resend HTTP
 * client. Keep until a second mail caller needs a different transport.
 *
 * Opt-in for Salanca: only resolve when EMAIL_SMTP_HOST is set (see plugins.ts).
 * Production accepts only smtp.resend.com; local capture (Mailpit) uses localhost.
 * No automatic provider fallback — silent failover hides delivery failures.
 * Form lead notify also requires FORM_NOTIFY_TO (dual gate in form-lead-notify).
 */

import {
  requireEmailAddress,
  requireEnvValue,
  type ConfigEnvironment,
} from './env.helper';

type Environment = ConfigEnvironment;

export enum TransactionalEmailProvider {
  Nodemailer = 'nodemailer',
}

/** Resend's documented SMTP host. Production may use no other host. */
const resendRelayHosts = ['smtp.resend.com'];

/** Fixed SMTP username required by Resend (password is the API key). */
const resendSmtpUser = 'resend';

/** Hosts that can only reach a developer's local mail-capture service. */
const captureHosts = ['localhost', '127.0.0.1', '::1'];

/** STARTTLS ports documented by Resend (587 primary, 2587 fallback). */
const startTlsPorts = [587, 2587];
const implicitTlsPort = 465;
const approvedPorts = [...startTlsPorts, implicitTlsPort];

interface TransactionalEmailAuth {
  user: string;
  pass: string;
}

export interface TransactionalEmailConfig {
  provider: TransactionalEmailProvider;
  providerOptions: {
    host: string;
    port: number;
    secure: boolean;
    requireTLS: boolean;
    auth?: TransactionalEmailAuth;
    connectionTimeout: number;
    greetingTimeout: number;
    socketTimeout: number;
  };
  settings: {
    defaultFrom: string;
    defaultReplyTo: string;
  };
}

const isCaptureHost = (host: string): boolean => captureHosts.includes(host);

/**
 * True when the operator opted into SMTP (host present after trim).
 * Form lead notify also requires FORM_NOTIFY_TO — see form-lead-notify.
 */
export const isTransactionalEmailConfigured = (
  env: Environment,
): boolean => Boolean(env('EMAIL_SMTP_HOST')?.trim());

const resolveProvider = (env: Environment): TransactionalEmailProvider => {
  const value = env('EMAIL_PROVIDER', TransactionalEmailProvider.Nodemailer);

  if (value !== TransactionalEmailProvider.Nodemailer) {
    throw new Error(
      `EMAIL_PROVIDER must be ${TransactionalEmailProvider.Nodemailer}. ` +
        'Automatic provider fallback is not supported: it makes delivery, sender identity, ' +
        'suppression, quota, and incident diagnosis unreliable.',
    );
  }

  return TransactionalEmailProvider.Nodemailer;
};

const resolveHost = (env: Environment, isProduction: boolean): string => {
  const host = requireEnvValue(env, 'EMAIL_SMTP_HOST').toLowerCase();

  if (isProduction) {
    if (!resendRelayHosts.includes(host)) {
      throw new Error(
        `EMAIL_SMTP_HOST must be an approved Resend relay host: ${resendRelayHosts.join(', ')}.`,
      );
    }

    return host;
  }

  if (!isCaptureHost(host) && !env.bool('EMAIL_ALLOW_EXTERNAL_DELIVERY', false)) {
    throw new Error(
      'Outside production, EMAIL_SMTP_HOST must be a local mail-capture host unless ' +
        'EMAIL_ALLOW_EXTERNAL_DELIVERY is explicitly true.',
    );
  }

  return host;
};

const resolvePort = (env: Environment, isProduction: boolean, host: string): number => {
  const port = Number(requireEnvValue(env, 'EMAIL_SMTP_PORT'));

  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error('EMAIL_SMTP_PORT must be an integer TCP port.');
  }

  if ((isProduction || !isCaptureHost(host)) && !approvedPorts.includes(port)) {
    throw new Error(`EMAIL_SMTP_PORT must be one of: ${approvedPorts.join(', ')}.`);
  }

  return port;
};

/**
 * TLS policy is host-class aware:
 * - Capture/loopback: plaintext SMTP is allowed (Mailpit and friends).
 * - Resend / external: STARTTLS or implicit TLS is mandatory.
 */
const resolveTlsMode = (
  env: Environment,
  port: number,
  host: string,
): { secure: boolean; requireTLS: boolean } => {
  const capture = isCaptureHost(host);
  const secure = env.bool('EMAIL_SMTP_SECURE', false);
  // Capture defaults to no TLS; everything else defaults to STARTTLS required.
  const requireTLS = env.bool('EMAIL_SMTP_REQUIRE_TLS', !capture);

  if (capture) {
    if (secure && port !== implicitTlsPort) {
      throw new Error(
        'EMAIL_SMTP_SECURE must be true only on port 465 and false on local capture ports.',
      );
    }

    return { secure, requireTLS };
  }

  if (secure !== (port === implicitTlsPort)) {
    throw new Error(
      'EMAIL_SMTP_SECURE must be true only on port 465 and false on the STARTTLS ports 587 and 2587.',
    );
  }

  if (!secure && !requireTLS) {
    throw new Error('EMAIL_SMTP_REQUIRE_TLS must be true when EMAIL_SMTP_SECURE is false.');
  }

  return { secure, requireTLS };
};

/**
 * Production always authenticates. A local capture service usually accepts
 * anonymous SMTP, so both credentials may be omitted together — but never one
 * without the other.
 *
 * Resend SMTP requires username `resend` and an API key as the password.
 */
const resolveAuth = (
  env: Environment,
  isProduction: boolean,
  host: string,
): TransactionalEmailAuth | null => {
  const user = env('EMAIL_SMTP_USER')?.trim();
  const pass = env('EMAIL_SMTP_KEY')?.trim();

  if (!isProduction && !user && !pass) {
    return null;
  }

  const resolved: TransactionalEmailAuth = {
    user: requireEnvValue(env, 'EMAIL_SMTP_USER'),
    pass: requireEnvValue(env, 'EMAIL_SMTP_KEY'),
  };

  const isResendHost = resendRelayHosts.includes(host.toLowerCase());
  if ((isProduction || isResendHost) && resolved.user.toLowerCase() !== resendSmtpUser) {
    throw new Error(
      `EMAIL_SMTP_USER must be "${resendSmtpUser}" when using the Resend SMTP relay ` +
        '(the password is your Resend API key).',
    );
  }

  return resolved;
};

const resolveSenderSettings = (
  env: Environment,
  isProduction: boolean,
  auth: TransactionalEmailAuth | null,
): TransactionalEmailConfig['settings'] => {
  const fromName = requireEnvValue(env, 'EMAIL_FROM_NAME');
  const fromAddress = requireEmailAddress(env, 'EMAIL_FROM_ADDRESS');
  const replyTo = requireEmailAddress(env, 'EMAIL_REPLY_TO');

  if (auth && fromAddress === auth.user.toLowerCase()) {
    throw new Error('EMAIL_FROM_ADDRESS must not reuse the SMTP login.');
  }

  if (isProduction) {
    const senderDomain = requireEnvValue(env, 'EMAIL_SENDER_DOMAIN').toLowerCase();
    const outsideDomain = [fromAddress, replyTo].filter(
      (address) => !address.endsWith(`@${senderDomain}`),
    );

    if (outsideDomain.length > 0) {
      throw new Error(
        'EMAIL_FROM_ADDRESS and EMAIL_REPLY_TO must belong to EMAIL_SENDER_DOMAIN, the ' +
          'Resend-authenticated sender domain.',
      );
    }
  }

  return {
    defaultFrom: `${fromName} <${fromAddress}>`,
    defaultReplyTo: replyTo,
  };
};

/**
 * Builds the Email plugin configuration. When enabled, every required SMTP
 * setting fails startup instead of silently falling back to local sendmail.
 */
export const resolveTransactionalEmailConfig = (env: Environment): TransactionalEmailConfig => {
  const isProduction = env('NODE_ENV') === 'production';
  const provider = resolveProvider(env);
  const host = resolveHost(env, isProduction);
  const port = resolvePort(env, isProduction, host);
  const { secure, requireTLS } = resolveTlsMode(env, port, host);
  const auth = resolveAuth(env, isProduction, host);
  const settings = resolveSenderSettings(env, isProduction, auth);

  return {
    provider,
    providerOptions: {
      host,
      port,
      secure,
      requireTLS,
      ...(auth ? { auth } : {}),
      connectionTimeout: 10_000,
      greetingTimeout: 10_000,
      socketTimeout: 20_000,
    },
    settings,
  };
};
