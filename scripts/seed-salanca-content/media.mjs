import { existsSync, statSync } from 'node:fs';
import { extname, resolve } from 'node:path';

/**
 * `data/media/salanca` is a committed mirror of salanca-web's media folder —
 * the backend repo must be able to seed on its own in a container that has
 * no salanca-web checkout. `deploy-content-seed.mjs` refreshes this mirror
 * from the sibling repo when it is present. Override with SALANCA_WEB_MEDIA_DIR
 * to read from the sibling checkout directly instead (e.g. local dev).
 */
const DEFAULT_MEDIA_DIR = resolve('data/media/salanca');

const MIME_BY_EXTENSION = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
};

export function mediaDirectory() {
  return resolve(process.env.SALANCA_WEB_MEDIA_DIR?.trim() || DEFAULT_MEDIA_DIR);
}

/**
 * Uploads every file the payload references, reusing any already in the
 * library. Returns a `fileName -> media id` map for `__media` resolution.
 */
export async function ensureContentMedia(app, summary, fileNames) {
  const uploadService = app.plugin('upload').service('upload');
  const directory = mediaDirectory();
  const byName = new Map();

  for (const fileName of fileNames) {
    const filePath = resolve(directory, fileName);
    if (!existsSync(filePath)) {
      throw new Error(
        `Media file "${fileName}" not found in ${directory}. ` +
          'Set SALANCA_WEB_MEDIA_DIR to the salanca-web media folder.',
      );
    }

    const existing = await app.db.query('plugin::upload.file').findMany({
      where: { name: fileName },
      limit: 1,
    });

    if (existing[0]?.id) {
      byName.set(fileName, existing[0].id);
      summary.record('skipped');
      continue;
    }

    const extension = extname(fileName).toLowerCase();
    const mimetype = MIME_BY_EXTENSION[extension];
    if (mimetype === undefined) {
      throw new Error(`Unsupported media extension "${extension}" (${fileName}).`);
    }

    const [uploaded] = await uploadService.upload({
      data: { fileInfo: { name: fileName, alternativeText: fileName } },
      files: {
        filepath: filePath,
        originalFilename: fileName,
        mimetype,
        size: statSync(filePath).size,
      },
    });

    byName.set(fileName, uploaded.id);
    summary.record('created');
  }

  return byName;
}
