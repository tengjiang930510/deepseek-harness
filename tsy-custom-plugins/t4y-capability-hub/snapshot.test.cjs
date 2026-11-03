const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const path = require('node:path')

function fixture() {
  const source = fs.readFileSync(path.join(__dirname, 'client.js'), 'utf8').replace(
    '    return module.exports\n',
    '    module.exports.__snapshot = { loadPluginSnapshot, invalidatePluginSnapshot, createRequestGate }\n    return module.exports\n',
  )
  let session = { tenantId: 'tenant', username: 'alice' }
  let token = 'token-a'
  let moduleId = 'project-a'
  const requests = []
  const storage = new Map([['t4y-plugin-metadata-v1', JSON.stringify({ 'p/old': { package: 'old', version: '1', commands: ['/old'] }, 'p/new': { package: 'new', version: '1', commands: ['/new'] }, 'p/fresh': { package: 'fresh', version: '1', commands: ['/fresh'] } })]])
  const localStorage = { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value), removeItem: key => storage.delete(key) }
  const win = {
    location: { origin: 'http://localhost' },
    __ModuleLoader__: { load: value => { win.factory = value.factory } },
    __t4yIdentity: { getSession: () => session, getAccessToken: () => token },
    __t4yTenant: { getModuleId: () => moduleId },
  }
  const fetch = (url) => new Promise((resolve, reject) => requests.push({ url, resolve, reject }))
  vm.runInNewContext(source, { window: win, URL, fetch, localStorage })
  const snapshot = win.factory(() => ({})).__snapshot
  return { snapshot, requests, storage, setIdentity: (next, nextToken, nextModule) => { session = next; token = nextToken; moduleId = nextModule } }
}

function respond(request, value) {
  request.resolve({ ok: true, text: async () => JSON.stringify({ ok: true, value }) })
}

test('coalesces simultaneous loads and isolates results across accounts', async () => {
  const b = fixture()
  const first = b.snapshot.loadPluginSnapshot()
  const joined = b.snapshot.loadPluginSnapshot()
  assert.equal(b.requests.length, 2)
  b.setIdentity({ tenantId: 'tenant', username: 'bob' }, 'token-b', 'project-a')
  const second = b.snapshot.loadPluginSnapshot()
  assert.equal(b.requests.length, 4)
  respond(b.requests[0], [{ key: 'p/old', name: 'old' }]); respond(b.requests[1], { bundles: [] })
  assert.equal(await first, null)
  assert.equal(await joined, null)
  respond(b.requests[2], [{ key: 'p/new', name: 'new' }]); respond(b.requests[3], { bundles: [] })
  assert.equal((await second).plugins[0].name, 'new')
  b.setIdentity(null, null, null)
})

test('reuses the authorized snapshot only for the current identity until invalidation', async () => {
  const b = fixture()
  const first = b.snapshot.loadPluginSnapshot()
  respond(b.requests[0], [{ key: 'p/new', name: 'new' }]); respond(b.requests[1], { bundles: [] })
  await first
  assert.equal((await b.snapshot.loadPluginSnapshot()).plugins[0].name, 'new')
  assert.equal(b.requests.length, 2)
  b.setIdentity({ tenantId: 'tenant', username: 'alice' }, 'token-b', 'project-a')
  const updated = b.snapshot.loadPluginSnapshot()
  assert.equal(b.requests.length, 4)
  respond(b.requests[2], []); respond(b.requests[3], { bundles: [] })
  assert.equal((await updated).plugins.length, 0)
})

test('failed permission refresh rejects without returning old authorization', async () => {
  const b = fixture()
  const first = b.snapshot.loadPluginSnapshot()
  respond(b.requests[0], []); respond(b.requests[1], { bundles: [] })
  await first
  b.snapshot.invalidatePluginSnapshot()
  const failed = b.snapshot.loadPluginSnapshot()
  b.requests[2].reject(new Error('offline'))
  await assert.rejects(failed, /offline/)
})

test('invalidated in-flight results cannot repopulate the cache', async () => {
  const b = fixture()
  const old = b.snapshot.loadPluginSnapshot()
  b.snapshot.invalidatePluginSnapshot()
  const fresh = b.snapshot.loadPluginSnapshot()
  respond(b.requests[0], [{ key: 'p/old', name: 'old' }]); respond(b.requests[1], { bundles: [] })
  assert.equal(await old, null)
  respond(b.requests[2], [{ key: 'p/fresh', name: 'fresh' }]); respond(b.requests[3], { bundles: [] })
  assert.equal((await fresh).plugins[0].name, 'fresh')
})

 test('cached metadata cannot grant an omitted plugin after permission is revoked', async () => {
  const b = fixture()
  const first = b.snapshot.loadPluginSnapshot()
  respond(b.requests[0], [{ key: 'p/new', name: 'new' }]); respond(b.requests[1], { bundles: [] })
  assert.equal((await first).plugins.length, 1)
  b.snapshot.invalidatePluginSnapshot()
  const revoked = b.snapshot.loadPluginSnapshot()
  respond(b.requests[2], []); respond(b.requests[3], { bundles: [] })
  assert.equal((await revoked).plugins.length, 0)
  assert.equal(b.requests.length, 4)
})

test('missing metadata is fetched after current permissions are checked and reused later', async () => {
  const b = fixture()
  const first = b.snapshot.loadPluginSnapshot()
  respond(b.requests[0], [{ key: 'p/missing', name: 'missing' }]); respond(b.requests[1], { bundles: [] })
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(b.requests.length, 3)
  respond(b.requests[2], [{ key: 'p/missing', name: 'missing', package: 'missing', version: '1', iconUrl: 'https://example.com/logo.png', commands: ['/missing'] }])
  const plugin = (await first).plugins[0]
  assert.equal(plugin.name, 'missing')
  assert.equal(plugin.version, '1')
  const saved = JSON.parse(b.storage.get('t4y-plugin-metadata-v1'))['p/missing']
  assert.equal(saved.name, 'missing')
  assert.equal(saved.iconUrl, 'https://example.com/logo.png')
  assert.equal(saved.version, '1')
  assert.deepEqual(saved.commands, ['/missing'])
  assert.equal(b.storage.get('t4y-plugin-metadata-v1').includes('token-a'), false)
  const second = b.snapshot.loadPluginSnapshot()
  assert.equal((await second).plugins[0].name, 'missing')
  assert.equal(b.requests.length, 3)
  b.snapshot.invalidatePluginSnapshot()
  const refreshed = b.snapshot.loadPluginSnapshot()
  respond(b.requests[3], [{ key: 'p/missing', name: 'missing' }]); respond(b.requests[4], { bundles: [] })
  assert.equal((await refreshed).plugins[0].name, 'missing')
  assert.equal(b.requests.length, 5)
})

test('installed version changes refresh cached plugin metadata', async () => {
  const b = fixture()
  const result = b.snapshot.loadPluginSnapshot()
  respond(b.requests[0], [{ key: 'p/new', name: 'new' }])
  respond(b.requests[1], { bundles: [], plugins: { 'p/new': { active: { commit: 'new-commit' } } } })
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(b.requests.length, 3)
  respond(b.requests[2], [{ key: 'p/new', name: 'new', package: 'new', version: '2', commands: ['/updated'], latest: { git: { commit: 'new-commit' } } }])
  assert.deepEqual(Array.from((await result).plugins[0].commands), ['/updated'])
})

test('ignores an in-flight authorization response after changing projects', async () => {
  const b = fixture()
  const oldProject = b.snapshot.loadPluginSnapshot()
  b.setIdentity({ tenantId: 'tenant', username: 'alice' }, 'token-a', 'project-b')
  const newProject = b.snapshot.loadPluginSnapshot()
  respond(b.requests[0], [{ key: 'p/old', name: 'old' }]); respond(b.requests[1], { bundles: [] })
  assert.equal(await oldProject, null)
  respond(b.requests[2], [{ key: 'p/new', name: 'new' }]); respond(b.requests[3], { bundles: [] })
  assert.equal((await newProject).plugins[0].name, 'new')
})

 test('settings requests ignore old projects, older responses and disposed views', () => {
  const b = fixture()
  const gate = b.snapshot.createRequestGate()
  const old = gate.start()
  const latest = gate.start()
  assert.equal(old(), false)
  assert.equal(latest(), true)
  b.setIdentity({ tenantId: 'tenant', username: 'alice' }, 'token-a', 'project-b')
  assert.equal(latest(), false)
  const otherProject = gate.start()
  assert.equal(otherProject(), true)
  gate.invalidate()
  assert.equal(otherProject(), false)
})
