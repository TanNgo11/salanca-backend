import { existsSync, statSync } from 'node:fs';
import { extname, resolve } from 'node:path';

/**
 * Media files live with the frontend that ships them. Override the location
 * with SALANCA_WEB_MEDIA_DIR when the repos are not siblings.
 */
const DEFAULT_MEDIA_DIR = resolve('../salanca-web/public/media/salanca');

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
