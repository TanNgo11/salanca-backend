import { ReservationInboxErrorCode } from './reservation-inbox.types';

export class ReservationInboxError extends Error {
  readonly code: ReservationInboxErrorCode;
  readonly vietnameseMessage: string;

  constructor(
    code: ReservationInboxErrorCode,
    technicalMessage: string,
    vietnameseMessage: string,
  ) {
    super(technicalMessage);
    this.name = 'ReservationInboxError';
    this.code = code;
    this.vietnameseMessage = vietnameseMessage;
  }
}
