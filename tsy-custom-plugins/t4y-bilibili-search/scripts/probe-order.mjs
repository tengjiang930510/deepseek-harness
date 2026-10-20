/**
 * Diagnose Bilibili search sort support: list visible sort labels and compare result order per `order` query.
 * Usage: node scripts/probe-order.mjs [keyword]
 */
import { chromium } from 'playwright'

const keyword = process.argv[2] ?? '武汉地铁'
const browser = await chromium.launch({ headless: true })
const page = await browser.newPage()

async function topResults(order) {
  const params = new URLSearchParams({ keyword })
  if (order) params.set('order', order)
  await page.goto(`https://search.bilibili.com/video?${params}`, { waitUntil: 'domcontentloaded' })
  await page.locator('.bili-video-card__wrap').first().waitFor({ timeout: 25_000 }).catch(() => undefined)
  return page.evaluate(() => ({
    url: location.href,
    sorts: [...document.querySelectorAll('.search-conditions .vui_button, .search-condition-row button, .conditions-order-item, .vui_tabs--nav-item')]
      .map(el => `${(el.textContent || '').trim()}${el.className.includes('active') ? '*' : ''}`)
      .filter(Boolean),
    titles: [...document.querySelectorAll('.bili-video-card__info--tit')].slice(0, 5).map(el => (el.getAttribute('title') || el.textContent || '').trim()),
  }))
}

for (const order of [undefined, 'scores', 'click', 'stow', 'dm', 'pubdate']) {
  const result = await topResults(order)
  console.log(`\n=== order=${order ?? '(none)'} -> ${result.url}`)
  console.log('sort buttons:', result.sorts.join(' | '))
  result.titles.forEach((title, index) => console.log(`  ${index + 1}. ${title}`))
}
await browser.close()
