/**
 * Standard plugin errors. Every service throws `OrderingError` with a stable code so routes and
 * job consumers can map failures without string matching. `details` carries machine-readable
 * context only — never names, phone numbers, emails, addresses or tokens.
 */
export type OrderingErrorCode =
  | 'MONEY_OUT_OF_RANGE'
  | 'CURRENCY_MISMATCH'
  | 'MONEY_INVALID'
  | 'TOTALS_MISMATCH'
  | 'PRICE_CHANGED'
  | 'SELLABLE_UNAVAILABLE'
  | 'SELLABLE_NOT_FOUND'
  | 'LINE_INVALID'
  | 'MIXED_WORKFLOW_UNSUPPORTED'
  | 'WORKFLOW_INVALID'
  | 'WORKFLOW_NOT_REGISTERED'
  | 'INVALID_TRANSITION'
  | 'ORDER_NOT_FOUND'
  | 'BRANCH_NOT_FOUND'
  | 'BRANCH_CODE_IMMUTABLE'
  | 'LOCATION_UNAVAILABLE'
  | 'SCOPE_REQUIRED'
  | 'CONSENT_REQUIRED'
  | 'IDEMPOTENCY_PAYLOAD_MISMATCH'
  | 'IDEMPOTENCY_IN_PROGRESS'
  | 'PAYMENT_NOT_FOUND'
  | 'PAYMENT_EVENT_DUPLICATE'
  | 'REFUND_EXCEEDS_CAPTURED'
  | 'REFUND_LINE_INVALID'
  | 'LINE_QUANTITY_EXCEEDED'
  | 'PROVIDER_NOT_REGISTERED'
  | 'PRODUCT_TYPE_NOT_REGISTERED'
  | 'HOLD_NOT_FOUND'
  | 'VALIDATION_ERROR'
  | 'INTERNAL';

const defaultStatus: Record<OrderingErrorCode, number> = {
  MONEY_OUT_OF_RANGE: 400,
  CURRENCY_MISMATCH: 400,
  MONEY_INVALID: 400,
  TOTALS_MISMATCH: 500,
  PRICE_CHANGED: 409,
  SELLABLE_UNAVAILABLE: 400,
  SELLABLE_NOT_FOUND: 404,
  LINE_INVALID: 400,
  MIXED_WORKFLOW_UNSUPPORTED: 400,
  WORKFLOW_INVALID: 500,
  WORKFLOW_NOT_REGISTERED: 500,
  INVALID_TRANSITION: 409,
  ORDER_NOT_FOUND: 404,
  BRANCH_NOT_FOUND: 404,
  BRANCH_CODE_IMMUTABLE: 400,
  LOCATION_UNAVAILABLE: 400,
  SCOPE_REQUIRED: 403,
  CONSENT_REQUIRED: 400,
  IDEMPOTENCY_PAYLOAD_MISMATCH: 409,
  IDEMPOTENCY_IN_PROGRESS: 409,
  PAYMENT_NOT_FOUND: 404,
  PAYMENT_EVENT_DUPLICATE: 409,
  REFUND_EXCEEDS_CAPTURED: 409,
  REFUND_LINE_INVALID: 400,
  LINE_QUANTITY_EXCEEDED: 409,
  PROVIDER_NOT_REGISTERED: 500,
  PRODUCT_TYPE_NOT_REGISTERED: 500,
  HOLD_NOT_FOUND: 404,
  VALIDATION_ERROR: 400,
  INTERNAL: 500,
};

export class OrderingError extends Error {
  readonly code: OrderingErrorCode;
  readonly status: number;
  readonly details?: Record<string, unknown>;

  constructor(
    code: OrderingErrorCode,
    message: string,
    options?: { status?: number; details?: Record<string, unknown>; cause?: unknown },
  ) {
    super(message, options?.cause === undefined ? undefined : { cause: options.cause });
    this.name = 'OrderingError';
    this.code = code;
    this.status = options?.status ?? defaultStatus[code];
    this.details = options?.details;
  }

  toApiError(requestId: string): {
    code: OrderingErrorCode;
    message: string;
    details?: Record<string, unknown>;
    requestId: string;
  } {
    return {
      code: this.code,
      message: this.message,
      ...(this.details === undefined ? {} : { details: this.details }),
      requestId,
    };
  }
}

export const isOrderingError = (error: unknown): error is OrderingError =>
  error instanceof OrderingError;
