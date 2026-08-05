/**
 * Users-Permissions create actions for public form intake (leads).
 * Separate from content read allowlist on purpose.
 */
export enum PublicFormPermissionAction {
  CreateContactMessage = 'api::contact-message.contact-message.create',
  CreateReservationRequest = 'api::reservation-request.reservation-request.create',
}

export const getPublicFormPermissionActions = (): readonly PublicFormPermissionAction[] => [
  PublicFormPermissionAction.CreateContactMessage,
  PublicFormPermissionAction.CreateReservationRequest,
];
