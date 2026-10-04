import { loadStrapiApp } from './lib/strapi-load.mjs';
import { ensureContentMedia } from './seed-salanca-content/media.mjs';

/**
 * Uploads the menu frame art that still lives in the frontend and attaches it
 * to menu-page.decorations. Re-running replaces those rows by slot.
 *
 * Preview is the default. Pass --apply to write and publish.
 * Local database only. Media is read from data/media/salanca, or from
 * SALANCA_WEB_MEDIA_DIR when that is set.
 */

if (!['localhost', '127.0.0.1', '::1'].includes(process.env.DATABASE_HOST) || process.env.DATABASE_URL) {
  throw new Error('Explicit local database required.');
}

const decorations = [
  { slot: 'a-la-carte-leaves', file: 'pdf-steak-leaves-masked.webp', alt: 'Họa tiết lá bên trái thẻ à la carte' },
  { slot: 'a-la-carte-botanical', file: 'pdf-a-la-carte-leaves.png', alt: 'Họa tiết lá phần gọi món' },
  { slot: 'buffet-leaf', file: 'pdf-buffet-leaf-alpha.png', alt: 'Họa tiết lá trang buffet' },
  { slot: 'rodizio-flower', file: 'pdf-rodizio-flower.webp', alt: 'Hoa trang rodizio' },
  { slot: 'dessert-fruit-top', file: 'pdf-dessert-fruit-top-4k.webp', alt: 'Khung trái cây phía trên món tráng miệng' },
  { slot: 'dessert-fruit-bottom', file: 'pdf-dessert-fruit-bottom-4k.webp', alt: 'Khung trái cây phía dưới món tráng miệng' },
  { slot: 'takeaway-leaves-top', file: 'pdf-takeaway-leaves-top.webp', alt: 'Lá khung mang về phía trên' },
  { slot: 'takeaway-leaves-bottom', file: 'pdf-takeaway-leaves-bottom.webp', alt: 'Lá khung mang về phía dưới' },
  { slot: 'takeaway-frame-top', file: 'pdf-takeaway-top.webp', alt: 'Viền trên khung mang về' },
  { slot: 'takeaway-frame-bottom', file: 'pdf-takeaway-bottom.webp', alt: 'Viền dưới khung mang về' },
  { slot: 'takeaway-frame-second-top', file: 'pdf-takeaway-second-top.webp', alt: 'Viền trên khung mang về thứ hai' },
  { slot: 'takeaway-frame-second-bottom', file: 'pdf-takeaway-second-bottom.webp', alt: 'Viền dưới khung mang về thứ hai' },
  { slot: 'takeaway-logo', file: 'logo-salanca-brazil-official.png', alt: 'Logo trong khung mang về' },
  { slot: 'booking-strip-leaves', file: 'pdf-birds-left-4k.webp', alt: 'Lá dải đặt bàn' },
  { slot: 'accent-flowers', file: 'pdf-bird-of-paradise-4k.webp', alt: 'Hoa dải nhấn thực đơn' },
];

const apply = process.argv.includes('--apply');
const app = await loadStrapiApp();

function imagePayload(mediaId, alt) {
  return {
    media: mediaId,
    alt,
    caption: null,
    focalPointX: 50,
    focalPointY: 50,
  };
}

try {
  const rows = await app.documents('api::menu-page.menu-page').findMany({
    locale: 'vi',
    status: 'published',
    populate: { decorations: { populate: { image: { populate: { media: true } } } } },
  });
  if (rows.length !== 1) throw new Error('Expected exactly one published menu-page (vi).');
  const current = new Map((rows[0].decorations ?? []).map((row) => [row.slot, row.image?.media?.name ?? null]));
  for (const row of decorations) {
    console.log(`${row.slot}: ${current.get(row.slot) ?? 'empty'} -> ${row.file}`);
  }
  const unchanged = decorations.every((row) => current.get(row.slot) === row.file)
    && (rows[0].decorations ?? []).length === decorations.length;
  if (unchanged) console.log('Menu decorations already match.');
  else if (!apply) console.log('Preview only; no content changed. Re-run with --apply.');
  else {
    const media = await ensureContentMedia(app, { record() {} }, decorations.map((row) => row.file));
    const data = {
      decorations: decorations.map((row) => ({
        slot: row.slot,
        image: imagePayload(media.get(row.file), row.alt),
      })),
    };
    await app.documents('api::menu-page.menu-page').update({
      documentId: rows[0].documentId,
      locale: 'vi',
      data,
    });
    await app.documents('api::menu-page.menu-page').publish({
      documentId: rows[0].documentId,
      locale: 'vi',
    });
    console.log('Published menu-page decorations.');
  }
} finally {
  const pool = app.db.connection.client.pool;
  const deadline = Date.now() + 10000;
  let idleTurns = 0;
  while (idleTurns < 2) {
    await new Promise((resolve) => setImmediate(resolve));
    if (pool.numUsed() === 0 && pool.numPendingAcquires() === 0) idleTurns += 1;
    else {
      idleTurns = 0;
      if (Date.now() > deadline) throw new Error('Pending database events; shutdown withheld.');
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }
  await app.destroy();
}
