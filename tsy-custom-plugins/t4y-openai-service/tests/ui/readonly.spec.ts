/** API history renders through the custom UI bundle without resuming its Agent. */
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { join, resolve } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { AgentHandle } from '@deepseek-ai/dsh-agent'
import { brandString } from '@deepseek-ai/dsh-brand'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { SessionId } from '@deepseek-ai/dsh-session'
import {
  captureStableAria,
  compareOrRefreshGolden,
  fixtureUserPrompts,
  launchWebScaffold,
  seedSession,
  webSnapshotMode,
  type WebScaffold,
} from '../../../../apps/web/tests/scaffold.ts'
import { newEnglishPage } from '../../../../apps/web/tests/support.ts'

const repo = resolve(import.meta.dirname, '../../../..')
const fixture = join(repo, 'snapshots/web/minimal-preset/session.v3.jsonl')
type Browser = Parameters<typeof newEnglishPage>[0]
type Page = Awaited<ReturnType<typeof newEnglishPage>>
const { chromium } = createRequire(join(repo, 'apps/web/package.json'))('playwright') as {
  chromium: { launch(): Promise<Browser> }
}

describe('custom API history UI', () => {
  let scaffold: WebScaffold | undefined
  let handle: AgentHandle | undefined
  let browser: Browser | undefined
  let page: Page | undefined
  let sessionId: SessionId

  beforeAll(async () => {
    if (webSnapshotMode() === 'record') throw new Error('API UI tests replay an existing fixture; use refresh for the UI golden')
    const text = await readFile(fixture, 'utf8')
    const [prompt] = fixtureUserPrompts(text)
    if (prompt === undefined) throw new Error('UI replay fixture has no user prompt')
    scaffold = await launchWebScaffold({
      extraOverlayPath: join(import.meta.dirname, 'scaffold.overlay.yml'),
      replayFixture: fixture,
      compareReplaySession: 'read-only',
      paceMs: 10,
      profile: { hmr: false, packages: [{ dir: join(repo, 'tsy-custom-plugins/t4y-openai-ui'), enabled: true }] },
    })
    handle = await scaffold.ctx.agents.create({
      sessionId: brandString<SessionId>('api-ui-replay'),
      meta: { cwd: scaffold.workspaceCwd, agentPreset: 'minimal' },
      agentOptions: { provider: 'deepseek-official', model: 'deepseek-v4-flash' },
      setup: agentCtx => scaffold!.ctx.agentPresets.mount(agentCtx, 'minimal').then(() => undefined),
    })
    handle.agent.followup(createUserMessage({ content: [{ type: 'text', text: prompt }], source: { kind: 'user' } }))
    await handle.agent.whenIdle()
    sessionId = await seedSession(scaffold, text, 'openai-readonly-ui', 'minimal')
    const stored = await scaffold.ctx.sessionPersistence.stat(sessionId)
    if (stored === undefined) throw new Error('API fixture was not persisted')
    expect(scaffold.ctx.sessionProjectionCache.cachedSnapshot(stored.header)?.values.title).toBeUndefined()
    browser = await chromium.launch()
    page = await newEnglishPage(browser)
  })

  afterAll(async () => {
    const failures: unknown[] = []
    await page?.close().catch((error: unknown) => failures.push(error))
    await browser?.close().catch((error: unknown) => failures.push(error))
    await handle?.dispose().catch((error: unknown) => failures.push(error))
    await scaffold?.close().catch((error: unknown) => failures.push(error))
    if (failures.length > 0) throw new AggregateError(failures, 'API history UI teardown failed')
  })

  it('shows the API badge and refresh action without editing controls or Agent ownership', async () => {
    if (scaffold === undefined || page === undefined) throw new Error('UI scaffold did not start')
    await page.goto(scaffold.authenticatedUrl, { waitUntil: 'load' })
    await page.locator('[role="treeitem"]').first().click()
    const row = page.locator(`[data-row-key="session:${sessionId}"]`)
    await row.waitFor()
    await row.getByText('API', { exact: true }).waitFor()
    expect(await row.getByText('API', { exact: true }).count()).toBe(1)
    await expect.poll(() => row.textContent()).toContain('Use the bash tool to')
    expect(scaffold.ctx.sessions.get(sessionId)).toBeUndefined()
    expect(scaffold.ctx.agents.get(sessionId)).toBeUndefined()
    await row.click()
    await page.getByText('MINIMAL_PRESET_REQUEST_OK', { exact: true }).waitFor()
    expect(await page.locator('textarea').count()).toBe(0)
    expect(await page.getByRole('button', { name: 'Good response', exact: true }).count()).toBe(0)
    expect(await page.getByRole('button', { name: /^Branch/ }).count()).toBe(0)
    expect(scaffold.ctx.agents.get(sessionId)).toBeUndefined()
    await page.getByRole('button', { name: 'Refresh records', exact: true }).click()
    await expect.poll(() => page!.getByRole('button', { name: 'Refresh records', exact: true }).isEnabled()).toBe(true)
    expect(scaffold.ctx.agents.get(sessionId)).toBeUndefined()
    await compareOrRefreshGolden(join(import.meta.dirname, 'readonly-api.expected.md'),
      await captureStableAria(page, '[class*="centerCol"]', scaffold.workspaceCwd), webSnapshotMode())
  })
})
