import { upsertLocalization, upsertSingleType } from '../lib/seed-document.mjs';
import { link, seo } from './builders.mjs';
import { MAP_URL } from './location.mjs';

export async function seedGlobalSetting(app, summary, locationDocumentId) {
  const globalResult = await upsertSingleType(app, 'api::global-setting.global-setting', 'vi', {
    brandName: 'Salanca Brazil',
    tagline: 'Tinh hoa churrascaria Brazil — từ 2003',
    hotline: '0989561159',
    email: 'booking@salanca.com.vn',
    address: '49 Phan Bội Châu, phường Cửa Nam, TP. Hà Nội',
    mapUrl: MAP_URL,
    openingHours: [{ label: 'Hằng ngày', opensAt: '11:00:00.000', closesAt: '22:00:00.000' }],
    socialLinks: [
      {
        platform: 'facebook',
        label: 'Facebook',
        url: 'https://www.facebook.com/Salancarest/',
      },
    ],
    headerLinks: [
      link('Thực đơn', '/vi/thuc-don'),
      link('Ưu đãi', '/vi/uu-dai'),
      link('Đặt bàn', '/vi/dat-ban'),
    ],
    footerExploreLinks: [
      link('Câu chuyện', '/vi/cau-chuyen'),
      link('Không gian', '/vi/khong-gian'),
    ],
    footerInfoLinks: [link('Liên hệ', '/vi/lien-he'), link('Đặt bàn', '/vi/dat-ban')],
    mainLocation: locationDocumentId,
    defaultSeo: seo(
      'Salanca Brazil',
      'Churrascaria Brazil tại 49 Phan Bội Châu, Hà Nội. Đặt bàn: 024 3845 5224.',
      '/vi',
    ),
  });
  summary.record(globalResult.action);

  await upsertLocalization(app, 'api::global-setting.global-setting', globalResult.documentId, 'en', {
    brandName: 'Salanca Brazil',
    tagline: 'The true essence of Brazilian churrascaria — since 2003',
    address: '49 Phan Boi Chau, Cua Nam Ward, Hanoi',
    openingHours: [{ label: 'Daily', opensAt: '11:00:00.000', closesAt: '22:00:00.000' }],
    socialLinks: [
      {
        platform: 'facebook',
        label: 'Facebook',
        url: 'https://www.facebook.com/Salancarest/',
      },
    ],
    headerLinks: [
      link('Menu', '/en/menu'),
      link('Offers', '/en/offers'),
      link('Booking', '/en/booking'),
    ],
    footerExploreLinks: [link('Our story', '/en/story'), link('Spaces', '/en/spaces')],
    footerInfoLinks: [link('Contact', '/en/contact'), link('Booking', '/en/booking')],
    defaultSeo: seo(
      'Salanca Brazil',
      'Brazilian churrascaria at 49 Phan Boi Chau, Hanoi. Booking: +84 24 3845 5224.',
      '/en',
    ),
  });
  summary.record('updated');

  return globalResult;
}
