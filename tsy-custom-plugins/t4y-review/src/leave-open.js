/**
 * Login → leave form URL → 新增 → fill → 发起流程.
 * Fill uses codegen pattern: input.fill(value) + Enter (no ephemeral #el-id-*).
 */
import { chromium } from 'playwright'

const LOGIN_URL =
  'https://jgyw.crfsdi.com.cn:51111/smart-supervision-hhjc/#/company/hhjczhjl/login'

const LEAVE_FORM_URL =
  'https://jgyw.crfsdi.com.cn:51111/smart-supervision-hhjc/#/company/hhjczhjl/dashboard/2100475767734706178/form/wf87b15ec0603dfd28acd3cf'


/**
 * Launch Playwright Chromium, falling back to the system Edge where Playwright's browser download is absent
 * (e.g. a packaged Desktop install).
 * @param {import('playwright').LaunchOptions} options
 * @returns {Promise<import('playwright').Browser>}
 */
async function launchBrowser(options) {
  try {
    return await chromium.launch(options)
  } catch (error) {
    if (!/Executable doesn't exist/i.test(error instanceof Error ? error.message : String(error))) throw error
    return chromium.launch({ ...options, channel: 'msedge' })
  }
}

const LEAVE_TYPE_LABEL = {
  annual: '年假',
  personal: '事假',
  sick: '病假',
  年假: '年假',
  事假: '事假',
  病假: '病假',
}

/**
 * @param {string} value
 * @returns {string}
 */
function resolveLeaveTypeLabel(value) {
  const label = LEAVE_TYPE_LABEL[String(value ?? '').trim()]
  if (!label) throw new Error(`unsupported leave_type: ${value} (use annual|personal|sick)`)
  return label
}

/**
 * @param {string} value
 * @returns {string}
 */
function parseIsoDate(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value ?? '').trim())
  if (!match) throw new Error(`date must be YYYY-MM-DD: ${value}`)
  return `${match[1]}-${match[2]}-${match[3]}`
}

/**
 * @param {import('playwright').Page} page
 */
function leaveDialog(page) {
  return page.locator('.el-overlay.WDialogModal, .el-dialog__wrapper, .el-overlay-dialog').filter({
    has: page.getByRole('button', { name: '发起流程' }),
  }).last()
}

/**
 * @param {import('playwright').Page} page
 */
async function waitDialogReady(page) {
  const dialog = leaveDialog(page)
  await dialog.waitFor({ state: 'visible' })
  await dialog.locator('.el-loading-mask').waitFor({ state: 'hidden', timeout: 30_000 }).catch(() => {})
  return dialog
}

/**
 * @param {import('playwright').Locator} input
 * @param {string} value
 */
async function fillAndEnter(input, value) {
  await input.click()
  await input.fill(value)
  await input.press('Enter')
}

/**
 * @param {import('playwright').Page} page
 */
async function loginAndOpenCreateForm(page) {
  const username = process.env.ZJY_USERNAME
  const password = process.env.ZJY_PASSWORD
  if (!username || !password) {
    throw new Error('办公平台登录需要设置 ZJY_USERNAME 和 ZJY_PASSWORD 环境变量。')
  }
  await page.goto(LOGIN_URL, { waitUntil: 'domcontentloaded' })
  const user = page.getByRole('textbox', { name: '请输入用户名' })
  await user.waitFor({ state: 'visible' })
  // SPA plugins / router finish after first paint; clicking too early can swallow login.
  await page.waitForTimeout(2_000)
  await user.fill(username)
  await page.getByRole('textbox', { name: '请输入密码' }).fill(password)
  await page.waitForTimeout(500)
  await page.getByRole('button', { name: /登录/ }).click()
  try {
    await user.waitFor({ state: 'hidden', timeout: 45_000 })
  } catch {
    await page.getByRole('button', { name: /登录/ }).click()
    await user.waitFor({ state: 'hidden', timeout: 45_000 })
  }

  await page.goto(LEAVE_FORM_URL, { waitUntil: 'domcontentloaded' })
  const create = page.getByRole('button', { name: '新增' })
  await page.waitForTimeout(3_000)
  await create.waitFor({ state: 'visible', timeout: 30_000 })
  await create.click()
  await page.getByRole('button', { name: '发起流程' }).waitFor({ state: 'visible' })
  await waitDialogReady(page)
}

/**
 * @param {import('playwright').Page} page
 * @param {string} leaveTypeLabel
 */
async function fillLeaveType(page, leaveTypeLabel) {
  const dialog = await waitDialogReady(page)
  // Element Plus select: typing alone often does not commit; pick the dropdown option.
  const item = dialog.locator('.el-form-item').filter({ hasText: /^假别/ })
  const select = item.locator('.el-select').first()
  await select.click()
  const input = item.locator('input.el-select__input, input').first()
  await input.fill(leaveTypeLabel)
  const option = page.locator('.el-select-dropdown:visible').getByText(leaveTypeLabel, { exact: true }).first()
  await option.waitFor({ state: 'visible', timeout: 10_000 })
  await option.click()
}

/**
 * @param {import('playwright').Page} page
 * @param {'start' | 'end'} which
 * @param {string} iso
 */
async function fillDateField(page, which, iso) {
  const dialog = await waitDialogReady(page)
  const label = which === 'start' ? /开始/ : /结束/
  const input = dialog.locator('.el-form-item').filter({ hasText: label }).locator('input').first()
  await fillAndEnter(input, iso)
}

/**
 * @param {import('playwright').Page} page
 * @param {string} reason
 */
async function fillReason(page, reason) {
  const dialog = await waitDialogReady(page)
  const box = dialog.getByRole('textbox', { name: '请输入内容' })
  if (await box.count()) {
    await box.fill(reason)
    return
  }
  await dialog.locator('.el-form-item').filter({ hasText: /事由/ }).locator('textarea, input').first().fill(reason)
}

/**
 * @typedef {{
 *   leaveType: string
 *   startDate: string
 *   endDate: string
 *   reason: string
 *   headed?: boolean
 *   submit?: boolean
 * }} SubmitLeaveOptions
 */

/**
 * @param {SubmitLeaveOptions} options
 * @returns {Promise<{ finalUrl: string, title: string, leaveType: string, startDate: string, endDate: string, reason: string, submitted: boolean }>}
 */
export async function submitLeaveForm(options) {
  const leaveType = resolveLeaveTypeLabel(options.leaveType)
  const startDate = parseIsoDate(options.startDate)
  const endDate = parseIsoDate(options.endDate)
  const reason = String(options.reason ?? '').trim()
  if (!reason) throw new Error('reason is required')

  const headed = options.headed === true
    || process.env.HEADED === '1'
    || process.env.HEADED === 'true'
  const shouldSubmit = options.submit !== false

  const browser = await launchBrowser({ headless: !headed })
  try {
    const context = await browser.newContext({
      locale: 'zh-CN',
      viewport: { width: 1440, height: 900 },
      ignoreHTTPSErrors: true,
    })
    const page = await context.newPage()
    page.setDefaultTimeout(30_000)

    await loginAndOpenCreateForm(page)
    await fillLeaveType(page, leaveType)
    await fillDateField(page, 'start', startDate)
    await fillDateField(page, 'end', endDate)
    await fillReason(page, reason)

    if (shouldSubmit) {
      await page.getByRole('button', { name: '发起流程' }).click()
      await page.getByRole('button', { name: '发起流程' }).waitFor({ state: 'hidden', timeout: 60_000 }).catch(() => {})
      // Keep the page open briefly so the user can see the post-submit state.
      await page.waitForTimeout(5_000)
    }

    return {
      finalUrl: page.url(),
      title: await page.title(),
      leaveType,
      startDate,
      endDate,
      reason,
      submitted: shouldSubmit,
    }
  } finally {
    await browser.close()
  }
}

/** Open create dialog only (no fill). */
export async function openLeaveCreateForm(options = {}) {
  const headed = options.headed === true
    || process.env.HEADED === '1'
    || process.env.HEADED === 'true'
  const browser = await launchBrowser({ headless: !headed })
  try {
    const context = await browser.newContext({
      locale: 'zh-CN',
      viewport: { width: 1440, height: 900 },
      ignoreHTTPSErrors: true,
    })
    const page = await context.newPage()
    page.setDefaultTimeout(30_000)
    await loginAndOpenCreateForm(page)
    return { finalUrl: page.url(), title: await page.title() }
  } finally {
    await browser.close()
  }
}
