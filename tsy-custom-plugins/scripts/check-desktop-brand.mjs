import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'

const require = createRequire(pathToFileURL(`${process.cwd()}/apps/desktop/package.json`))
const WebSocket = require('ws')

const pages = await (await fetch('http://127.0.0.1:9222/json/list')).json()
const page = pages.find(p => p.url === 'dsh-app://app/')
if (!page) throw new Error('no dsh-app://app/ page — is Desktop running with DevTools?')

const ws = new WebSocket(page.webSocketDebuggerUrl)
await new Promise((resolve, reject) => {
  ws.once('open', resolve)
  ws.once('error', reject)
})

let nextId = 0
function send(method, params = {}) {
  const id = ++nextId
  return new Promise((resolve, reject) => {
    const onMessage = (data) => {
      const message = JSON.parse(String(data))
      if (message.id !== id) return
      ws.off('message', onMessage)
      resolve(message)
    }
    ws.on('message', onMessage)
    ws.send(JSON.stringify({ id, method, params }))
    setTimeout(() => reject(new Error(`timeout ${method}`)), 10_000)
  })
}

await send('Runtime.enable')
const expression = [
  '(() => {',
  '  const imgs = [...document.querySelectorAll("img")].map((img) => ({',
  '    dataUrl: img.src.startsWith("data:image"),',
  '    w: img.width,',
  '    h: img.height,',
  '    slot: img.closest("[data-slot]")?.getAttribute("data-slot") ?? null,',
  '  }));',
  '  return {',
  '    title: document.title,',
  '    brandName: document.querySelector(\'[data-slot="sidebar.brand.name"]\')?.textContent?.trim() ?? null,',
  '    hasFishSvg: !!document.querySelector(\'svg[viewBox="0 0 23.16 17.04"]\'),',
  '    imgs,',
  '    markSlots: [...document.querySelectorAll(\'[data-slot$="brand.mark"]\')].map((el) => ({',
  '      slot: el.getAttribute("data-slot"),',
  '      hasImg: !!el.querySelector("img"),',
  '      hasSvg: !!el.querySelector("svg"),',
  '    })),',
  '  };',
  '})()',
].join('\n')

const { result } = await send('Runtime.evaluate', { expression, returnByValue: true })
console.log(JSON.stringify(result.result?.value ?? result, null, 2))
ws.close()
