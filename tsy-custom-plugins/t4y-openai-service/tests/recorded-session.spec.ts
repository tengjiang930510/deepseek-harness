/** Recorded-session replay through the real dsh openai profile and its public HTTP protocol. */
import { mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, it } from 'vitest'
import { brandString } from '@deepseek-ai/dsh-brand'
import { resolveSessionTarget } from '../src/conversation.ts'
import type { ConversationId } from '../src/request.ts'
import { startUploadFixture } from './upload-fixture.ts'
import { fixtureFile, fixtureImageDataUrl, startImageFixture } from './image-fixture.ts'
import { startOpenAiProfile } from './profile/fixture.ts'
import { parseSessionLog } from '@deepseek-ai/dsh-llm-replay'
import {
  formatSystemPromptSnapshot, formatToolSchemasSnapshot, latestPersistedSessionPaths,
  materializeProfilePatch, normalizeSessionLog, normalizedSystemPrompts, normalizedToolSchemas, redactSessionSnapshotIds, scrubSessionSnapshot,
} from '@deepseek-ai/dsh-session-snapshot'

it.each([false, true])('openai: resumes one conversation over HTTP and preserves tool history; file delivery=%s', async fileDelivery => {
  const scenario = fileURLToPath(new URL(fileDelivery ? './fixtures/file-delivery/' : './fixtures/tool-turn/', import.meta.url))
  const root = await mkdtemp(join(tmpdir(), 'dsh-openai-snapshot-'))
  const conversationId = brandString<ConversationId>('snapshot-conversation')
  const { id } = resolveSessionTarget('harness', conversationId, 'unused')
  const workspaceRoot = fileDelivery ? root : join(root, '.openai-service-workspace')
  const workspace = join(workspaceRoot, id)
  const sessionFile = join(scenario, 'session.v4.jsonl')
  const canonical = await readFile(sessionFile, 'utf8')
  const task = parseSessionLog(canonical).find(event => event.type === 'user/message')
  if (task?.type !== 'user/message') throw new Error('OpenAI snapshot lacks its user task')
  const prompt = task.data.content.filter(block => block.type === 'text').map(block => block.text).join('')
  let server: Awaited<ReturnType<typeof startOpenAiProfile>> | undefined
  let upload: Awaited<ReturnType<typeof startUploadFixture>> | undefined
  let image: Awaited<ReturnType<typeof startImageFixture>> | undefined
  let originals: string | undefined
  try {
    if (!fileDelivery) {
      image = await startImageFixture()
      const pythonDir = join(workspaceRoot, '.python-env', process.platform === 'win32' ? 'Scripts' : 'bin')
      await mkdir(pythonDir, { recursive: true })
      await writeFile(join(pythonDir, process.platform === 'win32' ? 'python.exe' : 'python'), 'interpreter path fixture', { mode: 0o700 })
    }
    if (fileDelivery) {
      upload = await startUploadFixture()
      originals = await mkdtemp(join(tmpdir(), 'dsh-snapshot-original-'))
      const original = join(originals, 'source.txt')
      await writeFile(original, 'Original kept outside the workspace\n')
      await mkdir(workspace)
      await symlink(original, join(workspace, 'original-source.txt'))
    }
    const patch = materializeProfilePatch(join(scenario, 'cordis.snapshot.yml'), root, 'openai', root, 0)
    server = await startOpenAiProfile(root, patch, {
      DSH_HOME: join(root, '.dsh'), DSH_AGENTS_HOME: join(root, '.agents'), DSH_TELEMETRY_DISABLED: '1',
      DEEPSEEK_API_KEY: 'snapshot-replay-key',
      ...upload === undefined ? {} : { DSH_FILE_UPLOAD_URL: upload.url },
      DSH_PERMISSION_MODE: 'workspace-write', DSH_OPENAI_REPLAY_FILE: sessionFile,
    })
    const base = server.base
    const content = [
      { type: 'image_url', image_url: { url: image?.url ?? fixtureImageDataUrl } },
      ...image === undefined ? [] : [{ type: 'file_url', name: 'original.txt', url: image.fastGptFileUrl }],
      { type: 'text', text: prompt },
    ]
    const response = await fetch(`${base}/v1/chat/completions`, { method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'harness', metadata: { conversation_id: conversationId }, messages: [{ role: 'user', content }], stream: true, stream_options: { include_usage: true } }),
      signal: AbortSignal.timeout(60000),
    })
    const wire = await response.text()
    expect(response.status, wire + server.output()).toBe(200)
    expect(wire).toContain(fileDelivery ? 'https://files.example.test/delivery' : '"content":"DONE"')
    if (fileDelivery) expect(upload?.count()).toBe(1)
    expect(wire).toContain('"reasoning_content":')
    expect(wire).toMatch(/✓ 完成：Write the snapshot marker\. · \d+\.\d 秒/)
    expect(wire).not.toContain('调用工具：bash')
    expect(wire).toContain('data: [DONE]\r\n\r\n')
    expect(wire).not.toContain('tool_calls')
    expect(await readFile(join(workspace, 'marker.txt'), 'utf8')).toBe(await readFile(join(scenario, 'workspace.expected/marker.txt'), 'utf8'))
    await expect(readFile(join(workspaceRoot, 'marker.txt'))).rejects.toMatchObject({ code: 'ENOENT' })
    const followup = await fetch(`${base}/v1/chat/completions`, { method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'harness', metadata: { conversation_id: conversationId },
        messages: [
          ...image === undefined ? [] : [{ role: 'user', content: [{ type: 'file_url', name: 'original.txt', url: image.expired }] }],
          { role: 'user', content: 'Confirm the earlier tool result without calling another tool.' },
        ] }),
      signal: AbortSignal.timeout(60000),
    })
    expect(followup.status).toBe(200)
    expect(await followup.json()).toMatchObject({ choices: [{ message: { content: 'TOOL_HISTORY_OK' } }] })
    expect(followup.headers.get('x-dsh-session-id')).toBe(response.headers.get('x-dsh-session-id'))
    const sessionRoot = join(root, '.dsh/sessions')
    const paths = latestPersistedSessionPaths((await readdir(sessionRoot, { recursive: true })).map(path => join(sessionRoot, path)))
    expect(paths).toHaveLength(1)
    const selected = paths[0]
    if (selected === undefined) throw new Error('No persisted HTTP Session')
    const raw = await readFile(resolve(sessionRoot, selected), 'utf8')
    expect(raw).toContain('"type":"image","attachment":')
    expect(raw).not.toContain('base64,')
    if (image !== undefined) {
      expect(image.count()).toBe(1)
      expect(image.fileCount()).toBe(1)
      expect(raw).not.toContain(image.url)
      expect(raw).not.toContain(image.fastGptFileUrl)
      const message = parseSessionLog(raw).find(event => event.type === 'user/message')
      const original = message?.type === 'user/message' && message.data.content.find(block => block.type === 'file')
      if (!original) throw new Error('Recorded original file is missing')
      const digest = original.attachment.attachmentId.slice('sha256:'.length)
      const stored = join(root, '.dsh', 'attachments', 'v1', 'files', digest.slice(0, 2), digest, original.attachment.name)
      expect(await readFile(stored)).toEqual(fixtureFile)
    }
    const sessionId = response.headers.get('x-dsh-session-id')
    if (sessionId === null) throw new Error('Missing HTTP request identity')
    const context = { cwd: workspace, sessionIds: [sessionId] }
    const redacted = redactSessionSnapshotIds([raw])[0]
    if (redacted === undefined) throw new Error('Missing redacted Session')
    const normalized = scrubSessionSnapshot(normalizeSessionLog(redacted, { ...context, cwd: workspaceRoot }, { identityMode: 'preserve' }))
    if (normalized === undefined) throw new Error('Missing normalized Session')
    const prompts = normalizedSystemPrompts(raw, context)
    const schemas = normalizedToolSchemas(raw, context)
    const promptSidecar = formatSystemPromptSnapshot(prompts[0] ?? '', prompts.slice(1))
    const schemaSidecar = formatToolSchemasSnapshot(schemas[0] ?? [], schemas.slice(1))
    if (!fileDelivery) {
      expect(promptSidecar).toContain('Prefer the Python standard library')
      expect(promptSidecar).toContain('Pillow (import PIL)')
      expect(promptSidecar).toContain('matplotlib')
    }
    if (process.env.DSH_SNAPSHOT === 'refresh') {
      await writeFile(sessionFile, normalized)
      await writeFile(join(scenario, 'system-prompt.expected.md'), promptSidecar)
      await writeFile(join(scenario, 'tool-schemas.expected.json'), schemaSidecar)
    } else {
      expect(normalized).toBe(canonical)
      expect(promptSidecar).toBe(await readFile(join(scenario, 'system-prompt.expected.md'), 'utf8'))
      expect(schemaSidecar).toBe(await readFile(join(scenario, 'tool-schemas.expected.json'), 'utf8'))
    }
  } finally {
    try { await server?.close() }
    finally {
      await Promise.all([upload?.close(), image?.close()])
      await rm(root, { recursive: true, force: true })
      if (originals !== undefined) await rm(originals, { recursive: true, force: true })
    }
  }
})
