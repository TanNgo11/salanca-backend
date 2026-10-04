import { AuditLogErrorCode } from './audit-log.types';

export class AuditLogError extends Error {
  readonly code: AuditLogErrorCode;
  readonly vietnameseMessage: string;

  constructor(
    code: AuditLogErrorCode,
    technicalMessage: string,
    vietnameseMessage: string,
  ) {
    super(technicalMessage);
    this.name = 'AuditLogError';
    this.code = code;
    this.vietnameseMessage = vietnameseMessage;
  }
}
