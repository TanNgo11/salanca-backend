import { upsertLocalization, upsertSingleType } from '../lib/seed-document.mjs';
import { cta, hero, image, link, seo } from './builders.mjs';

async function seedPage(app, summary, uid, viData, enData) {
  const vi = await upsertSingleType(app, uid, 'vi', viData);
  summary.record(vi.action);
  if (enData) {
    await upsertLocalization(app, uid, vi.documentId, 'en', enData);
    summary.record('updated');
  }
  return vi;
}

export async function seedPages(app, summary, mediaId, pkgDocumentId) {
  // Home copy aligned with salanca-web `homePageCopy` for fields the Phase 20
  // adapter maps, so CMS-on visual tests stay on the same baseline as static fallback.
  await seedPage(
    app,
    summary,
    'api::home-page.home-page',
    {
      hero: hero(
        mediaId,
        'TINH HOA\nCHURRASCARIA\nBRAZIL',
        'Trải nghiệm hơn 12 loại thịt nướng phục vụ trực tiếp tại bàn theo phong cách Brazil truyền thống.',
        'Đặt bàn ngay',
        '/vi/dat-ban',
      ),
      experienceHeading:
        'Không chỉ là một bữa ăn, mà là một trải nghiệm Brazil trọn vẹn',
      experienceBody:
        'Từng xiên thịt hảo hạng nướng chậm trên than hồng, mang đến tận bàn và thái lát trực tiếp trước mặt bạn — đúng tinh thần Churrascaria đích thực.',
      experienceImage: image(mediaId, 'Đầu bếp chuẩn bị món tại bếp mở'),
      experienceLink: link('Tìm hiểu thêm', '/vi/trai-nghiem'),
      featuredPackage: pkgDocumentId,
      featuredMenuHeading: 'Những hương vị không thể bỏ lỡ',
      storyHeading: 'Câu chuyện Salanca',
      storyBody:
        'Từ năm 2003, tiên thân là Au Lac do Brazil, chúng tôi đã mang tinh hoa ẩm thực Brazil đến TP. Hồ Chí Minh. Năm 2022, Salanca chính thức trở thành thương hiệu tiếp nối sứ mệnh mang đến trải nghiệm Churrascaria đích thực cho khách Việt.',
      storyImage: image(mediaId, 'Câu chuyện Salanca'),
      storyLink: link('Đọc tiếp câu chuyện', '/vi/cau-chuyen'),
      spaceHeading: 'Một góc Brazil giữa lòng thành phố',
      spaceImage: image(mediaId, 'Không gian sảnh chính Salanca'),
      spaceLink: link('Xem thêm hình ảnh', '/vi/khong-gian'),
      closingCta: cta(
        'Sẵn sàng cho một bữa tiệc đậm chất Brazil?',
        'Đặt bàn ngay để giữ chỗ và tận hưởng trải nghiệm Churrascaria trọn vẹn.',
        'Đặt bàn ngay',
        '/vi/dat-ban',
      ),
      seo: seo('Salanca Brazil — Trang chủ', 'Churrascaria Brazil tại Hà Nội.', '/vi'),
    },
    {
      hero: hero(
        mediaId,
        'THE ESSENCE OF\nBRAZILIAN\nCHURRASCARIA',
        'Experience more than 12 grilled meats carved tableside in the traditional Brazilian style.',
        'Book a table',
        '/en/reservations',
      ),
      experienceHeading: 'Not just a meal — a complete Brazilian experience',
      experienceBody:
        'Premium cuts slow-grilled over charcoal, brought to your table and carved before you — true Churrascaria spirit.',
      experienceImage: image(mediaId, 'Chef plating a dish at the open kitchen'),
      experienceLink: link('Learn more', '/en/experience'),
      featuredMenuHeading: 'Flavors you cannot miss',
      storyHeading: 'The Salanca story',
      storyBody:
        'Since 2003, from our roots as Au Lac do Brazil, we have brought Brazilian dining craft to Ho Chi Minh City. In 2022, Salanca continued that mission — authentic Churrascaria for Vietnamese guests.',
      storyImage: image(mediaId, 'The Salanca story'),
      storyLink: link('Read our story', '/en/our-story'),
      spaceHeading: 'A corner of Brazil in the city',
      spaceImage: image(mediaId, 'Salanca main dining room'),
      spaceLink: link('See more photos', '/en/space'),
      closingCta: cta(
        'Ready for a true Brazilian feast?',
        'Reserve a table to secure your seat and enjoy the full Churrascaria experience.',
        'Book now',
        '/en/reservations',
      ),
      seo: seo('Salanca Brazil — Home', 'Brazilian churrascaria in Hanoi.', '/en'),
    },
  );

  await seedPage(
    app,
    summary,
    'api::menu-page.menu-page',
    {
      hero: hero(mediaId, 'Thực đơn', 'Buffet và các món nướng signature.', 'Đặt bàn', '/vi/dat-ban'),
      packageSectionHeading: 'Gói buffet',
      itemSectionHeading: 'Món nổi bật',
      bookingCta: cta('Sẵn sàng đặt bàn?', 'Chọn gói và giữ chỗ.', 'Đặt bàn', '/vi/dat-ban'),
      seo: seo('Thực đơn Salanca', 'Buffet và món nướng.', '/vi/thuc-don'),
    },
    {
      hero: hero(
        mediaId,
        'Menu',
        'Buffet packages and signature cuts.',
        'Book',
        '/en/reservations',
      ),
      packageSectionHeading: 'Buffet packages',
      itemSectionHeading: 'Featured items',
      bookingCta: cta(
        'Ready to book?',
        'Pick a package and reserve.',
        'Book',
        '/en/reservations',
      ),
      seo: seo('Salanca menu', 'Buffet and grilled dishes.', '/en/menu'),
    },
  );

  await seedPage(
    app,
    summary,
    'api::campaign-page.campaign-page',
    {
      hero: hero(mediaId, 'Ưu đãi & sự kiện', 'Khuyến mãi và tiệc riêng.', 'Xem ưu đãi', '/vi/uu-dai'),
      featuredHeading: 'Nổi bật',
      listingHeading: 'Tất cả chương trình',
      closingCta: cta(
        'Cần tư vấn sự kiện?',
        'Đội ngũ Salanca sẵn sàng hỗ trợ.',
        'Liên hệ',
        '/vi/lien-he',
      ),
      seo: seo('Ưu đãi Salanca', 'Khuyến mãi và sự kiện.', '/vi/uu-dai'),
    },
    {
      hero: hero(mediaId, 'Offers & events', 'Promotions and private events.', 'View offers', '/en/offers'),
      featuredHeading: 'Featured',
      listingHeading: 'All programs',
      closingCta: cta('Planning an event?', 'Our team can help.', 'Contact', '/en/contact'),
      seo: seo('Salanca offers', 'Promotions and events.', '/en/offers'),
    },
  );

  await seedPage(
    app,
    summary,
    'api::story-page.story-page',
    {
      hero: hero(
        mediaId,
        'Câu chuyện Salanca',
        'Từ Aulac Do Brazil đến Salanca Brazil — tinh hoa churrascaria từ 2003.',
        'Trải nghiệm',
        '/vi/trai-nghiem',
      ),
      originHeading: 'Nguồn gốc',
      closingCta: cta(
        'Ghé thăm chúng tôi',
        'Một buổi tối nướng đúng điệu tại Hà Nội.',
        'Đặt bàn',
        '/vi/dat-ban',
      ),
      seo: seo('Câu chuyện Salanca', 'Về Salanca Brazil churrascaria Hà Nội.', '/vi/cau-chuyen'),
    },
    {
      hero: hero(
        mediaId,
        'Our story',
        'Formerly Aulac Do Brazil — authentic Brazilian churrascaria since 2003.',
        'Experience',
        '/en/experience',
      ),
      originHeading: 'Origins',
      closingCta: cta(
        'Visit us',
        'An evening of proper grill in Hanoi.',
        'Book',
        '/en/reservations',
      ),
      seo: seo(
        'Salanca story',
        'About Salanca Brazil churrascaria in Hanoi.',
        '/en/our-story',
      ),
    },
  );

  await seedPage(
    app,
    summary,
    'api::experience-page.experience-page',
    {
      hero: hero(mediaId, 'Trải nghiệm', 'Rodizio, nghi thức và hương vị.', 'Đặt bàn', '/vi/dat-ban'),
      introHeading: 'Một buổi tối churrasco',
      closingCta: cta('Thưởng thức ngay', 'Giữ chỗ cho nhóm của bạn.', 'Đặt bàn', '/vi/dat-ban'),
      seo: seo('Trải nghiệm Salanca', 'Quy trình rodizio tại Salanca.', '/vi/trai-nghiem'),
    },
    {
      hero: hero(
        mediaId,
        'Experience',
        'Rodizio, ritual and flavour.',
        'Book',
        '/en/reservations',
      ),
      introHeading: 'A churrasco evening',
      closingCta: cta(
        'Taste it tonight',
        'Reserve for your group.',
        'Book',
        '/en/reservations',
      ),
      seo: seo('Salanca experience', 'The rodizio flow at Salanca.', '/en/experience'),
    },
  );

  await seedPage(
    app,
    summary,
    'api::space-page.space-page',
    {
      hero: hero(mediaId, 'Không gian', 'Sảnh chính, quầy bar và phòng riêng.', 'Đặt bàn', '/vi/dat-ban'),
      introHeading: 'Không gian nhà hàng',
      closingCta: cta('Tham quan & đặt chỗ', 'Phù hợp hẹn hò và tiệc nhóm.', 'Liên hệ', '/vi/lien-he'),
      seo: seo('Không gian Salanca', 'Gallery và khu vực nhà hàng.', '/vi/khong-gian'),
    },
    {
      hero: hero(
        mediaId,
        'Spaces',
        'Main hall, bar and private rooms.',
        'Book',
        '/en/reservations',
      ),
      introHeading: 'Restaurant spaces',
      closingCta: cta('Visit & reserve', 'Ideal for dates and groups.', 'Contact', '/en/contact'),
      seo: seo('Salanca spaces', 'Gallery and dining areas.', '/en/space'),
    },
  );

  await seedPage(
    app,
    summary,
    'api::contact-page.contact-page',
    {
      hero: hero(
        mediaId,
        'Liên hệ',
        'Ghé thăm 49 Phan Bội Châu hoặc gửi lời nhắn.',
        'Gọi hotline',
        'tel:0989561159',
      ),
      visitHeading: 'Ghé nhà hàng',
      formHeading: 'Gửi thông tin',
      closingCta: cta(
        'Cần đặt bàn gấp?',
        'Gọi đặt bàn 024 3845 5224 hoặc hotline 0989 561 159.',
        'Gọi ngay',
        'tel:02438455224',
      ),
      seo: seo('Liên hệ Salanca Brazil', 'Địa chỉ và thông tin liên hệ Hà Nội.', '/vi/lien-he'),
    },
    {
      hero: hero(
        mediaId,
        'Contact',
        'Visit 49 Phan Boi Chau or send a message.',
        'Call hotline',
        'tel:0989561159',
      ),
      visitHeading: 'Visit the restaurant',
      formHeading: 'Send a message',
      closingCta: cta(
        'Need a table soon?',
        'Call booking +84 24 3845 5224 or hotline +84 989 561 159.',
        'Call now',
        'tel:02438455224',
      ),
      seo: seo('Contact Salanca Brazil', 'Hanoi address and contact details.', '/en/contact'),
    },
  );

  await seedPage(
    app,
    summary,
    'api::booking-page.booking-page',
    {
      hero: hero(
        mediaId,
        'Đặt bàn',
        'Giữ chỗ qua điện thoại — website booking engine chưa có.',
        'Gọi đặt bàn',
        'tel:02438455224',
      ),
      formHeading: 'Thông tin đặt bàn',
      seo: seo('Đặt bàn Salanca Brazil', 'Hướng dẫn đặt bàn tại Salanca Hà Nội.', '/vi/dat-ban'),
    },
    {
      hero: hero(
        mediaId,
        'Booking',
        'Reserve by phone — live booking engine not available yet.',
        'Call to book',
        'tel:02438455224',
      ),
      formHeading: 'Reservation details',
      seo: seo(
        'Book Salanca Brazil',
        'How to reserve at Salanca Hanoi.',
        '/en/reservations',
      ),
    },
  );
}
