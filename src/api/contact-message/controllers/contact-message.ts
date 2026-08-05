import type { Core } from '@strapi/strapi';
import { factories } from '@strapi/strapi';
import { errors } from '@strapi/utils';

import { parseContactMessageInput } from '../../../domain/contact-message/contact-message.validation';
import { FormValidationError } from '../../../domain/form-intake/form-validation-error';

const { ApplicationError } = errors;

const UID = 'api::contact-message.contact-message' as const;

export default factories.createCoreController(UID, ({ strapi }: { strapi: Core.Strapi }) => ({
  /**
   * Public contact form intake: validate, force status new, return minimal payload.
   */
  async create(ctx) {
    let data;
    try {
      data = parseContactMessageInput(ctx.request.body?.data);
    } catch (error) {
      if (error instanceof FormValidationError) {
        throw new ApplicationError(error.message, { code: error.code });
      }
      throw error;
    }

    const document = await strapi.documents(UID).create({
      data,
      fields: ['documentId', 'status'],
    });

    ctx.status = 201;
    ctx.body = {
      data: {
        documentId: document.documentId,
        status: document.status ?? 'new',
      },
    };
  },
}));
