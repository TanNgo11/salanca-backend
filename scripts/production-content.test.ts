import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
// @ts-expect-error Runtime ESM helper.
import { sha, validateBundle } from './content-bundle.helper.mjs';
// @ts-expect-error Runtime ESM helper.
import { ensureContentMedia } from './seed-salanca-content/media.mjs';
import { resolvePlaceholders } from './seed-salanca-content/resolve.mjs';

const bundle = JSON.parse(readFileSync(resolve('data/content-release/bundle.json'), 'utf8'));

describe('shipped production content', () => {
  it('ships every referenced original and resolves all media and collection identities', () => {
    validateBundle(bundle);
    const media = new Map<string, number>();
    for (const [index, file] of bundle.files.entries()) {
      const path = resolve('data/media/salanca', file.sourceFile);
      expect(existsSync(path)).toBe(true);
      expect(sha(readFileSync(path))).toBe(file.sha256);
      media.set(file.name, index + 1);
    }
    const refs = new Map<string, string>();
    for (const [uid, collection] of Object.entries(bundle.payload.collections)) {
      const value = collection as { entries?: { key: string }[]; vi?: { slug: string } };
      for (const key of value.entries?.map(entry => entry.key) ?? [value.vi!.slug]) refs.set(`${uid}:${key}`, key);
    }
    const visit = (value: unknown) => {
      if (!value || typeof value !== 'object') return;
      if ('__ref' in value) {
        const spec = value.__ref as { uid: string; key?: string; keys?: string[] };
        for (const key of spec.keys ?? [spec.key]) expect(refs.has(`${spec.uid}:${key}`)).toBe(true);
      }
      for (const nested of Object.values(value)) visit(nested);
    };
    visit(bundle.payload);
    expect(() => resolvePlaceholders(bundle.payload, media, refs)).not.toThrow();
    expect(bundle.files).toHaveLength(24);
  });

  it('reuploads a same-name local media record instead of mistaking it for destination S3', async () => {
    vi.stubEnv('SALANCA_SEED_REQUIRE_S3', 'true');
    vi.stubEnv('SALANCA_WEB_MEDIA_DIR', resolve('data/media/salanca'));
    const fileName = bundle.files[0].sourceFile;
    const upload = vi.fn().mockResolvedValue([{ id: 42, provider: 'aws-s3', url: 'https://cdn.example.com/approved/image.webp' }]);
    const app = {
      config: { get: (key: string) => key.endsWith('provider') ? 'aws-s3' : { baseUrl: 'https://cdn.example.com', rootPath: 'approved' } },
      plugin: () => ({ service: () => ({ upload }) }),
      db: { query: () => ({ findMany: async () => [{ id: 9, provider: 'local', url: '/uploads/image.webp' }] }) },
    };
    try {
      const media = await ensureContentMedia(app, { record: vi.fn() }, [fileName]);
      expect(media.get(fileName)).toBe(42);
      expect(upload).toHaveBeenCalledOnce();
    } finally { vi.unstubAllEnvs(); }
  });
});
