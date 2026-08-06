export enum MediaProcessingErrorCode {
  AnimationRejected = 'MEDIA_ANIMATION_REJECTED',
  ConfigInvalid = 'MEDIA_CONFIG_INVALID',
  InputTooLarge = 'MEDIA_INPUT_TOO_LARGE',
  InvalidSignature = 'MEDIA_INVALID_SIGNATURE',
  PixelLimit = 'MEDIA_PIXEL_LIMIT',
  Timeout = 'MEDIA_TIMEOUT',
  TransformFailed = 'MEDIA_TRANSFORM_FAILED',
  UnsupportedCodec = 'MEDIA_UNSUPPORTED_CODEC',
}

export class MediaProcessingError extends Error {
  readonly code: MediaProcessingErrorCode;
  readonly correlationId: string;
  readonly details?: Readonly<Record<string, unknown>>;

  constructor(
    code: MediaProcessingErrorCode,
    correlationId: string,
    details?: Readonly<Record<string, unknown>>,
  ) {
    super(`${code} (${correlationId})`);
    this.name = 'MediaProcessingError';
    this.code = code;
    this.correlationId = correlationId;
    this.details = details;
  }
}

/** Editor-facing message without internal paths or buffers. */
export const toEditorSafeMessage = (error: MediaProcessingError): string => {
  const { correlationId } = error;

  switch (error.code) {
    case MediaProcessingErrorCode.InputTooLarge:
      return `Ảnh vượt quá dung lượng cho phép (mã ${correlationId}).`;
    case MediaProcessingErrorCode.AnimationRejected:
      return `Ảnh động/GIF nhiều khung không được hỗ trợ (mã ${correlationId}).`;
    case MediaProcessingErrorCode.UnsupportedCodec:
      return `Định dạng ảnh không được hỗ trợ (mã ${correlationId}).`;
    case MediaProcessingErrorCode.PixelLimit:
      return `Ảnh có độ phân giải quá lớn (mã ${correlationId}).`;
    case MediaProcessingErrorCode.Timeout:
      return `Xử lý ảnh quá thời gian cho phép (mã ${correlationId}).`;
    case MediaProcessingErrorCode.ConfigInvalid:
      return `Cấu hình xử lý ảnh không hợp lệ (mã ${correlationId}).`;
    default:
      return `Không xử lý được ảnh (mã ${correlationId}).`;
  }
};
