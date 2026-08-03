import { describe, expect, it, vi } from 'vitest';

import { createReferenceSafeRemove } from './media-reference-guard';

type RelatedRow = Readonly<{ __type: string }>;

const createStrapi = (
  related: readonly RelatedRow[] | null,
  displayNames: Readonly<Record<string, string>> = {},
) => {
  const findOne = vi
    .fn()
    .mockResolvedValue(related === null ? null : { id: 7, name: 'logo.png', related });

  return {
    strapi: {
      db: { query: vi.fn().mockReturnValue({ findOne }) },
      contentType: (uid: string) =>
        displayNames[uid] ? { info: { displayName: displayNames[uid] } } : undefined,
    },
    findOne,
  };
};

const file = { id: 7, name: 'logo.png' };

describe('createReferenceSafeRemove', () => {
  it('deletes a file that no document references', async () => {
    const remove = vi.fn().mockResolvedValue({ id: 7 });
    const { strapi } = createStrapi([]);

    const result = await createReferenceSafeRemove(strapi as never, remove)(file);

    expect(remove).toHaveBeenCalledWith(file);
    expect(result).toEqual({ id: 7 });
  });

  it('refuses to delete a file a document still references', async () => {
    const remove = vi.fn();
    const { strapi } = createStrapi([{ __type: 'api::home-page.home-page' }], {
      'api::home-page.home-page': 'Home page',
    });

    await expect(createReferenceSafeRemove(strapi as never, remove)(file)).rejects.toThrow(
      'Home page',
    );
    expect(remove).not.toHaveBeenCalled();
  });

  it('names the media file so an editor knows what to unlink', async () => {
    const { strapi } = createStrapi([{ __type: 'api::global-setting.global-setting' }], {
      'api::global-setting.global-setting': 'Global setting',
    });

    await expect(createReferenceSafeRemove(strapi as never, vi.fn())(file)).rejects.toThrow(
      /Không thể xoá tệp "logo\.png"/,
    );
  });

  it('allows deleting a row that is already gone from the database', async () => {
    const remove = vi.fn().mockResolvedValue(undefined);
    const { strapi } = createStrapi(null);

    await createReferenceSafeRemove(strapi as never, remove)(file);

    expect(remove).toHaveBeenCalledWith(file);
  });
});
