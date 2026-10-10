import { spikeWebhookController } from '../api/spike-webhook';

export default {
  spike: ({ strapi }: { strapi: Parameters<typeof spikeWebhookController>[1] }) => ({
    webhook: (ctx: Parameters<typeof spikeWebhookController>[0]) => spikeWebhookController(ctx, strapi),
  }),
};
