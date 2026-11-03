const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')

function loadUi(react, win, fetch) {
  const source = fs.readFileSync(path.join(__dirname, 'client.js'), 'utf8')
    .replace('    return module.exports\n', '    module.exports.__ui = { ShortcutBar, PluginIcon }\n    return module.exports\n')
  let factory
  win.__ModuleLoader__ = { load: value => { factory = value.factory } }
  const localStorage = { getItem: () => null, setItem: () => {} }
  vm.runInNewContext(source, { window: win, URL, fetch, localStorage })
  return factory(name => name === 'react' ? react : { PluginArtworkDefault: () => null }).__ui
}

test('window focus and repeated identity notifications do not reload shortcuts', async () => {
  const listeners = new Map()
  const cleanups = []
  let moduleId = 'one'
  let onTenant
  let onSession
  const requests = []
  const win = {
    location: { origin: 'http://localhost' },
    __t4yIdentity: { getSession: () => ({ tenantId: 't', username: 'u' }), getAccessToken: () => 'token', onSession: fn => { onSession = fn; return () => {} } },
    __t4yTenant: { getModuleId: () => moduleId, onChange: fn => { onTenant = fn; return () => {} } },
    addEventListener: (name, fn) => listeners.set(name, fn),
    removeEventListener: name => listeners.delete(name),
  }
  const react = {
    useState: value => [typeof value === 'function' ? value() : value, () => {}],
    useEffect: effect => { cleanups.push(effect()) },
    createElement: () => null,
  }
  const fetch = async url => {
    requests.push(url)
    return { ok: true, text: async () => JSON.stringify({ ok: true, value: url.endsWith('/state') ? { bundles: [] } : [] }) }
  }
  const { ShortcutBar } = loadUi(react, win, fetch)
  ShortcutBar({ inputActions: {}, useInput: () => ({}), t: key => key, resolveCommand: () => {} })
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(requests.length, 2)
  listeners.get('focus')?.()
  onSession()
  onTenant()
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(requests.length, 2)
  moduleId = 'two'
  onTenant()
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(requests.length, 4)
  cleanups.forEach(cleanup => cleanup?.())
  assert.equal(listeners.size, 0)
})

test('a new icon URL does not retain the previous URL failure state', () => {
  const react = { useState: () => ['https://example.com/old.png', () => {}], createElement: (type, props) => ({ type, props }) }
  const { PluginIcon } = loadUi(react, {}, () => {})
  const rendered = PluginIcon({ url: 'https://example.com/new.png', size: 18 })
  assert.equal(rendered.type, 'img')
  assert.equal(rendered.props.src, 'https://example.com/new.png')
})
