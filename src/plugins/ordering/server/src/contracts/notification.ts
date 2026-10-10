import type { JsonObject } from './common';

/**
 * Notification providers are keyed by a free-form channel string (contracts doc §14). The
 * recipient resolver and the template renderer live in core; the provider only sends.
 */
export interface NotificationProvider {
  send(input: { recipient: JsonObject; template: string; data: JsonObject }): Promise<void>;
}
