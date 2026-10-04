import type { Core } from '@strapi/strapi';

/**
 * One-time production warning: without FORM_INTAKE_SHARED_SECRET the web
 * server's IP is the only client IP Strapi sees, so form rate limits collapse
 * into a single site-wide bucket.
 */
export const warnIfFormIntakeSecretMissing = (
  strapi: Pick<Core.Strapi, 'log'>,
  env: NodeJS.ProcessEnv = process.env,
): boolean => {
  if (env.NODE_ENV !== 'production' || env.FORM_INTAKE_SHARED_SECRET?.trim()) {
    return false;
  }
  strapi.log.warn(
    'FORM_INTAKE_SHARED_SECRET is not set: form rate limiting is a single site-wide bucket (all visitors share the web server IP).',
  );
  return true;
};
