import { applyRequested, requirePublishedSingle, withStrapi } from './lib/scoped-seed.mjs';
import { ensureContentMedia } from './lib/content-import/media.mjs';

/**
 * Writes menu-page.decorations only. The field is not localized, so the
 * Vietnamese entry is the single write. Preview unless --apply.
 * Other menu-page fields are not sent.
 */

const UID = 'api::menu-page.menu-page';
const apply = applyRequested();
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

await withStrapi(async (app) => {
  const localDatabase = ['localhost', '127.0.0.1', '::1'].includes(process.env.DATABASE_HOST) && !process.env.DATABASE_URL;
  if (!localDatabase && app.config.get('plugin::upload.provider') !== 'aws-s3') {
    throw new Error('This seed uploads media. Production requires the S3 provider. No content written.');
  }
  if (!localDatabase) process.env.SALANCA_SEED_REQUIRE_S3 = 'true';

  const current = await requirePublishedSingle(app, UID, 'vi');
  const existing = await app.documents(UID).findOne({
    documentId: current.documentId,
    locale: 'vi',
    status: 'published',
    populate: { decorations: { populate: { image: { populate: { media: true } } } } },
  });
  const bySlot = new Map((existing?.decorations ?? []).map((row) => [row.slot, row.image?.media?.name ?? 'empty']));
  console.log(`${UID}/vi document ${current.documentId}: replace decorations only`);
  for (const row of decorations) {
    console.log(`  ${row.slot}: ${bySlot.get(row.slot) ?? 'empty'} -> ${row.file}`);
  }
  if (!apply) {
    console.log('Preview only. No content written. Re-run with --apply.');
    return;
  }
  const media = await ensureContentMedia(app, { record() {} }, decorations.map((row) => row.file));
  await app.documents(UID).update({
    documentId: current.documentId,
    locale: 'vi',
    data: {
      decorations: decorations.map((row) => ({
        slot: row.slot,
        image: {
          media: media.get(row.file),
          alt: row.alt,
          caption: null,
          focalPointX: 50,
          focalPointY: 50,
        },
      })),
    },
  });
  await app.documents(UID).publish({ documentId: current.documentId, locale: 'vi' });
  console.log('Published menu-page decorations.');
});
