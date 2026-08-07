import { upsertBySlug, upsertLocalization } from '../lib/seed-document.mjs';
import { cta, image, paragraph, seo } from './builders.mjs';

export async function seedCampaigns(app, summary, mediaId) {
  const promo = await upsertBySlug(app, 'api::campaign.campaign', 'vi', 'uu-dai-khai-truong', {
    kind: 'promotion',
    title: 'Mừng nhà mới — Salanca chiêu đãi',
    summary: 'Chương trình chiêu đãi mừng không gian mới. Liên hệ hotline để nhận ưu đãi đặt bàn.',
    body: paragraph(
      'Theo thông tin trên fanpage Salanca Brazil. Vui lòng gọi 024 3845 5224 hoặc 0989 561 159 để xác nhận điều kiện áp dụng.',
    ),
    startsAt: '2026-08-01T00:00:00.000Z',
    endsAt: '2026-08-31T23:59:59.000Z',
    isFeatured: true,
    displayOrder: 0,
    coverImage: image(mediaId, 'Mừng nhà mới Salanca'),
    cta: cta('Đặt bàn ngay', 'Giữ chỗ để nhận ưu đãi mừng nhà mới.', 'Đặt bàn', '/vi/dat-ban'),
    seo: seo('Mừng nhà mới', 'Ưu đãi đặt bàn tại Salanca Brazil Hà Nội.', '/vi/uu-dai/uu-dai-khai-truong'),
  });
  summary.record(promo.action);
  await upsertLocalization(app, 'api::campaign.campaign', promo.documentId, 'en', {
    kind: 'promotion',
    title: 'New space celebration offer',
    summary: 'Celebratory dining offer for our refreshed space. Call to confirm booking benefits.',
    body: paragraph(
      'Based on Salanca Brazil Facebook updates. Call +84 24 3845 5224 or +84 989 561 159 for current terms.',
    ),
    slug: 'opening-promotion',
    coverImage: image(mediaId, 'Salanca new space celebration'),
    cta: cta(
      'Book a table',
      'Reserve to claim the celebration offer.',
      'Book a table',
      '/en/reservations',
    ),
    seo: seo('New space offer', 'Booking offer at Salanca Brazil Hanoi.', '/en/offers/opening-promotion'),
  });
  summary.record('updated');

  const privateEvent = await upsertBySlug(app, 'api::campaign.campaign', 'vi', 'tiec-rieng-tu', {
    kind: 'private_event',
    title: 'Tiệc riêng tư',
    summary: 'Không gian phòng riêng cho nhóm từ 10 khách.',
    body: paragraph('Liên hệ để nhận báo giá theo số khách.'),
    startsAt: '2026-09-01T00:00:00.000Z',
    endsAt: '2026-12-31T23:59:59.000Z',
    isFeatured: false,
    displayOrder: 1,
    coverImage: image(mediaId, 'Phòng tiệc riêng'),
    cta: cta('Đặt tiệc riêng', 'Liên hệ để nhận báo giá theo số khách.', 'Liên hệ', '/vi/lien-he'),
    seo: seo('Tiệc riêng tư', 'Đặt phòng riêng tại Salanca.', '/vi/uu-dai/tiec-rieng-tu'),
  });
  summary.record(privateEvent.action);
  await upsertLocalization(
    app,
    'api::campaign.campaign',
    privateEvent.documentId,
    'en',
    {
      kind: 'private_event',
      title: 'Private dining (draft)',
      summary: 'Translation pending editorial review.',
      slug: 'private-dining-draft',
      coverImage: image(mediaId, 'Private dining room'),
      cta: cta('Private dining', 'Contact us for a group quote.', 'Contact', '/en/contact'),
      seo: seo(
        'Private dining draft',
        'English copy pending review — keep draft.',
        '/en/offers/private-dining-draft',
      ),
    },
    { publish: false },
  );
  summary.record('updated');

  return { promo, privateEvent };
}
