import { collection } from '../internal';

/**
 * One rating per order (`order_id` unique in migration 0008). `messageLocale` is not
 * named `locale` — Strapi i18n reserves that attribute. The comment is deleted by the
 * retention job after `ratingCommentDays`; the stars stay.
 */
export default collection(
  'order-rating',
  {
    orderId: { type: 'integer', required: true },
    locationRef: { type: 'string', required: true },
    stars: { type: 'integer', required: true, min: 1, max: 5 },
    tags: { type: 'json', required: true },
    comment: { type: 'text' },
    messageLocale: { type: 'string', required: true },
    status: {
      type: 'enumeration',
      enum: ['visible', 'hidden'],
      required: true,
      default: 'visible',
    },
    staffNote: { type: 'text' },
    staffNoteBy: { type: 'string' },
    ratedAt: { type: 'datetime', required: true },
    editableUntil: { type: 'datetime', required: true },
  },
  { displayName: 'Đánh giá đơn' },
);
