/**
 * Script to upload Experience Heritage background images to S3 via Strapi Upload Plugin
 * and update the Experience Story API with live CDN URLs.
 *
 * Usage:
 *   node scripts/upload-experience-heritage-s3.mjs [--preview]
 */
import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { loadStrapiApp } from './lib/strapi-load.mjs';

const isPreview = process.argv.includes('--preview');
const backendRoot = resolve(import.meta.dirname, '..');
const webRoot = resolve(backendRoot, '../salanca-web');
const mediaDir = resolve(backendRoot, 'data/media/salanca');

const filesToUpload = [
  {
    fileName: 'pdf-heritage-vi-bg.webp',
    caption: 'Lịch sử và di sản ẩm thực Churrasco Brazil - Bản tiếng Việt',
    alt: 'Họa tiết chim vẹt và thiên nhiên nhiệt đới Brazil',
  },
  {
    fileName: 'pdf-heritage-en-bg.webp',
    caption: 'History and heritage of Brazilian Churrasco - English version',
    alt: 'Brazilian macaws and tropical flora',
  },
];

async function main() {
  console.log('🚀 Loading Strapi application context...');
  const app = await loadStrapiApp();

  try {
    const provider = app.config.get('plugin::upload.provider');
    const providerOptions = app.config.get('plugin::upload.providerOptions');
    console.log(`📦 Storage provider: ${provider}`);
    if (providerOptions?.baseUrl) {
      console.log(`🌐 CDN/Base URL: ${providerOptions.baseUrl}`);
      console.log(`📁 Root Path: ${providerOptions.rootPath}`);
      console.log(`🪣 Bucket: ${providerOptions.s3Options?.params?.Bucket || 'N/A'}`);
    }

    const uploadService = app.plugin('upload').service('upload');
    const uploadedUrls = {};

    for (const item of filesToUpload) {
      const filePath = resolve(mediaDir, item.fileName);
      if (!existsSync(filePath)) {
        throw new Error(`File not found: ${filePath}`);
      }

      console.log(`\n🔍 Checking media file: ${item.fileName}...`);
      const existing = await app.db.query('plugin::upload.file').findOne({
        where: { name: item.fileName },
      });

      if (existing) {
        console.log(`✅ File already exists in Media Library (id: ${existing.id}):`);
        console.log(`   URL: ${existing.url}`);
        uploadedUrls[item.fileName] = existing.url;
        continue;
      }

      if (isPreview) {
        console.log(`[Preview] Would upload ${item.fileName} (${statSync(filePath).size} bytes) to S3.`);
        uploadedUrls[item.fileName] = `${providerOptions?.baseUrl || 'https://salanca-s3.s3.cloudfly.vn'}/${providerOptions?.rootPath || 'uploads'}/${item.fileName}`;
        continue;
      }

      console.log(`⬆️ Uploading ${item.fileName} to S3 via Strapi Upload Service...`);
      const [uploaded] = await uploadService.upload({
        data: {
          fileInfo: {
            name: item.fileName,
            caption: item.caption,
            alternativeText: item.alt,
          },
        },
        files: {
          filepath: filePath,
          originalFilename: item.fileName,
          mimetype: 'image/webp',
          size: statSync(filePath).size,
        },
      });

      console.log(`🎉 Uploaded successfully! id: ${uploaded.id}`);
      console.log(`   S3 URL: ${uploaded.url}`);
      uploadedUrls[item.fileName] = uploaded.url;
    }

    console.log('\n=============================================');
    console.log('📋 SUMMARY OF S3 MEDIA URLS:');
    console.log(JSON.stringify(uploadedUrls, null, 2));
    console.log('=============================================\n');

    if (!isPreview && uploadedUrls['pdf-heritage-vi-bg.webp'] && uploadedUrls['pdf-heritage-en-bg.webp']) {
      const viUrl = uploadedUrls['pdf-heritage-vi-bg.webp'];
      const enUrl = uploadedUrls['pdf-heritage-en-bg.webp'];

      console.log('📝 Updating API data files with live S3 URLs...');

      // 1. Update salanca-backend/src/api/experience-story/experience-story.data.ts
      const beDataPath = resolve(backendRoot, 'src/api/experience-story/experience-story.data.ts');
      if (existsSync(beDataPath)) {
        let content = readFileSync(beDataPath, 'utf8');
        content = content.replace(/'\/media\/salanca\/pdf-heritage-vi-bg\.webp'/g, `'${viUrl}'`);
        content = content.replace(/'\/media\/salanca\/pdf-heritage-en-bg\.webp'/g, `'${enUrl}'`);
        writeFileSync(beDataPath, content, 'utf8');
        console.log('   ✅ Updated salanca-backend/src/api/experience-story/experience-story.data.ts');
      }

      // 2. Update salanca-web/src/app/api/experience-story/route.ts
      const feRoutePath = resolve(webRoot, 'src/app/api/experience-story/route.ts');
      if (existsSync(feRoutePath)) {
        let content = readFileSync(feRoutePath, 'utf8');
        content = content.replace(/"\/media\/salanca\/pdf-heritage-vi-bg\.webp"/g, `"${viUrl}"`);
        content = content.replace(/"\/media\/salanca\/pdf-heritage-en-bg\.webp"/g, `"${enUrl}"`);
        writeFileSync(feRoutePath, content, 'utf8');
        console.log('   ✅ Updated salanca-web/src/app/api/experience-story/route.ts');
      }

      // 3. Update salanca-web/src/components/experience/sections/experience-heritage.helper.ts
      const feHelperPath = resolve(webRoot, 'src/components/experience/sections/experience-heritage.helper.ts');
      if (existsSync(feHelperPath)) {
        let content = readFileSync(feHelperPath, 'utf8');
        content = content.replace(/"\/media\/salanca\/pdf-heritage-vi-bg\.webp"/g, `"${viUrl}"`);
        content = content.replace(/"\/media\/salanca\/pdf-heritage-en-bg\.webp"/g, `"${enUrl}"`);
        writeFileSync(feHelperPath, content, 'utf8');
        console.log('   ✅ Updated salanca-web/src/components/experience/sections/experience-heritage.helper.ts');
      }

      console.log('✨ All API files synchronized with S3 CDN URLs.');
    }

    return uploadedUrls;
  } finally {
    await app.destroy().catch(() => undefined);
  }
}

main().catch((err) => {
  console.error('❌ Script failed:', err);
  process.exit(1);
});
