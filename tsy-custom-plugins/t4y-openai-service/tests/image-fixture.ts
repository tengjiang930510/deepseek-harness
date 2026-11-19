/** Loopback file service for keyless attachment admission tests. */
import { createServer } from 'node:http'

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAADElEQVQImWNgZGIGAAAOAAeCcsnOAAAAAElFTkSuQmCC', 'base64')

/** The same test PNG encoded as a FastGPT-style input data URL. */
export const fixtureImageDataUrl = `data:image/png;base64,${png.toString('base64')}`
/** Original file bytes returned without a declared Content-Length. */
export const fixtureFile = Buffer.from('附件原件\n')

/**
 * Serve binary inputs with query tokens and a redirect endpoint.
 * @returns isolated URLs, download count, and awaited cleanup.
 */
export async function startImageFixture() {
  let downloads = 0
  let fileDownloads = 0
  const server = createServer((request, response) => {
    if (request.url === '/files/original?token=fixture' || request.url === '/gateway/api/common/file/read/original.txt?token=fixture') {
      fileDownloads++
      response.writeHead(200, { 'Content-Type': 'application/octet-stream' })
      response.write(fixtureFile)
      response.end()
      return
    }
    if (request.url === '/files/redirect') {
      response.writeHead(302, { Location: '/files/original?token=fixture' }).end()
      return
    }
    if (request.url !== '/image?token=fixture') { response.writeHead(404).end(); return }
    downloads++
    response.writeHead(200, { 'Content-Type': 'application/octet-stream' }).end(png)
  })
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => { server.off('error', reject); resolve() })
  })
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('Image fixture has no TCP address')
  const root = `http://127.0.0.1:${address.port}`
  return {
    origin: root,
    fileUrl: root + '/files/original?token=fixture',
    fastGptFileUrl: root + '/gateway/api/common/file/read/original.txt?token=fixture',
    redirect: root + '/files/redirect',
    fileCount: () => fileDownloads,
    url: root + '/image?token=fixture',
    expired: root + '/expired',
    bytes: png.byteLength,
    count: () => downloads,
    close: () => new Promise<void>((resolve, reject) => server.close(error => error === undefined ? resolve() : reject(error))),
  }
}
