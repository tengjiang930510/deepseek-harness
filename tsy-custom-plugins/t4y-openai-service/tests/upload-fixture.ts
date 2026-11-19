/** Loopback multipart sink for keyless file-delivery tests. */
import { createServer } from 'node:http'

/**
 * Start an isolated uploader that drains each request before confirming a fixed public URL.
 * @param status - HTTP status sent after draining the upload.
 * @returns the ephemeral endpoint, upload count, and awaited server cleanup.
 */
export async function startUploadFixture(status = 200) {
  let uploads = 0
  const server = createServer((request, response) => {
    void (async () => {
      for await (const _chunk of request) { /* Drain the multipart body before confirming publication. */ }
      uploads++
      response.writeHead(status, { 'Content-Type': 'application/json' })
      response.end(JSON.stringify({ code: 200, data: { url: 'https://files.example.test/delivery' } }))
    })().catch((error: Error) => response.destroy(error))
  })
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => { server.off('error', reject); resolve() })
  })
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('Upload fixture has no TCP address')
  return {
    url: `http://127.0.0.1:${address.port}`,
    count: () => uploads,
    close: () => new Promise<void>((resolve, reject) => server.close(error => error === undefined ? resolve() : reject(error))),
  }
}
