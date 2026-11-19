/** Bounded HTTP body admission and JSON/SSE response delivery. */
import type { IncomingMessage, ServerResponse } from 'node:http'
import { setTimeout as delay } from 'node:timers/promises'
import { OpenAiServerError } from './error.ts'

/**
 * Read one JSON body without retaining bytes beyond the configured limit.
 * @param req - owned incoming request.
 * @param maxBytes - full body byte ceiling.
 * @param signal - upload deadline and server teardown.
 * @returns decoded JSON, still untrusted.
 */
export function readBody(req: IncomingMessage, maxBytes: number, signal: AbortSignal): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let bytes = 0
    const cleanup = (): void => {
      req.off('data', data)
      req.off('end', end)
      req.off('error', fail)
      signal.removeEventListener('abort', abort)
    }
    const fail = (error: unknown): void => {
      cleanup()
      req.resume()
      reject(error instanceof Error ? error : new OpenAiServerError('Request upload failed.', 'INVALID_REQUEST', 400, { cause: error }))
    }
    const abort = (): void => { fail(signal.reason) }
    const data = (chunk: Buffer): void => {
      bytes += chunk.length
      if (bytes > maxBytes) fail(new OpenAiServerError('Request body exceeds the configured byte limit.', 'BODY_LIMIT', 413))
      else chunks.push(chunk)
    }
    const end = (): void => {
      cleanup()
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))) }
      catch (error) { reject(new OpenAiServerError('Request body must be valid JSON.', 'INVALID_REQUEST', 400, { cause: error })) }
    }
    if (signal.aborted) { fail(signal.reason); return }
    req.on('data', data).once('end', end).once('error', fail)
    signal.addEventListener('abort', abort, { once: true })
  })
}

/**
 * Send one JSON response with no-store caching.
 * @param res - response whose headers have not been sent.
 * @param status - HTTP response status.
 * @param body - JSON-safe response envelope.
 * @param maxBufferedBytes - complete encoded body plus pending response bytes.
 */
export function sendJson(res: ServerResponse, status: number, body: object, maxBufferedBytes: number): void {
  const encoded = JSON.stringify(body)
  if (res.destroyed || res.writableLength + Buffer.byteLength(encoded) > maxBufferedBytes) {
    throw new OpenAiServerError('Client response buffer is unavailable or exceeds the configured byte limit.', 'OUTPUT_LIMIT', 502)
  }
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' })
  res.end(encoded)
}

/**
 * Write one complete SSE frame, bounding the full encoded frame and the socket backlog.
 * CRLF delimiters let legacy OpenAI SDKs recognize a frame ending at the current chunk's final byte.
 * @param res - SSE response.
 * @param body - JSON-safe object or the literal completion marker.
 * @param maxBufferedBytes - maximum pending wire bytes.
 */
export function sendFrame(res: ServerResponse, body: object | '[DONE]', maxBufferedBytes: number): void {
  const frame = `data: ${typeof body === 'string' ? body : JSON.stringify(body)}\r\n\r\n`
  if (res.destroyed || res.writableLength + Buffer.byteLength(frame) > maxBufferedBytes) {
    throw new OpenAiServerError('Client response buffer is unavailable or exceeds the configured byte limit.', 'OUTPUT_LIMIT', 502)
  }
  res.write(frame)
}

/**
 * Send completed answer text in paced fragments, preserving every Unicode code point.
 * @param text - the confirmed answer, with file references already resolved.
 * @param delayMs - time between fragments, or zero for a single fragment.
 * @param signal - request deadline, disconnect, or server teardown.
 * @param write - synchronous writer applying the response buffer limit.
 * @returns completion of all content writes.
 */
export async function streamAnswer(text: string, delayMs: number, signal: AbortSignal, write: (fragment: string) => void): Promise<void> {
  signal.throwIfAborted()
  if (text === '') return
  if (delayMs === 0) { write(text); return }
  // Bound playback to 24 frames and keep short replies in a single frame.
  const width = Math.max(96, Math.ceil(text.length / 24))
  let start = 0
  while (start < text.length) {
    if (start > 0) {
      try { await delay(delayMs, undefined, { signal }) }
      catch (error) { signal.throwIfAborted(); throw error }
      signal.throwIfAborted()
    }
    let end = Math.min(start + width, text.length)
    if ((text.codePointAt(end - 1) ?? 0) > 0xffff) end++
    write(text.slice(start, end))
    start = end
  }
}
