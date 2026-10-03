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
  const requireS3 = process.env.SALANCA_SEED_REQUIRE_S3 === 'true';
  if (requireS3 && app.config.get('plugin::upload.provider') !== 'aws-s3') throw new Error('Owner seed requires S3.');
  const destination = requireS3 ? app.config.get('plugin::upload.providerOptions') : null;
  const belongsToDestination = file => !requireS3 || (file.provider === 'aws-s3' && file.url?.startsWith(`${destination.baseUrl.replace(/\/$/, '')}/${destination.rootPath}/`));

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
    });

    const reusable = existing.find(belongsToDestination);
    if (reusable?.id) {
      byName.set(fileName, reusable.id);
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

    if (!uploaded?.id || !belongsToDestination(uploaded)) throw new Error(`Upload did not return destination S3 media: ${fileName}`);

    byName.set(fileName, uploaded.id);
    summary.record('created');
  }

  return byName;
}
