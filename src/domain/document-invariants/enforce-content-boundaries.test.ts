import type { Core } from '@strapi/strapi';
import { errors } from '@strapi/utils';
import { describe, expect, it } from 'vitest';

import type { DocumentMiddlewareContext } from '../document-middleware/types';
import { MapUrlErrorCode } from '../../shared/map-url/map-url.types';
import { SocialUrlErrorCode } from '../../shared/social-url/social-url';
import { enforceContentBoundaries } from './enforce-content-boundaries';

const LOCATION_UID = 'api::location.location';
const GLOBAL_SETTING_UID = 'api::global-setting.global-setting';

const strapi = {} as Core.Strapi;

const ctxFor = (
  uid: string,
  data: Record<string, unknown> | undefined,
  action = 'create',
): DocumentMiddlewareContext => ({ uid, action, params: { data } });

describe('enforceContentBoundaries', () => {
  it('normalizes mapUrl on location and global-setting', async () => {
    for (const uid of [LOCATION_UID, GLOBAL_SETTING_UID]) {
      const data: Record<string, unknown> = {
        mapUrl: '<iframe src="https://www.google.com/maps/embed?pb=abc"></iframe>',
      };

      await enforceContentBoundaries(strapi, ctxFor(uid, data));

      expect(data.mapUrl).toBe('https://www.google.com/maps/embed?pb=abc');
    }
  });

  it('no-ops on read actions and unrelated UIDs', async () => {
    const readData: Record<string, unknown> = { mapUrl: 'not-a-url' };
    await enforceContentBoundaries(strapi, ctxFor(LOCATION_UID, readData, 'findMany'));
    expect(readData.mapUrl).toBe('not-a-url');

    const otherData: Record<string, unknown> = { mapUrl: 'not-a-url' };
    await enforceContentBoundaries(strapi, ctxFor('api::menu-item.menu-item', otherData));
    expect(otherData.mapUrl).toBe('not-a-url');
  });

  it('leaves data alone when the middleware carries none', async () => {
    await expect(
      enforceContentBoundaries(strapi, ctxFor(LOCATION_UID, undefined)),
    ).resolves.toBeUndefined();
  });

  it('surfaces a map URL failure as ApplicationError with the original code', async () => {
    const thrown = await enforceContentBoundaries(
      strapi,
      ctxFor(LOCATION_UID, { mapUrl: 'https://evil.example.com/maps' }),
    ).catch((error: unknown) => error);

    expect(thrown).toBeInstanceOf(errors.ApplicationError);
    expect((thrown as { details?: { code?: string } }).details?.code).toBe(MapUrlErrorCode.Invalid);
  });

  it('clears an empty mapUrl to null instead of failing', async () => {
    const data: Record<string, unknown> = { mapUrl: '   ' };

    await enforceContentBoundaries(strapi, ctxFor(LOCATION_UID, data));

    expect(data.mapUrl).toBeNull();
  });

  it('surfaces a social URL failure as ApplicationError with the original code', async () => {
    const thrown = await enforceContentBoundaries(
      strapi,
      ctxFor(GLOBAL_SETTING_UID, {
        socialLinks: [{ platform: 'facebook', url: 'https://evil.example.com/page' }],
      }),
    ).catch((error: unknown) => error);

    expect(thrown).toBeInstanceOf(errors.ApplicationError);
    expect((thrown as { details?: { code?: string } }).details?.code).toBe(
      SocialUrlErrorCode.InvalidHost,
    );
  });

  it('does not touch socialLinks on location', async () => {
    const data: Record<string, unknown> = {
      socialLinks: [{ platform: 'nope', url: 'not-a-url' }],
    };

    await expect(
      enforceContentBoundaries(strapi, ctxFor(LOCATION_UID, data)),
    ).resolves.toBeUndefined();
  });
});
