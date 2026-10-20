import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import fs from 'node:fs'

const require = createRequire(pathToFileURL(`${process.cwd()}/apps/desktop/package.json`))
const WebSocket = require('ws')

const pages = await (await fetch('http://127.0.0.1:9222/json/list')).json()
const page = pages.find(p => p.url === 'dsh-app://app/')
if (!page) throw new Error('no dsh-app page')

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
const { result } = await send('Runtime.evaluate', {
  expression: `({
    hasMenu: !!document.querySelector('[data-windows-menu]'),
    hasDeepDiving: document.body.innerText.includes('深度求索'),
    hasAssistantLabel: document.body.innerText.includes('智能助手处理中'),
    title: document.title,
  })`,
  returnByValue: true,
})
console.log(JSON.stringify(result.result?.value ?? result, null, 2))
ws.close()

const chat = fs.readFileSync('packages/client/ui-chat/lib/client.js', 'utf8')
console.log(JSON.stringify({
  bundleHasNewCopy: chat.includes('智能助手处理中'),
  bundleHasOldCopy: chat.includes('深度求索中'),
  bundleHasBrandPng: chat.includes('data:image/png;base64,'),
}, null, 2))
