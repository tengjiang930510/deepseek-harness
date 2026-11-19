/** Upload parsing owns cancellation and drains rejected bodies without retaining excess bytes. */
import { IncomingMessage, ServerResponse } from 'node:http'
import { Socket } from 'node:net'
import { expect, it, vi } from 'vitest'
import { readBody, sendFrame, sendJson, streamAnswer } from '../src/http.ts'

it('stops answer playback after cancellation and preserves the request reason', async () => {
  const controller = new AbortController()
  const reason = new Error('client disconnected')
  const write = vi.fn(() => controller.abort(reason))
  await expect(streamAnswer('答'.repeat(250), 35, controller.signal, write)).rejects.toBe(reason)
  expect(write).toHaveBeenCalledTimes(1)
})

it.each([false, true])('rejects an aborted upload and removes its listeners: already aborted=%s', async (alreadyAborted) => {
  const req = new IncomingMessage(new Socket())
  const controller = new AbortController()
  try {
    if (alreadyAborted) controller.abort('cancelled upload')
    const body = readBody(req, 16, controller.signal)
    const rejection = expect(body).rejects.toMatchObject({ code: 'INVALID_REQUEST' })
    if (!alreadyAborted) controller.abort('cancelled upload')
    await rejection
    expect(req.listenerCount('data')).toBe(0)
    expect(req.listenerCount('end')).toBe(0)
  } finally { req.destroy() }
})

it('rejects malformed JSON and transport errors independently', async () => {
  for (const transportError of [false, true]) {
    const req = new IncomingMessage(new Socket())
    try {
      const body = readBody(req, 16, new AbortController().signal)
      const rejection = transportError ? expect(body).rejects.toThrow('upload failed')
        : expect(body).rejects.toMatchObject({ code: 'INVALID_REQUEST', status: 400 })
      if (transportError) req.emit('error', new Error('upload failed'))
      else { req.emit('data', Buffer.from('{')); req.emit('end') }
      await rejection
      expect(req.listenerCount('data')).toBe(0)
    } finally { req.destroy() }
  }
})

it('bounds the complete encoded JSON body, including escaping and multibyte text', () => {
  const req = new IncomingMessage(new Socket())
  const response = new ServerResponse(req)
  try {
    const body = { text: '你好"\n' }
    const exact = Buffer.byteLength(JSON.stringify(body))
    expect(() =>{  sendJson(response, 200, body, exact - 1) }).toThrow('byte limit')
    expect(response.headersSent).toBe(false)
    sendJson(response, 200, body, exact)
    expect(response.statusCode).toBe(200)
    expect(response.writableEnded).toBe(true)
  } finally { response.destroy(); req.destroy() }
})

it.each([{ choices: [{ delta: { reasoning_content: '正在执行' } }] }, '[DONE]' as const])(
  'uses complete CRLF frames and includes their delimiters in the byte limit: %j', (body) => {
    const req = new IncomingMessage(new Socket())
    const response = new ServerResponse(req)
    const write = vi.spyOn(response, 'write').mockReturnValue(true)
    try {
      const encoded = typeof body === 'string' ? body : JSON.stringify(body)
      const frame = `data: ${encoded}\r\n\r\n`
      const exact = Buffer.byteLength(frame)
      expect(() => { sendFrame(response, body, exact - 1) }).toThrow('byte limit')
      expect(write).not.toHaveBeenCalled()
      sendFrame(response, body, exact)
      expect(write).toHaveBeenCalledExactlyOnceWith(frame)
    } finally { write.mockRestore(); response.destroy(); req.destroy() }
  },
)
