/** Read Chat Completions image inputs and admit them through the Harness attachment store. */
import type { AttachmentStore, ImageAttachmentRef, ImageMediaType, SaveImageAttachment } from '@deepseek-ai/dsh-attachment'
import { isImageAdmissionError } from '@deepseek-ai/dsh-attachment'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import type { Config } from './config.ts'
import { OpenAiServerError } from './error.ts'
import { admitFiles } from './input-files.ts'
import type { ChatRequest, UserContent } from './request.ts'

function mediaType(data: Buffer): ImageMediaType {
  if (data.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'))) return 'image/png'
  if (data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) return 'image/jpeg'
  const prefix = data.toString('ascii', 0, 12)
  if (prefix.startsWith('GIF87a') || prefix.startsWith('GIF89a')) return 'image/gif'
  if (prefix.startsWith('RIFF') && prefix.endsWith('WEBP')) return 'image/webp'
  throw new OpenAiServerError('Image URL must contain a PNG, JPEG, WebP, or GIF image.', 'INVALID_IMAGE', 400)
}

type ImageSource = { url: URL } | { encoded: string; declaredType: string }

function imageSource(value: string): ImageSource {
  const inline = /^data:(image\/(?:png|jpe?g|webp|gif)|application\/octet-stream);base64,/iu.exec(value)
  if (inline?.[1] !== undefined) {
    const declaredType = inline[1].toLowerCase()
    return { encoded: value.slice(inline[0].length), declaredType: declaredType === 'image/jpg' ? 'image/jpeg' : declaredType }
  }
  const url = URL.parse(value)
  if (url === null || (url.protocol !== 'http:' && url.protocol !== 'https:') || url.username !== '' || url.password !== '') {
    throw new OpenAiServerError('Use an absolute HTTP(S) image URL without embedded credentials or a Base64 image data URL.', 'INVALID_IMAGE', 400)
  }
  return { url }
}

function imageTooLarge(): OpenAiServerError {
  return new OpenAiServerError('Input images exceed the configured byte limit.', 'IMAGE_TOO_LARGE', 413)
}

function decodeInlineImage(source: Extract<ImageSource, { encoded: string }>, maxBytes: number): SaveImageAttachment {
  if (Buffer.byteLength(source.encoded, 'base64') > maxBytes) throw imageTooLarge()
  const data = Buffer.from(source.encoded, 'base64')
  if (data.length === 0 || data.toString('base64') !== source.encoded) {
    throw new OpenAiServerError('Image data URL must contain valid Base64 image data.', 'INVALID_IMAGE', 400)
  }
  const detected = mediaType(data)
  if (source.declaredType !== 'application/octet-stream' && detected !== source.declaredType) {
    throw new OpenAiServerError('Declared image type does not match its bytes.', 'INVALID_IMAGE', 400)
  }
  return { data, mediaType: detected }
}

async function download(url: URL, maxBytes: number, timeoutMs: number, signal: AbortSignal): Promise<SaveImageAttachment> {
  const deadline = AbortSignal.timeout(timeoutMs)
  const downloadSignal = AbortSignal.any([signal, deadline])
  try {
    const response = await fetch(url, { signal: downloadSignal, redirect: 'manual' })
    if (!response.ok || response.body === null) {
      await response.body?.cancel()
      throw new OpenAiServerError(`Image download failed (HTTP ${response.status}).`, 'IMAGE_DOWNLOAD_FAILED', 502)
    }
    if (Number(response.headers.get('content-length')) > maxBytes) {
      await response.body.cancel()
      throw imageTooLarge()
    }
    const chunks: Uint8Array[] = []
    let bytes = 0
    const reader = response.body.getReader()
    try {
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        bytes += value.byteLength
        if (bytes > maxBytes) {
          await reader.cancel()
          throw imageTooLarge()
        }
        chunks.push(value)
      }
    } finally { reader.releaseLock() }
    const data = Buffer.concat(chunks, bytes)
    return { data, mediaType: mediaType(data) }
  } catch (error) {
    signal.throwIfAborted()
    if (error instanceof OpenAiServerError) throw error
    // Fetch errors may contain the signed image URL.
    const message = deadline.aborted ? 'Image download timed out.' : 'Could not download the image. Check the file URL and network access.'
    throw new OpenAiServerError(message, 'IMAGE_DOWNLOAD_FAILED', 502)
  }
}

/** Ordered text and attachment blocks ready for model messages and Session history. */
export interface AdmittedChatInput {
  input: readonly ContentBlock[]
  history: { role: 'user' | 'assistant'; content: readonly ContentBlock[] }[]
}

/**
 * Prepare the current turn and, for a new Session, its imported history before creating the Agent.
 * @param request - validated input and client history.
 * @param importHistory - whether the Session has no durable history yet.
 * @param canUseImages - whether model metadata permits visual inputs.
 * @param attachments - deployment attachment store, when present.
 * @param config - input attachment and download limits.
 * @param signal - request cancellation and deadline.
 * @returns the current user content and prior messages with durable attachment references.
 */
export async function admitChatInput(
  request: ChatRequest, importHistory: boolean, canUseImages: boolean, attachments: AttachmentStore | undefined,
  config: Config, signal: AbortSignal,
): Promise<AdmittedChatInput> {
  const history = importHistory ? request.history : []
  const messages = [...history.map(message => message.content), request.input]
  const sources = messages.flatMap(content => typeof content === 'string' ? []
    : content.flatMap(part => part.type === 'image_url' ? [imageSource(part.image_url.url)] : []))
  let refs: readonly ImageAttachmentRef[] = []
  if (sources.length > 0) {
    if (!canUseImages) throw new OpenAiServerError('The configured model does not support image input.', 'MODEL_IMAGE_UNSUPPORTED', 400)
    if (attachments === undefined) throw new OpenAiServerError('Image input requires an attachment store.', 'UNAVAILABLE', 503)
    const limits = attachments.imageLimits
    if (sources.length > limits.maxImagesPerMessage) {
      throw new OpenAiServerError('Too many images in this request.', 'IMAGE_TOO_LARGE', 413)
    }
    let remaining = Math.min(config.maxInputImageBytes, limits.maxMessageImageBytes)
    const images: SaveImageAttachment[] = []
    for (const source of sources) {
      if (remaining === 0) throw imageTooLarge()
      signal.throwIfAborted()
      const maxBytes = Math.min(remaining, limits.maxImageBytes)
      const image = 'url' in source ? await download(source.url, maxBytes, config.imageDownloadTimeoutMs, signal)
        : decodeInlineImage(source, maxBytes)
      remaining -= image.data.byteLength
      images.push(image)
    }
    signal.throwIfAborted()
    try { refs = await attachments.saveImages(images) }
    catch (error) {
      if (isImageAdmissionError(error)) throw new OpenAiServerError(error.message, 'INVALID_IMAGE', 400, { cause: error })
      throw error
    }
  }
  const files = await admitFiles(messages.flatMap(content => typeof content === 'string' ? []
    : content.filter(part => part.type === 'file_url')), attachments, config, signal)
  signal.throwIfAborted()
  let next = 0
  let nextFile = 0
  const resolve = (content: UserContent): readonly ContentBlock[] =>
    typeof content === 'string' ? [{ type: 'text', text: content }] : content.map(part => {
      if (part.type === 'text') return part
      if (part.type === 'file_url') {
        const attachment = files[nextFile++]
        if (attachment === undefined) throw new Error('Missing confirmed file attachment.')
        return { type: 'file', attachment }
      }
      const attachment = refs[next++]
      if (attachment === undefined) throw new Error('Missing confirmed image attachment.')
      return { type: 'image', attachment }
    })
  const imported = history.map(({ role, content }) => ({ role, content: resolve(content) }))
  return { input: resolve(request.input), history: imported }
}
