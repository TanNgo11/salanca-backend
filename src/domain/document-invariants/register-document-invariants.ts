import type { Core } from '@strapi/strapi';

import { emitCmsWebhook } from '../cms-webhook/emit-cms-webhook';
import { registerDocumentMiddleware } from '../document-middleware/register-document-middleware';
import { enforceCampaignInvariants } from './enforce-campaign-invariants';
import { enforceContentBoundaries } from './enforce-content-boundaries';
import { enforceMenuInvariants } from './enforce-menu-invariants';

/**
 * Single Document Service middleware: menu, campaign, content boundaries (before),
 * and CMS webhooks (after). Add handlers here — do not register extra `documents.use` stacks.
 */
export const registerDocumentInvariants = (strapi: Core.Strapi): void => {
  registerDocumentMiddleware(strapi, {
    before: [
      enforceMenuInvariants,
      enforceCampaignInvariants,
      enforceContentBoundaries,
    ],
    after: [emitCmsWebhook],
  });
};
