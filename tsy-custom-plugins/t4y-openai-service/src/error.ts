/** Structured failures translated to the OpenAI-compatible error envelope. */
import { FileDeliveryError } from './file-delivery-error.ts'
import { HarnessError } from '@deepseek-ai/dsh-error'

/** HTTP admission, protocol, and Agent execution failure. */
export class OpenAiServerError extends HarnessError {
  constructor(
    message: string,
    code: 'INVALID_REQUEST' | 'UNAUTHORIZED' | 'MODEL_NOT_FOUND' | 'CAPACITY' | 'BODY_LIMIT'
      | 'FILE_UPLOAD_FAILED' | 'IMAGE_DOWNLOAD_FAILED' | 'INVALID_IMAGE' | 'IMAGE_TOO_LARGE' | 'MODEL_IMAGE_UNSUPPORTED'
      | 'INVALID_FILE_URL' | 'FILE_DOWNLOAD_FAILED' | 'FILE_TOO_LARGE'
      | 'SESSION_CONFLICT' | 'OUTPUT_LIMIT' | 'BUDGET' | 'TIMEOUT' | 'CANCELLED' | 'EXECUTION_FAILED' | 'UNAVAILABLE',
    readonly status: number,
    options?: ErrorOptions,
  ) {
    super(message, code, options)
  }
}

/**
 * Redact unexpected implementation failures while retaining their cause for server logging.
 * @param error - rejection from admission, execution, or cleanup.
 * @returns a safe client-facing structured error.
 */
export function publicError(error: unknown): OpenAiServerError {
  if (error instanceof FileDeliveryError) return new OpenAiServerError(error.message, 'FILE_UPLOAD_FAILED', 502, { cause: error })
  return error instanceof OpenAiServerError ? error
    : new OpenAiServerError('Harness execution failed; inspect the server log using the request ID. Effects may have occurred; do not retry automatically.',
      'EXECUTION_FAILED', 500, { cause: error })
}

/**
 * Build the error response shared by JSON and SSE.
 * @param error - safe error selected by the server.
 * @returns an OpenAI-compatible error envelope.
 */
export function errorBody(error: OpenAiServerError): {
  error: { message: string; type: string; param: null; code: string }
} {
  return { error: { message: error.message, type: error.status < 500 ? 'invalid_request_error' : 'server_error',
    param: null, code: error.code } }
}
