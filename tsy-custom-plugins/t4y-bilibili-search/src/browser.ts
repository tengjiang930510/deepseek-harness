import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  chromium,
  type Browser,
  type BrowserContext,
  type BrowserContextOptions,
  type Page,
} from 'playwright'

export type BrowserKind = 'chromium'

export interface BrowserLaunchOptions {
  /** Defaults to chromium. */
  browser?: BrowserKind
  /**
   * When true, show the browser window.
   * When omitted, HEADED=1/true launches headed; otherwise headless.
   */
  headed?: boolean
  headless?: boolean
  /**
   * Playwright storageState JSON path.
   * Never put usernames or passwords in source.
   */
  storageStatePath?: string
  locale?: string
  timezoneId?: string
  viewport?: { width: number; height: number }
}

export interface BrowserSession {
  browser: Browser
  context: BrowserContext
  page: Page
}

const PACKAGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const AUTH_DIR = path.join(PACKAGE_ROOT, 'auth')

export function defaultStorageStatePath(site = 'bilibili'): string {
  return path.join(AUTH_DIR, `${site}.json`)
}

export function resolveHeadless(options: BrowserLaunchOptions = {}): boolean {
  if (typeof options.headless === 'boolean') {
    return options.headless
  }
  if (typeof options.headed === 'boolean') {
    return !options.headed
  }
  const headedEnv = process.env.HEADED
  if (headedEnv === '1' || headedEnv === 'true') {
    return false
  }
  return true
}

function resolveStorageStatePath(options: BrowserLaunchOptions): string | undefined {
  const candidate = options.storageStatePath ?? defaultStorageStatePath('bilibili')
  if (fs.existsSync(candidate)) {
    return candidate
  }
  return undefined
}

export async function launchChromium(options: BrowserLaunchOptions = {}): Promise<Browser> {
  const kind = options.browser ?? 'chromium'
  if (kind !== 'chromium') {
    throw new Error(`Unsupported browser: ${kind}. Phase 1 only supports Chromium.`)
  }

  return chromium.launch({
    headless: resolveHeadless(options),
    args: ['--disable-blink-features=AutomationControlled'],
  })
}

export async function createBrowserContext(
  browser: Browser,
  options: BrowserLaunchOptions = {},
): Promise<BrowserContext> {
  const contextOptions: BrowserContextOptions = {
    locale: options.locale ?? 'zh-CN',
    timezoneId: options.timezoneId ?? 'Asia/Shanghai',
    viewport: options.viewport ?? { width: 1440, height: 900 },
  }

  const storageState = resolveStorageStatePath(options)
  if (storageState) {
    contextOptions.storageState = storageState
  }

  return browser.newContext(contextOptions)
}

export async function createSession(options: BrowserLaunchOptions = {}): Promise<BrowserSession> {
  const browser = await launchChromium(options)
  const context = await createBrowserContext(browser, options)
  context.setDefaultTimeout(8_000)
  context.setDefaultNavigationTimeout(30_000)
  const page = await context.newPage()
  return { browser, context, page }
}

export async function closeSession(session: Pick<BrowserSession, 'browser'>): Promise<void> {
  await session.browser.close()
}
