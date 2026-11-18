/** File publication uses isolated files and controlled HTTP responses, without external uploads. */
import { mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { FileDelivery } from '../src/file-delivery.ts'
import { publishFiles as rewriteReferences } from '../src/files.ts'
import type { FileUploadConfig } from '../src/config.ts'

const config: FileUploadConfig = {
  enabled: true, url: 'https://upload.example.test/files', businessKey: 'zhjl',
  maxFileBytes: 1024, maxFiles: 2, timeoutMs: 30000, maxResponseBytes: 1024,
}
async function publishFiles(
  text: string, cwd: string, settings: FileUploadConfig, signal: AbortSignal, notice: (name: string) => void,
) {
  await using delivery = new FileDelivery(cwd, settings, signal, notice)
  return await rewriteReferences(text, delivery)
}
let root: string
const signal = new AbortController().signal
beforeEach(async () => { root = await mkdtemp(join(tmpdir(), 'dsh-publish-files-')) })
afterEach(async () => { vi.restoreAllMocks(); await rm(root, { recursive: true, force: true }) })
function successful() {
  return vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url, request) => {
    const form = request?.body
    expect(form).toBeInstanceOf(FormData)
    if (!(form instanceof FormData)) throw new Error('Expected multipart upload')
    expect(form.get('businessKey')).toBe('zhjl')
    const file = form.get('file')
    if (!(file instanceof File)) throw new Error('Expected file part')
    expect(file.name).toMatch(/^[a-f\d-]+_\d+\.(png|pdf|txt)$/)
    expect(await file.text()).toBe('example')
    return Response.json({ code: 200, data: { url: 'https://files.example.test/delivery' } })
  })
}
it('uploads images and documents once per resolved file and keeps originals', async () => {
  await writeFile(join(root, '标志.png'), 'example')
  await writeFile(join(root, 'report.pdf'), 'example')
  const fetch = successful()
  const notices: string[] = []
  const output = await publishFiles('![图](标志.png)\n[文档](report.pdf)\n`report.pdf`', root, config, signal, n => notices.push(n))
  expect(fetch).toHaveBeenCalledTimes(2)
  expect(output).toBe('![图](<https://files.example.test/delivery>)\n[文档](<https://files.example.test/delivery>)\n[report.pdf](<https://files.example.test/delivery>)')
  expect(notices).toEqual(['标志.png', 'report.pdf'])
  expect(await readFile(join(root, '标志.png'), 'utf8')).toBe('example')
  const calls = fetch.mock.calls
  const first = calls[0]?.[1]?.body
  const second = calls[1]?.[1]?.body
  const png = first instanceof FormData ? first.get('file') : null
  const pdf = second instanceof FormData ? second.get('file') : null
  expect(png instanceof File ? png.type : undefined).toBe('image/png')
  expect(pdf instanceof File ? pdf.type : undefined).toBe('application/pdf')
})
it('preserves external links, directories and code blocks, and supports reference links', async () => {
  await writeFile(join(root, 'note.txt'), 'example')
  const fetch = successful()
  const text = '[官网](https://example.test) `100%` [目录](.)\n```\nnote.txt\n```\n[下载][doc]\n\n[doc]: note.txt'
  const output = await publishFiles(text, root, config, signal, () => {})
  expect(output).toBe(text.replace('[doc]: note.txt', '[doc]: <https://files.example.test/delivery>'))
  expect(fetch).toHaveBeenCalledTimes(1)
})
it('rejects symlink escapes before upload', async () => {
  const fetch = successful()
  await symlink(new URL(import.meta.url), join(root, 'outside'))
  await expect(publishFiles('[外部](outside)', root, config, signal, () => {})).rejects.toMatchObject({ code: 'FILE_UPLOAD_FAILED' })
  expect(fetch).not.toHaveBeenCalled()
})
it('rejects empty and oversized files before upload', async () => {
  const fetch = successful()
  for (const text of ['', 'x'.repeat(1025)]) {
    await writeFile(join(root, 'large.txt'), text)
    await expect(publishFiles('[文件](large.txt)', root, config, signal, () => {})).rejects.toMatchObject({ code: 'FILE_UPLOAD_FAILED' })
  }
  expect(fetch).not.toHaveBeenCalled()
})
it.each([
  () => new Response('unavailable', { status: 503 }),
  () => Response.json({ code: 500, data: null }),
  () => Response.json({ code: 200, data: { url: 'javascript:alert(1)' } }),
  () => new Response('x'.repeat(1025)),
  () => new Response('not-json'),
])('reports an unconfirmed upload without deleting the original', async response => {
  await writeFile(join(root, 'file.txt'), 'example')
  vi.spyOn(globalThis, 'fetch').mockImplementation(async () => response())
  await expect(publishFiles('[文件](file.txt)', root, config, signal, () => {})).rejects.toMatchObject({ code: 'FILE_UPLOAD_FAILED' })
  expect(await readFile(join(root, 'file.txt'), 'utf8')).toBe('example')
})
it('stops on cancellation and limits the number of publications', async () => {
  await writeFile(join(root, 'a.txt'), 'example')
  await writeFile(join(root, 'b.txt'), 'example')
  const fetch = successful()
  const controller = new AbortController()
  const error = new Error('cancelled')
  controller.abort(error)
  await expect(publishFiles('[文件](a.txt)', root, config, controller.signal, () => {})).rejects.toBe(error)
  expect(fetch).not.toHaveBeenCalled()
  await expect(publishFiles('[a](a.txt) [b](b.txt)', root, { ...config, maxFiles: 1 }, signal, () => {})).rejects.toMatchObject({ code: 'FILE_UPLOAD_FAILED' })
  expect(fetch).toHaveBeenCalledTimes(1)
})

it('cancels an in-flight upload, awaits its rejection and keeps the file', async () => {
  await writeFile(join(root, 'file.txt'), 'example')
  const entered = Promise.withResolvers<void>()
  const fetch = vi.spyOn(globalThis, 'fetch').mockImplementation((_url, request) => new Promise((_resolve, reject) => {
    const requestSignal = request?.signal
    if (requestSignal === undefined || requestSignal === null) throw new Error('Upload needs cancellation')
    requestSignal.addEventListener('abort', () => reject(requestSignal.reason), { once: true })
    entered.resolve()
  }))
  const controller = new AbortController()
  const error = new Error('cancelled during upload')
  const publication = publishFiles('[文件](file.txt)', root, config, controller.signal, () => {})
  const rejected = expect(publication).rejects.toBe(error)
  await entered.promise
  controller.abort(error)
  await rejected
  expect(fetch).toHaveBeenCalledTimes(1)
  expect(await readFile(join(root, 'file.txt'), 'utf8')).toBe('example')
})


it('publishes image previews nested in external and local links without duplicate uploads', async () => {
  await writeFile(join(root, 'logo.png'), 'example')
  const fetch = successful()
  const text = '[![logo](logo.png)](https://example.test) [![logo](logo.png)](logo.png)'
  expect(await publishFiles(text, root, config, signal, () => {})).toBe(
    '[![logo](<https://files.example.test/delivery>)](https://example.test) '
      + '[![logo](<https://files.example.test/delivery>)](<https://files.example.test/delivery>)',
  )
  expect(fetch).toHaveBeenCalledTimes(1)
})

it('shares a publication with Markdown fallback and republishes changed bytes', async () => {
  await writeFile(join(root, 'file.txt'), 'example')
  const bodies: string[] = []
  const fetch = vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url, request) => {
    const form = request?.body
    const file = form instanceof FormData ? form.get('file') : null
    if (!(file instanceof File)) throw new Error('Expected file part')
    bodies.push(await file.text())
    return Response.json({ code: 200, data: { url: `https://files.example.test/${bodies.length}` } })
  })
  await using delivery = new FileDelivery(root, config, signal)
  const first = await delivery.deliver('file.txt')
  expect(first).toEqual({ name: 'file.txt', url: 'https://files.example.test/1', size: 7, mediaType: 'text/plain' })
  expect(await rewriteReferences('[文件](file.txt)', delivery)).toBe('[文件](<https://files.example.test/1>)')
  expect(fetch).toHaveBeenCalledTimes(1)
  await writeFile(join(root, 'file.txt'), 'updated')
  expect((await delivery.deliver('./file.txt')).url).toBe('https://files.example.test/2')
  expect(bodies).toEqual(['example', 'updated'])
})

it('does not retry an unconfirmed publication of the same bytes', async () => {
  await writeFile(join(root, 'file.txt'), 'example')
  const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('unavailable', { status: 503 }))
  await using delivery = new FileDelivery(root, config, signal)
  for (let call = 0; call < 2; call++) {
    await expect(delivery.deliver('file.txt')).rejects.toMatchObject({ code: 'FILE_UPLOAD_FAILED' })
  }
  expect(fetch).toHaveBeenCalledTimes(1)
})

it('drains accepted uploads on disposal and rejects later delivery', async () => {
  await writeFile(join(root, 'file.txt'), 'example')
  const entered = Promise.withResolvers<void>()
  let aborted = false
  const fetch = vi.spyOn(globalThis, 'fetch').mockImplementation((_url, request) => new Promise((_resolve, reject) => {
    const requestSignal = request?.signal
    if (requestSignal === undefined || requestSignal === null) throw new Error('Upload needs cancellation')
    requestSignal.addEventListener('abort', () => { aborted = true; reject(requestSignal.reason) }, { once: true })
    entered.resolve()
  }))
  await using delivery = new FileDelivery(root, config, signal)
  const operation = delivery.deliver('file.txt')
  const failure = expect(operation).rejects.toMatchObject({ code: 'FILE_UPLOAD_FAILED' })
  await entered.promise
  await delivery[Symbol.asyncDispose]()
  await failure
  expect(aborted).toBe(true)
  await expect(delivery.deliver('file.txt')).rejects.toMatchObject({ code: 'FILE_UPLOAD_FAILED' })
  expect(fetch).toHaveBeenCalledTimes(1)
})

it('keeps outside-workspace original-path descriptions after a confirmed delivery', async () => {
  const originals = await mkdtemp(join(tmpdir(), 'dsh-original-file-'))
  try {
    const original = join(originals, '原始文档.pdf')
    await writeFile(original, 'example')
    await writeFile(join(root, 'delivery.pdf'), 'example')
    await symlink(original, join(root, 'original-alias.pdf'))
    const fetch = successful()
    await using delivery = new FileDelivery(root, config, signal)
    const published = await delivery.deliver('delivery.pdf')
    const text = `[下载](<${published.url}>)\n原文件仍在桌面：\`${original}\`\n别名：\`original-alias.pdf\``
    expect(await rewriteReferences(text, delivery)).toBe(text)
    expect(fetch).toHaveBeenCalledTimes(1)
    await expect(delivery.deliver(original)).rejects.toMatchObject({ code: 'FILE_UPLOAD_FAILED' })
    await expect(rewriteReferences(`[下载原件](<${original}>)`, delivery)).rejects.toMatchObject({ code: 'FILE_UPLOAD_FAILED' })
    expect(fetch).toHaveBeenCalledTimes(1)
  } finally { await rm(originals, { recursive: true, force: true }) }
})
