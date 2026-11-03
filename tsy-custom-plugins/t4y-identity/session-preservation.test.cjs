const assert = require('node:assert/strict')
const { readFileSync } = require('node:fs')
const { runInNewContext } = require('node:vm')
const test = require('node:test')

const source = readFileSync(new URL('./client.js', `file://${__filename}`), 'utf8')
  .replace('    exports.inject =', '    exports.afterProjectContext = afterProjectContext; exports.inject =')
let plugin
const calls = []
const window = { dispatchEvent() {}, __ModuleLoader__: { load: ({ factory }) => { plugin = factory(() => ({})) } } }
runInNewContext(source, {
  window,
  CustomEvent: class { constructor(name, options) { this.name = name; this.detail = options.detail } },
  fetch: async (url, options) => { calls.push({ url, body: JSON.parse(options.body) }); return { ok: true } },
})

test('restoring or switching a project updates authorization without opening a workspace', async () => {
  const session = { tenantId: 'system', moduleId: 'project', accessToken: 'token' }
  for (const reason of ['restore', 'module-switch']) {
    calls.length = 0
    await plugin.afterProjectContext(session, { reason })
    assert.deepEqual(calls.map(call => call.url), ['/api/t4y-identity/set-context', '/api/t4y-release/apply-module'])
    assert.equal(calls[0].body.moduleId, 'project')
  }
})

test('project selection is published only after the model key is issued', async () => {
  const local = new Map()
  let resolveKey
  const events = []
  let subject
  const win = {
    location: { origin: 'http://localhost' },
    dispatchEvent: event => events.push(event),
    __ModuleLoader__: { load: ({ factory }) => { subject = factory(() => ({})) } },
  }
  const code = readFileSync(new URL('./client.js', `file://${__filename}`), 'utf8')
    .replace('    exports.inject =', '    exports.commitModule = commitModule; exports.inject =')
  runInNewContext(code, {
    window: win,
    localStorage: { getItem: key => local.get(key) ?? null, setItem: (key, value) => local.set(key, value), removeItem: key => local.delete(key) },
    CustomEvent: class { constructor(name, options) { this.type = name; this.detail = options?.detail } },
    fetch: (url) => url.includes('issue-model-key')
      ? new Promise(resolve => { resolveKey = resolve })
      : Promise.resolve({ ok: true }),
  })
  const session = { tenantId: 'system', username: 'user', accessToken: 'token', expiresAt: Date.now() + 3600000, needsModulePick: true, modules: [{ id: 'project', name: 'Project' }] }
  const pending = subject.commitModule(session, 'project')
  assert.equal(events.some(event => event.type === 't4y-identity:session'), false)
  assert.equal(local.has('t4y.identity.session.v1'), false)
  resolveKey({ ok: true, json: async () => ({ expiresAt: Date.now() + 3600000 }) })
  await pending
  const published = events.find(event => event.type === 't4y-identity:session')
  assert.equal(published.detail.session.moduleId, 'project')
  assert.ok(published.detail.session.llmApiKeyExpiresAt > Date.now())
})
