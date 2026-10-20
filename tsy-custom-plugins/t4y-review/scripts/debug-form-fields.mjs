import { chromium } from 'playwright'

const LOGIN_URL =
  'https://jgyw.crfsdi.com.cn:51111/smart-supervision-hhjc/#/company/hhjczhjl/login'
const LEAVE_FORM_URL =
  'https://jgyw.crfsdi.com.cn:51111/smart-supervision-hhjc/#/company/hhjczhjl/dashboard/2100475767734706178/form/wf87b15ec0603dfd28acd3cf'

const browser = await chromium.launch({ headless: false })
const context = await browser.newContext({ locale: 'zh-CN', ignoreHTTPSErrors: true })
const page = await context.newPage()
page.setDefaultTimeout(60_000)
await page.goto(LOGIN_URL)
await page.getByRole('textbox', { name: '请输入用户名' }).fill('admin')
await page.getByRole('textbox', { name: '请输入密码' }).fill('Tsy@123456')
await page.getByRole('button', { name: /登录/ }).click()
await page.getByRole('textbox', { name: '请输入用户名' }).waitFor({ state: 'hidden' })
// Stay on company product; do not click 返回企业级 (may jump to another portal).
await page.goto(LEAVE_FORM_URL)
await page.getByRole('button', { name: '新增' }).click()
await page.getByRole('button', { name: '发起流程' }).waitFor({ state: 'visible' })
await page.waitForTimeout(2000)

const dialog = page.locator('.el-overlay.WDialogModal').filter({ has: page.getByRole('button', { name: '发起流程' }) }).last()
console.log('url', page.url())
console.log('date editors', await dialog.locator('.el-date-editor').count())
console.log('inputs', await dialog.locator('input').evaluateAll((nodes) => nodes.map((n) => ({
  placeholder: n.getAttribute('placeholder'),
  className: n.className,
}))))
console.log('labels', await dialog.locator('.el-form-item__label, label').allTextContents())
console.log('form items', await dialog.locator('.el-form-item').evaluateAll((nodes) => nodes.map((n) => n.innerText.replace(/\s+/g, ' ').slice(0, 100))))
await browser.close()
