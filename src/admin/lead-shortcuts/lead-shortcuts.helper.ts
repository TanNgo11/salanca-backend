const CONTENT_MANAGER_READ_ACTION = 'plugin::content-manager.explorer.read';

export const contactMessageUid = 'api::contact-message.contact-message';
export const reservationRequestUid = 'api::reservation-request.reservation-request';

export const leadListPath = (uid: string): string =>
  `/content-manager/collection-types/${uid}`;

export const leadReadPermissions = (uid: string) => [
  { action: CONTENT_MANAGER_READ_ACTION, subject: uid },
];
