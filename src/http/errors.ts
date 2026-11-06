export type ErrorCode =
  | 'INVALID_UPLOAD'
  | 'NO_FILE'
  | 'WRONG_FIELD'
  | 'EMPTY_FILE'
  | 'FILE_TOO_LARGE'
  | 'NOT_AN_MP3'
  | 'UNSUPPORTED_MPEG_FORMAT'
  | 'NOT_FOUND'
  | 'METHOD_NOT_ALLOWED'
  | 'INTERNAL_ERROR';

/** The JSON body of every error response. */
export interface ErrorBody {
  error: { code: ErrorCode; message: string };
}

/** An error whose status, code and message are safe to send to the client as-is. */
export class HttpError extends Error {
  override name = 'HttpError';

  constructor(
    readonly statusCode: number,
    readonly code: ErrorCode,
    message: string,
  ) {
    super(message);
  }

  toBody(): ErrorBody {
    return { error: { code: this.code, message: this.message } };
  }
}

/**
 * Translates an error thrown anywhere while handling a request into an HttpError.
 * Anything unrecognised becomes a generic 500, so internal details never reach the client.
 */
export function toHttpError(error: unknown, maxFileSizeBytes: number): HttpError {
  if (error instanceof HttpError) return error;

  const code = typeof error === 'object' && error !== null && 'code' in error ? error.code : null;
  switch (code) {
    case 'FST_REQ_FILE_TOO_LARGE':
      return fileTooLarge(maxFileSizeBytes);
    case 'FST_INVALID_MULTIPART_CONTENT_TYPE':
    case 'FST_ERR_CTP_INVALID_MEDIA_TYPE':
    case 'FST_ERR_CTP_EMPTY_TYPE':
      return new HttpError(
        400,
        'INVALID_UPLOAD',
        'Send the file as multipart/form-data, in a field named "file".',
      );
    case 'FST_FILES_LIMIT':
    case 'FST_PARTS_LIMIT':
    case 'FST_FIELDS_LIMIT':
      return new HttpError(
        400,
        'INVALID_UPLOAD',
        'Send exactly one file, in a field named "file".',
      );
  }

  // Malformed multipart bodies surface as plain busboy errors without a code.
  const message = error instanceof Error ? error.message : '';
  if (/multipart|boundary|malformed|unexpected end of form|terminated early/i.test(message)) {
    return new HttpError(400, 'INVALID_UPLOAD', 'The multipart/form-data body is malformed.');
  }

  // Any other client error from Fastify (e.g. an unparseable JSON body sent to this route).
  const statusCode =
    typeof error === 'object' && error !== null && 'statusCode' in error ? error.statusCode : null;
  if (typeof statusCode === 'number' && statusCode >= 400 && statusCode < 500) {
    return new HttpError(
      400,
      'INVALID_UPLOAD',
      'Send the file as multipart/form-data, in a field named "file".',
    );
  }

  return new HttpError(500, 'INTERNAL_ERROR', 'Something went wrong while processing the file.');
}

export function fileTooLarge(maxFileSizeBytes: number): HttpError {
  return new HttpError(
    413,
    'FILE_TOO_LARGE',
    `The file is larger than the ${formatBytes(maxFileSizeBytes)} limit.`,
  );
}

function formatBytes(bytes: number): string {
  const mb = bytes / (1024 * 1024);
  return mb >= 1 ? `${Number(mb.toFixed(1))} MB` : `${bytes.toLocaleString('en-US')} bytes`;
}
