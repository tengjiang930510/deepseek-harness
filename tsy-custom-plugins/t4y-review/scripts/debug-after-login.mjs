import { chromium } from 'playwright'

const LOGIN_URL =
  'https://jgyw.crfsdi.com.cn:51111/smart-supervision-hhjc/#/company/hhjczhjl/login'
const FORM_URL =
  'https://jgyw.crfsdi.com.cn:51111/smart-supervision-hhjc/#/company/hhjczhjl/dashboard/2100475767734706178/form/wf87b15ec0603dfd28acd3cf'

const browser = await chromium.launch({ headless: false })
const page = await browser.newPage({ locale: 'zh-CN', ignoreHTTPSErrors: true })
page.setDefaultTimeout(60_000)
await page.goto(LOGIN_URL, { waitUntil: 'domcontentloaded' })
await page.getByRole('textbox', { name: '请输入用户名' }).fill('admin')
await page.getByRole('textbox', { name: '请输入密码' }).fill('Tsy@123456')
await page.getByRole('button', { name: /登录/ }).click()
await page.getByRole('textbox', { name: '请输入用户名' }).waitFor({ state: 'hidden', timeout: 60_000 })

const back = page.getByText('返回企业级', { exact: true })
console.log('返回企业级', await back.count(), await back.first().isVisible().catch(() => false))
if (await back.first().isVisible().catch(() => false)) {
  await back.first().click()
  await page.waitForTimeout(2000)
  console.log('after back url', page.url())
  console.log('App-Icon', await page.locator('.App-Icon').count())
}

await page.goto(FORM_URL, { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(2000)
console.log('form url', page.url())
console.log('新增', await page.getByRole('button', { name: '新增' }).count())
console.log('发起流程', await page.getByRole('button', { name: '发起流程' }).count())
console.log('body head', (await page.locator('body').innerText()).slice(0, 400))
await browser.close()
