/** Admit original client documents as verbatim Harness attachments. */
import { AttachmentError, type AttachmentStore, type FileAttachmentRef } from '@deepseek-ai/dsh-attachment'
import type { Config } from './config.ts'
import { OpenAiServerError } from './error.ts'
import type { FileUrlPart } from './request.ts'

const fastGptDownloadPath = /\/api\/common\/file\/read(?:\/|$)/u

function tooLarge(): OpenAiServerError {
  return new OpenAiServerError('Input files exceed the configured byte limit.', 'FILE_TOO_LARGE', 413)
}

async function* boundedBytes(body: ReadableStream<Uint8Array>, limit: number): AsyncIterable<Uint8Array> {
  const reader = body.getReader()
  let total = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) return
      total += value.byteLength
      if (total > limit) throw tooLarge()
      yield value
    }
  } finally { reader.releaseLock() }
}

async function download(
  url: URL, name: string | undefined, store: AttachmentStore, limit: number, timeoutMs: number, signal: AbortSignal,
): Promise<FileAttachmentRef> {
  const deadline = AbortSignal.timeout(timeoutMs)
  const transfer = new AbortController()
  const downloadSignal = AbortSignal.any([signal, deadline, transfer.signal])
  try {
    const response = await fetch(url, { signal: downloadSignal, redirect: 'manual' })
    if (response.status !== 200 || response.body === null) {
      throw new OpenAiServerError(`Original file download requires a direct response (HTTP ${response.status}).`, 'FILE_DOWNLOAD_FAILED', 502)
    }
    if (Number(response.headers.get('content-length')) > limit) throw tooLarge()
    return await store.saveFileStream({
      data: boundedBytes(response.body, limit), signal: downloadSignal,
      ...(name ? { name } : {}),
    })
  } catch (error) {
    signal.throwIfAborted()
    if (error instanceof OpenAiServerError) throw error
    if (error instanceof AttachmentError && error.cause instanceof OpenAiServerError) throw error.cause
    // Fetch failures can carry the signed URL.
    const message = deadline.aborted ? 'Original file download timed out.'
      : 'Could not download or save the original file. Check the attachment link and download service.'
    throw new OpenAiServerError(message, 'FILE_DOWNLOAD_FAILED', 502)
  } finally { transfer.abort() }
}

/**
 * Store ordered originals before execution and reuse duplicate sources within the request.
 * @param parts - validated user file blocks from the messages that will be admitted.
 * @param store - attachment store mounted in the openai profile.
 * @param config - configured download sources and transfer limits.
 * @param signal - request cancellation.
 * @returns one durable reference per input block, in input order.
 */
export async function admitFiles(
  parts: readonly FileUrlPart[], store: AttachmentStore | undefined, config: Config, signal: AbortSignal,
): Promise<readonly FileAttachmentRef[]> {
  if (parts.length === 0) return []
  const origins = new Set(config.fileDownloadOrigins)
  const sources = parts.map(({ name, url: raw }) => {
    const url = URL.parse(raw)
    if (url === null || !['http:', 'https:'].includes(url.protocol) || url.username || url.password ||
        (!fastGptDownloadPath.test(url.pathname) && !origins.has(url.origin) &&
          !config.fileDownloadPathPrefixes.some(prefix => (url.origin + url.pathname).startsWith(prefix)))) {
      throw new OpenAiServerError('Original file URL must use HTTP(S) without credentials and match the FastGPT file path or a configured download source.', 'INVALID_FILE_URL', 400)
    }
    return { url, name }
  })
  if (store === undefined) throw new OpenAiServerError('Original file input requires an attachment store.', 'UNAVAILABLE', 503)
  const downloaded = new Map<string, FileAttachmentRef>()
  const refs: FileAttachmentRef[] = []
  let remaining = config.maxInputFileBytes
  for (const { url, name } of sources) {
    signal.throwIfAborted()
    const key = JSON.stringify([url.href, name])
    let ref = downloaded.get(key)
    if (ref === undefined) {
      ref = await download(url, name, store, remaining, config.fileDownloadTimeoutMs, signal)
      remaining -= ref.bytes
      downloaded.set(key, ref)
    }
    refs.push(ref)
  }
  return refs
}
