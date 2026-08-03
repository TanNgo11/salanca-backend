import { upsertBySlug, upsertLocalization } from '../lib/seed-document.mjs';
import { image, seo } from './builders.mjs';

/** Source: Facebook @Salancarest (salanca.com.vn offline). */
const MAP_URL =
  'https://www.google.com/maps?q=49+Phan+B%E1%BB%99i+Ch%C3%A2u,+Hanoi,+Vietnam';

export async function seedLocation(app, summary, mediaId) {
  const locationVi = await upsertBySlug(
    app,
    'api::location.location',
    'vi',
    'salanca-ha-noi',
    {
      name: 'Salanca Brazil Hà Nội',
      address: '49 Phan Bội Châu, phường Cửa Nam, TP. Hà Nội',
      mapUrl: MAP_URL,
      phone: '02438455224',
      email: 'booking@salanca.com.vn',
      operatingHours: [
        { label: 'Buổi trưa', opensAt: '11:00:00.000', closesAt: '14:00:00.000' },
        { label: 'Buổi tối', opensAt: '17:30:00.000', closesAt: '22:00:00.000' },
      ],
      heroImage: image(mediaId, 'Không gian Salanca Brazil Hà Nội'),
      isActive: true,
      displayOrder: 0,
      seo: seo(
        'Salanca Brazil Hà Nội',
        'Churrascaria Brazil tại 49 Phan Bội Châu, Hà Nội.',
        '/vi/dia-diem/salanca-ha-noi',
      ),
    },
  );
  summary.record(locationVi.action);

  await upsertLocalization(app, 'api::location.location', locationVi.documentId, 'en', {
    name: 'Salanca Brazil Hanoi',
    slug: 'salanca-hanoi',
    address: '49 Phan Boi Chau, Cua Nam Ward, Hanoi',
    operatingHours: [
      { label: 'Lunch', opensAt: '11:00:00.000', closesAt: '14:00:00.000' },
      { label: 'Dinner', opensAt: '17:30:00.000', closesAt: '22:00:00.000' },
    ],
    heroImage: image(mediaId, 'Salanca Brazil Hanoi interior'),
    seo: seo(
      'Salanca Brazil Hanoi',
      'Brazilian churrascaria at 49 Phan Boi Chau, Hanoi.',
      '/en/locations/salanca-hanoi',
    ),
  });
  summary.record('updated');

  return locationVi;
}

export { MAP_URL };
