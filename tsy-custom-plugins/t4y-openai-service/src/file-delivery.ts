/** Request-owned multipart file delivery, independent of the OpenAI transport. */
import { constants } from 'node:fs'
import { open, realpath } from 'node:fs/promises'
import { basename, extname, isAbsolute, relative, resolve, sep } from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import { HarnessError } from '@deepseek-ai/dsh-error'
import { lookup } from 'mime-types'
import { z } from 'zod'
import type { FileUploadConfig } from './file-delivery-config.ts'
export type { FileUploadConfig } from './file-delivery-config.ts'
export { fileDeliveryConfig } from './file-delivery-config.ts'
import { FileDeliveryError } from './file-delivery-error.ts'
export { FileDeliveryError } from './file-delivery-error.ts'

const uploaded = z.object({ code: z.literal(200), data: z.object({ url: z.string().url() }) })
const failure = (message: string, cause?: unknown): FileDeliveryError => new FileDeliveryError(message, { cause })

/** Confirmed publication metadata; the original local file remains intact. */
export interface DeliveredFile {
  readonly name: string
  readonly url: string
  readonly size: number
  readonly mediaType: string
}

/**
 * Classify canonical paths without granting file access or reading file contents.
 * @param root - Real workspace directory path.
 * @param target - Real candidate file path.
 * @returns Whether the target is within the workspace directory.
 */
export function isWorkspacePath(root: string, target: string): boolean {
  const distance = relative(root, target)
  return distance !== '..' && !distance.startsWith(`..${sep}`) && !isAbsolute(distance)
}

async function readDelivery(path: string, config: FileUploadConfig, signal: AbortSignal): Promise<Buffer<ArrayBuffer>> {
  await using file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW)
  const stat = await file.stat()
  if (!stat.isFile() || stat.size === 0 || stat.size > config.maxFileBytes) {
    throw failure('A delivery file is empty, not a regular file, or exceeds the upload size limit.')
  }
  const bytes = Buffer.alloc(stat.size + 1)
  let length = 0
  while (length < bytes.length) {
    signal.throwIfAborted()
    const { bytesRead } = await file.read(bytes, length, bytes.length - length, null)
    if (bytesRead === 0) break
    length += bytesRead
  }
  if (length !== stat.size) throw failure('A delivery file changed or exceeds the upload size limit.')
  return bytes.subarray(0, length)
}

async function upload(path: string, bytes: Buffer<ArrayBuffer>, config: FileUploadConfig, signal: AbortSignal): Promise<string> {
  const form = new FormData()
  form.set('businessKey', config.businessKey)
  const type = lookup(path) || 'application/octet-stream'
  form.set('file', new Blob([bytes], { type }), `${randomUUID()}_${Date.now()}${extname(path)}`)
  const response = await fetch(config.url, {
    method: 'POST', body: form, redirect: 'error',
    signal: AbortSignal.any([signal, AbortSignal.timeout(config.timeoutMs)]),
  })
  if (!response.ok) {
    await response.body?.cancel()
    throw failure(`File upload returned HTTP ${response.status}; remote effects may have occurred. Do not retry automatically.`)
  }
  if (response.body === null) throw failure('File upload returned no response body.')
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  try {
    for (;;) {
      const { value, done } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > config.maxResponseBytes) throw failure('File upload response exceeds the configured limit.')
      chunks.push(value)
    }
  } finally { await reader.cancel(); reader.releaseLock() }
  const result = uploaded.safeParse(JSON.parse(Buffer.concat(chunks).toString('utf8')))
  if (!result.success) throw failure('File upload did not confirm a download URL; remote effects may have occurred.')
  const url = new URL(result.data.data.url)
  if (!['http:', 'https:'].includes(url.protocol)) throw failure('File upload returned an unsupported download URL.')
  return url.href.replace(/[<>\s]/gu, char => encodeURIComponent(char))
}

/** One request's publication budget, exact-content deduplication, and cancellation ownership. */
export class FileDelivery implements AsyncDisposable {
  readonly signal: AbortSignal
  private readonly controller = new AbortController()
  private readonly publications = new Map<string, Promise<DeliveredFile>>()
  private readonly previewUrls = new Map<string, string>()
  private readonly pending = new Set<Promise<DeliveredFile>>()

  /**
   * @param cwd - Workspace whose real file targets may be published.
   * @param config - Validated endpoint, business key, and publication limits.
   * @param signal - Parent request cancellation and deadline.
   * @param notice - Optional public notice before each new publication.
   */
  constructor(
    readonly cwd: string, private readonly config: FileUploadConfig, signal: AbortSignal,
    private readonly notice: (name: string) => void = () => {},
  ) {
    this.signal = AbortSignal.any([signal, this.controller.signal])
  }

  /**
   * Publish one regular file, reusing the same resolved path and bytes within this request.
   * Failed publications stay failed for those bytes; no implicit retry repeats an unknown remote effect.
   * @param path - Existing individual file; relative paths use the workspace.
   * @param signal - Optional additional tool cancellation.
   * @returns Confirmed download URL, original filename, MIME, and byte size.
   */
  deliver(path: string, signal?: AbortSignal): Promise<DeliveredFile> {
    const operation = this.publish(path, signal === undefined ? this.signal : AbortSignal.any([this.signal, signal]))
    this.pending.add(operation)
    return operation.finally(() => { this.pending.delete(operation) })
  }

  /**
   * Resolve a preview path using files already published by this request.
   * @param path - Decoded Markdown destination beginning with `/files/`.
   * @returns The confirmed URL if the preview names a published workspace file.
   */
  previewUrl(path: string): string | undefined {
    return this.previewUrls.get(path)
  }

  private async publish(path: string, signal: AbortSignal): Promise<DeliveredFile> {
    try {
      signal.throwIfAborted()
      const root = await realpath(this.cwd)
      const target = await realpath(resolve(root, path))
      if (!isWorkspacePath(root, target)) {
        throw failure('A delivery file is outside the configured workspace.')
      }
      const bytes = await readDelivery(target, this.config, signal)
      const key = createHash('sha256').update(target).update('\0').update(bytes).digest('hex')
      let publication = this.publications.get(key)
      if (publication === undefined) {
        if (this.publications.size >= this.config.maxFiles) throw new FileDeliveryError('The request exceeds the configured delivery-file count.', { limitExceeded: true })
        publication = (async (): Promise<DeliveredFile> => {
          this.notice(basename(target))
          const url = await upload(target, bytes, this.config, signal)
          return { name: basename(target), url, size: bytes.length, mediaType: lookup(target) || 'application/octet-stream' }
        })()
        this.publications.set(key, publication)
      }
      const result = await publication
      signal.throwIfAborted()
      this.previewUrls.set(`/files/${relative(root, target).split(sep).join('/')}`, result.url)
      return result
    } catch (error) {
      signal.throwIfAborted()
      if (error instanceof HarnessError) throw error
      throw failure('File publication failed; local files were retained and remote effects may have occurred. Do not retry automatically.', error)
    }
  }

  /** Cancel and drain every accepted operation before releasing the request's publication cache. */
  async [Symbol.asyncDispose](): Promise<void> {
    this.controller.abort(failure('File delivery is closing; remote effects may have occurred.'))
    await Promise.allSettled(this.pending)
    this.publications.clear()
    this.previewUrls.clear()
  }
}
