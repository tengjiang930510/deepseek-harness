/** Config defaults survive whole-entry profile replacements without touching user profile files. */
import { expect, it } from 'vitest'
import { applyEntryPatches } from '@deepseek-ai/cordis-plugin-include'
import z from '@deepseek-ai/schemastery'
import { Config } from '../src/config.ts'

const parse = (value: unknown) => z.resolve(value, Config, {})[0]

const models = [{ id: 'harness', provider: 'fixture', model: 'fixture', cwd: '/workspace', tools: [], maxTokens: 128 }]

it('enables upload after a profile replaces the entry config with only models', () => {
  const { data: entries } = applyEntryPatches([], [
    { insert: [{ id: 'openai-server', name: 't4y-openai-service', config: { models, fileUpload: { enabled: false } } }] },
    { id: 'openai-server', config: { models } },
  ], message => { throw new Error(message) })
  const raw = entries[0]?.config
  expect(raw).toEqual({ models })
  const resolved = parse(raw)
  expect(resolved.fileUpload).toEqual({
    enabled: true,
    url: process.env.DSH_FILE_UPLOAD_URL ?? 'https://jgyw.crfsdi.com.cn:51111/backendapi/file/anonymous-upload',
    businessKey: 'zhjl-deepseek-harness', maxFileBytes: 52428800, maxFiles: 10, timeoutMs: 60000, maxResponseBytes: 65536,
  })
  expect(resolved).toMatchObject({ maxInputFileBytes: 52428800, fileDownloadTimeoutMs: 60000 })
  expect(resolved.models).toEqual(models)
  expect(raw).toEqual({ models })
})

it('keeps explicit upload disablement', () => {
  expect(parse({ models, fileUpload: { enabled: false } }).fileUpload).toEqual({ enabled: false })
})

it('resolves partial upload overrides without losing the other defaults', () => {
  expect(parse({ models, fileUpload: { url: 'https://upload.example.test/custom', maxFiles: 3 } }).fileUpload).toMatchObject({
    enabled: true, url: 'https://upload.example.test/custom', maxFiles: 3, businessKey: 'zhjl-deepseek-harness', timeoutMs: 60000,
  })
})

it.each([{ maxFiles: 0 }, { maxFileBytes: -1 }, { timeoutMs: 0 }, { maxResponseBytes: 1.5 }, { enabled: 'false' }])(
  'rejects invalid upload overrides: %j', fileUpload => {
    expect(() => parse({ models, fileUpload })).toThrow()
  },
)

it('defaults to eight execution slots, a 30-minute queue deadline, and a 25-minute execution budget', () => {
  expect(parse({ models })).toMatchObject({ maxConcurrent: 8, queueTimeoutMs: 1800000, requestTimeoutMs: 1500000 })
  expect(parse({ models, queueTimeoutMs: 5000 }).queueTimeoutMs).toBe(5000)
  expect(() => parse({ models, queueTimeoutMs: 0 })).toThrow()
})
