/** Structured publication failure shared by delivery tools and transport adapters. */
import { HarnessError } from '@deepseek-ai/dsh-error'

/** Local files are retained; a failed upload may already have produced a remote object. */
export class FileDeliveryError extends HarnessError {
  constructor(message: string, options?: ErrorOptions) { super(message, 'FILE_UPLOAD_FAILED', options) }
}
