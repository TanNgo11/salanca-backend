import { image } from './builders.mjs';

export async function seedGallery(app, summary, mediaId, locationDocumentId) {
  const galleryUid = 'api::gallery-item.gallery-item';
  const galleryTitle = 'Sảnh chính';
  const galleryData = {
    title: galleryTitle,
    description: 'Không gian sảnh chính về đêm.',
    image: image(mediaId, 'Sảnh chính Salanca'),
    area: 'main_hall',
    location: locationDocumentId,
    displayOrder: 0,
    isActive: true,
  };

  const existingGallery = await app.documents(galleryUid).findMany({
    locale: 'vi',
    filters: { title: { $eq: galleryTitle } },
    limit: 1,
  });

  if (existingGallery[0]) {
    await app.documents(galleryUid).update({
      documentId: existingGallery[0].documentId,
      locale: 'vi',
      data: galleryData,
    });
    await app.documents(galleryUid).publish({
      documentId: existingGallery[0].documentId,
      locale: 'vi',
    });
    summary.record('updated');
    return existingGallery[0];
  }

  const createdGallery = await app.documents(galleryUid).create({
    locale: 'vi',
    data: galleryData,
  });
  await app.documents(galleryUid).publish({
    documentId: createdGallery.documentId,
    locale: 'vi',
  });
  summary.record('created');
  return createdGallery;
}
