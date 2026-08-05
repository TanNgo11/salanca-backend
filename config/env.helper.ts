import type { Core } from '@strapi/strapi';

import {
  emailAddressPattern,
  isValidEmailAddress,
} from '../src/shared/email/email';

export type ConfigEnvironment = Core.Config.Shared.ConfigParams['env'];

export { emailAddressPattern, isValidEmailAddress };

/**
 * Reads a required environment value. The error names the variable and never
 * echoes its value, so a malformed secret cannot leak through a startup error.
 */
export const requireEnvValue = (env: ConfigEnvironment, key: string): string => {
  const value = env(key)?.trim();

  if (!value) {
    throw new Error(`${key} is required.`);
  }

  return value;
};

/**
 * Required env var that must be one email address. Returns the lowercased form
 * so sender identity is stored in a single canonical case.
 */
export const requireEmailAddress = (env: ConfigEnvironment, key: string): string => {
  const value = requireEnvValue(env, key).toLowerCase();

  if (!isValidEmailAddress(value)) {
    throw new Error(`${key} must be a single valid email address.`);
  }

  return value;
};
