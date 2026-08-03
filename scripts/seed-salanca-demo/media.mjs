import { statSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Upload once (or reuse) the demo placeholder asset.
 * @returns {Promise<number|string>} media file id
 */
export async function ensureDemoMedia(app, summary) {
  const uploadService = app.plugin('upload').service('upload');
  const imagePath = resolve('favicon.png');

  const existingFiles = await app.db.query('plugin::upload.file').findMany({
    where: { name: { $containsi: 'salanca-seed-demo' } },
    limit: 1,
  });

  if (existingFiles[0]?.id) {
    summary.record('skipped');
    console.log(`media: reuse file id=${existingFiles[0].id}`);
    return existingFiles[0].id;
  }

  const [uploaded] = await uploadService.upload({
    data: {
      fileInfo: {
        name: 'salanca-seed-demo.png',
        alternativeText: 'Salanca demo media',
        caption: 'Seeded by seed-salanca-demo',
      },
    },
    files: {
      filepath: imagePath,
      originalFilename: 'salanca-seed-demo.png',
      mimetype: 'image/png',
      size: statSync(imagePath).size,
    },
  });

  summary.record('created');
  console.log(`media: created file id=${uploaded.id}`);
  return uploaded.id;
}
