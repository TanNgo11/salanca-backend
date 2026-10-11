import type { Core } from '@strapi/strapi';

import type { NotificationProvider } from '../contracts';

type EmailService = {
  send(options: { to: string; subject: string; text: string; html: string }): Promise<unknown>;
};

/**
 * Email through the app's Strapi email plugin (contracts §14: "SMTP hiện có của app"). The plugin
 * never imports app code and never logs the address. `data` is the rendered template.
 */
export const createEmailNotificationProvider = (strapi: Core.Strapi): NotificationProvider => ({
  async send({ recipient, data }) {
    const service = strapi.plugin('email')?.service('email') as EmailService | undefined;
    if (!service || typeof service.send !== 'function') {
      throw new Error('email plugin is not available');
    }
    await service.send({
      to: String(recipient.email),
      subject: String(data.subject),
      text: String(data.text),
      html: String(data.html),
    });
  },
});

export type CapturedEmail = { to: string; template: string; subject: string; text: string };

/** In-memory capture for integration tests (`testing.builtins`); never sends anything. */
export const createCaptureNotificationProvider = (): NotificationProvider & {
  sent: CapturedEmail[];
  failNext: number;
} => {
  const provider = {
    sent: [] as CapturedEmail[],
    failNext: 0,
    async send({ recipient, template, data }: Parameters<NotificationProvider['send']>[0]) {
      if (provider.failNext > 0) {
        provider.failNext -= 1;
        throw new Error('capture provider: injected failure');
      }
      provider.sent.push({
        to: String(recipient.email),
        template,
        subject: String(data.subject),
        text: String(data.text),
      });
    },
  };
  return provider;
};
