import type { Core } from '@strapi/strapi';
import { errors } from '@strapi/utils';

import { normalizeOptionalMapUrl } from '../../shared/map-url/map-url';
import { MapUrlError } from '../../shared/map-url/map-url.types';
import { normalizeSocialLinksInPlace, SocialUrlError } from '../../shared/social-url/social-url';
import type { DocumentMiddlewareContext } from '../document-middleware/types';

const { ApplicationError } = errors;

const LOCATION_UID = 'api::location.location' as const;
const GLOBAL_SETTING_UID = 'api::global-setting.global-setting' as const;
const MUTATING = new Set(['create', 'update']);

const toApplicationError = (error: unknown): never => {
  if (error instanceof MapUrlError || error instanceof SocialUrlError) {
    throw new ApplicationError(error.message, { code: error.code });
  }
  throw error;
};

/**
 * Map URL + social hostname normalizers for shell content types (before next).
 * Focal range is owned by `shared.image` schema min/max/default — not a tree walk.
 */
export const enforceContentBoundaries = async (
  _strapi: Core.Strapi,
  ctx: DocumentMiddlewareContext,
): Promise<void> => {
  const data = ctx.params.data;

  if (!data || !MUTATING.has(ctx.action)) {
    return;
  }

  try {
    if (ctx.uid === LOCATION_UID || ctx.uid === GLOBAL_SETTING_UID) {
      if ('mapUrl' in data) {
        data.mapUrl = normalizeOptionalMapUrl(data.mapUrl);
      }
    }

    if (ctx.uid === GLOBAL_SETTING_UID) {
      normalizeSocialLinksInPlace(data);
    }
  } catch (error) {
    toApplicationError(error);
  }
};
