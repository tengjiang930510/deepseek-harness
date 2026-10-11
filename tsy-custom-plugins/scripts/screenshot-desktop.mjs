import fs from 'node:fs'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'

const require = createRequire(pathToFileURL(`${process.cwd()}/apps/desktop/package.json`))
const WebSocket = require('ws')

const out = process.argv[2] ?? 'desktop.png'
const pages = await (await fetch('http://127.0.0.1:9222/json/list')).json()
const page = pages.find(p => p.url === 'dsh-app://app/')
if (!page) throw new Error('no dsh-app://app/ page — is Desktop running with DevTools?')

const ws = new WebSocket(page.webSocketDebuggerUrl)
await new Promise((resolve, reject) => {
  ws.once('open', resolve)
  ws.once('error', reject)
})
ws.send(JSON.stringify({ id: 1, method: 'Page.captureScreenshot', params: { format: 'png' } }))
const message = await new Promise((resolve) => {
  ws.on('message', (data) => {
    const parsed = JSON.parse(String(data))
    if (parsed.id === 1) resolve(parsed)
  })
})
fs.writeFileSync(out, Buffer.from(message.result.data, 'base64'))
console.log('wrote', out)
ws.close()
