/** Structured publication failure shared by delivery tools and transport adapters. */
import { HarnessError } from '@deepseek-ai/dsh-error'

/** Local files are retained; a failed upload may already have produced a remote object. */
export class FileDeliveryError extends HarnessError {
  /** Whether the request exhausted its publication count before this upload started. */
  readonly limitExceeded: boolean

  constructor(message: string, options?: ErrorOptions & { limitExceeded?: boolean }) {
    super(message, 'FILE_UPLOAD_FAILED', options)
    this.limitExceeded = options?.limitExceeded ?? false
  }
}
