/** Live-model compatibility smoke through the shipped HTTP profile and a real filesystem effect. */
import { randomUUID } from 'node:crypto'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { startOpenAiProfile } from './fixture.ts'

it.skipIf(!process.env.DEEPSEEK_API_KEY)('OpenAI profile: a live model writes a file through its configured tools', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-openai-live-'))
  let server: Awaited<ReturnType<typeof startOpenAiProfile>> | undefined
  try {
    const patch = join(root, 'server.patch.yml')
    await writeFile(patch, `
- id: openai-webserver
  config:
    host: 127.0.0.1
    port: 0
- id: openai-server
  config:
    models:
      - id: harness
        provider: deepseek-official
        model: deepseek-flash
        cwd: !!js process.cwd()
        tools: [bash]
        maxTokens: 8192
- id: session-log-deepseek
  config:
    enabled: false
`)
    server = await startOpenAiProfile(root, patch, { DSH_HOME: join(root, '.dsh'), DSH_AGENTS_HOME: join(root, '.agents'),
      DSH_TELEMETRY_DISABLED: '1', DSH_PERMISSION_MODE: 'workspace-write' })
    const marker = randomUUID()
    const response = await fetch(`${server.base}/v1/chat/completions`, { method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'harness', stream: false, temperature: 0,
        messages: [{ role: 'user', content: `Use bash to write exactly ${marker} followed by a newline to marker.txt. Then reply DONE.` }] }),
      signal: AbortSignal.timeout(90000),
    })
    const body = await response.text()
    expect(response.status, body + server.output()).toBe(200)
    expect(await readFile(join(root, 'marker.txt'), 'utf8')).toBe(`${marker}\n`)
  } finally {
    await server?.close()
    await rm(root, { recursive: true, force: true })
  }
})
