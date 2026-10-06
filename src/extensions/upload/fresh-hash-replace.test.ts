import { describe, expect, it, vi } from 'vitest';

import {
  createFreshHashReplace,
  pickReplacedFields,
  resolveMimeType,
  type UploadFileData,
} from './fresh-hash-replace';

const existing = { id: 7, hash: 'dessert_old1' };

const incoming = {
  filepath: '/tmp/upload_abc',
  originalFilename: 'dessert.jpg',
  mimetype: 'image/jpeg',
  size: 204800,
};

const setup = (overrides: Partial<{ found: unknown; image: boolean; faulty: boolean }> = {}) => {
  const { found = existing, image = true, faulty = false } = overrides;
  const update = vi.fn().mockResolvedValue({});
  const strapi = { db: { query: vi.fn().mockReturnValue({ update }) } };
  const deps = {
    findOne: vi.fn().mockResolvedValue(found),
    formatFileInfo: vi.fn(async (): Promise<UploadFileData> => ({
      name: 'dessert.jpg',
      hash: 'dessert_new2',
      ext: '.jpg',
      mime: 'image/jpeg',
      size: 200,
      folderPath: '/9',
      tmpWorkingDirectory: '/tmp/x',
    })),
    isImage: vi.fn().mockResolvedValue(image),
    isFaultyImage: vi.fn().mockResolvedValue(faulty),
    isOptimizableImage: vi.fn().mockResolvedValue(true),
    optimize: vi.fn(async (file: UploadFileData) => ({ ...file, ext: '.webp', mime: 'image/webp' })),
    checkFileSize: vi.fn().mockResolvedValue(undefined),
    uploadImage: vi.fn(async (file: UploadFileData) => {
      Object.assign(file, {
        width: 2560,
        height: 1440,
        url: 'https://media.example.com/uploads/dessert_new2.webp',
        formats: { w640: { url: 'https://media.example.com/uploads/w640_dessert_new2.webp' } },
      });
    }),
    uploadFile: vi.fn(async (file: UploadFileData) => {
      Object.assign(file, { url: 'https://media.example.com/uploads/dessert_new2.pdf' });
    }),
    providerName: () => 'aws-s3',
    updateFileInfo: vi.fn().mockResolvedValue({ id: 7 }),
    onReplaced: vi.fn(),
  };
  return { replace: createFreshHashReplace(strapi as never, deps), deps, update };
};

const input = { data: { fileInfo: { name: 'dessert.jpg' } }, file: incoming };

describe('createFreshHashReplace', () => {
  it('stores the optimized image under a fresh hash on the existing row', async () => {
    const { replace, deps, update } = setup();

    const result = await replace(7, input, { user: { id: 1 } });

    expect(deps.formatFileInfo).toHaveBeenCalledWith(
      { filename: 'dessert.jpg', type: 'image/jpeg', size: 204800 },
      { name: 'dessert.jpg' },
      { tmpWorkingDirectory: expect.any(String) },
    );
    expect(deps.uploadImage).toHaveBeenCalledOnce();
    expect(update).toHaveBeenCalledWith({
      where: { id: 7 },
      data: {
        name: 'dessert.jpg',
        hash: 'dessert_new2',
        ext: '.webp',
        mime: 'image/webp',
        size: 200,
        width: 2560,
        height: 1440,
        url: 'https://media.example.com/uploads/dessert_new2.webp',
        formats: { w640: { url: 'https://media.example.com/uploads/w640_dessert_new2.webp' } },
        provider: 'aws-s3',
      },
    });
    expect(deps.updateFileInfo).toHaveBeenCalledWith(7, {}, { user: { id: 1 } });
    expect(deps.onReplaced).toHaveBeenCalledWith(7);
    expect(result).toEqual({ id: 7 });
  });

  it('keeps the row name when the editor gave no new name', async () => {
    const { replace, update } = setup();

    await replace(7, { data: {}, file: incoming });

    expect(update.mock.calls[0]?.[0].data).not.toHaveProperty('name');
  });

  it('uploads a non-image and clears the old formats and dimensions', async () => {
    const { replace, deps, update } = setup({ image: false });

    await replace(7, input);

    expect(deps.uploadImage).not.toHaveBeenCalled();
    expect(deps.optimize).not.toHaveBeenCalled();
    expect(deps.uploadFile).toHaveBeenCalledOnce();
    expect(update.mock.calls[0]?.[0].data).toMatchObject({
      url: 'https://media.example.com/uploads/dessert_new2.pdf',
      formats: {},
      width: null,
      height: null,
    });
  });

  it('clears old formats when the new image produces none', async () => {
    const { replace, deps, update } = setup();
    deps.uploadImage.mockImplementationOnce(async (file: UploadFileData) => {
      Object.assign(file, { width: 200, height: 120, url: 'https://media.example.com/uploads/tiny_new.webp' });
    });

    await replace(7, input);

    expect(update.mock.calls[0]?.[0].data).toMatchObject({ formats: {}, width: 200, height: 120 });
  });

  it('rejects a faulty image before uploading anything', async () => {
    const { replace, deps, update } = setup({ faulty: true });

    await expect(replace(7, input)).rejects.toThrow('File is not a valid image');
    expect(deps.uploadImage).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
    expect(deps.onReplaced).not.toHaveBeenCalled();
  });

  it('throws NotFound before touching storage when the file does not exist', async () => {
    const { replace, deps } = setup({ found: null });

    await expect(replace(7, input)).rejects.toThrow();
    expect(deps.formatFileInfo).not.toHaveBeenCalled();
  });

  it('does not announce a replace when the row update fails', async () => {
    const { replace, update, deps } = setup();
    update.mockRejectedValueOnce(new Error('db down'));

    await expect(replace(7, input)).rejects.toThrow('db down');
    expect(deps.updateFileInfo).not.toHaveBeenCalled();
    expect(deps.onReplaced).not.toHaveBeenCalled();
  });
});

describe('pickReplacedFields', () => {
  it('keeps storage fields and drops identity, folder and undefined values', () => {
    const fields = pickReplacedFields({
      id: 99,
      hash: 'h',
      folderPath: '/9',
      tmpWorkingDirectory: '/tmp/x',
      caption: undefined,
    });

    expect(fields).toEqual({ hash: 'h' });
  });
});

describe('resolveMimeType', () => {
  it('prefers the detected type and ignores octet-stream', () => {
    expect(resolveMimeType({ ...incoming, detectedMimeType: 'image/png' })).toBe('image/png');
    expect(resolveMimeType({ ...incoming, mimetype: 'application/octet-stream' })).toBe(
      'application/octet-stream',
    );
    expect(resolveMimeType(incoming)).toBe('image/jpeg');
  });
});
