import type { JsonObject } from './common';

/**
 * Notification providers are keyed by a free-form channel string (contracts §14). The
 * recipient resolver and the template renderer live in core; the provider only sends.
 * `data` carries the rendered copy plus O13 channel extras (`trackingId`, `znsTemplateId`,
 * `znsParams`, `smsText`) — providers read what their channel needs.
 */
export type NotificationSendResult = {
  /** Provider-side message id (Zalo `msg_id`, eSMS `SMSID`) for the delivery log. */
  providerMessageId?: string;
};

export interface NotificationProvider {
  send(input: {
    recipient: JsonObject;
    template: string;
    data: JsonObject;
  }): Promise<NotificationSendResult | void>;
}
