import test from 'node:test'
import assert from 'node:assert/strict'
import { T4yReleaseManager, protectPlatformBundles } from './index.js'

test('hides platform and authorized plugins from the generic plugin list', async () => {
  const bundles = [{ name: 't4y-identity' }, { name: 'oa-helper' }, { name: 'dsh-better-sidebar' }]
  const rows = bundles.map(({ name }) => ({ moduleName: name, entryId: name }))
  const pluginManager = {
    listBundles: async () => bundles,
    listPlugins: async () => rows,
    setBundleEnabled: async () => ({ changed: true }),
    removeBundle: async () => ({ changed: true }),
    setPluginEnabled: async () => ({ changed: true }),
  }
  const manager = { readState: async () => ({ plugins: { office: { package: 'oa-helper' } } }) }
  const originalList = pluginManager.listBundles
  const dispose = protectPlatformBundles(pluginManager, manager)
  assert.deepEqual((await pluginManager.listBundles()).map(row => row.name), ['dsh-better-sidebar'])
  assert.deepEqual((await pluginManager.listPlugins()).map(row => row.moduleName), ['dsh-better-sidebar'])
  assert.deepEqual((await manager.listAllBundles()).map(row => row.name), bundles.map(row => row.name))
  assert.equal((await pluginManager.removeBundle('t4y-identity')).error.code, 'management-required')
  dispose()
  assert.equal(pluginManager.listBundles, originalList)
  assert.deepEqual((await pluginManager.listBundles()).map(row => row.name), bundles.map(row => row.name))
})

test('reads plugin coordinates, category and uploaded icon from authorized form fields', async () => {
  const manager = new T4yReleaseManager({ profileContext: { dir: '/unused' }, pluginManager: {} })
  manager.enterpriseRequest = async (path) => path.includes('getMultiRoutersNew')
    ? [{ meta: { title: '目录' }, children: [{ meta: { title: '表单', formId: 'form' } }] }]
    : {
      fields: ['插件名', '项目名', '插件种类', '插件图标'].map((title, id) => ({ title, id: String(id) })),
      items: [{ 0: 'oa-helper', 1: 'wuhanmetro', 2: '办公', 3: [{ url: 'https://example.com/icon.png' }] }],
    }
  manager.fetchLatestPlugin = async (coordinate) => coordinate
  const [plugin] = await manager.authorizedPlugins('module', {})
  assert.equal(plugin.name, 'oa-helper')
  assert.equal(plugin.projectName, 'wuhanmetro')
  assert.equal(plugin.category, '办公')
  assert.equal(plugin.iconUrl, 'https://example.com/icon.png')
})

test('uses the menu directory when category is empty and ignores an invalid image URL', async () => {
  const manager = new T4yReleaseManager({ profileContext: { dir: '/unused' }, pluginManager: {} })
  manager.enterpriseRequest = async (path) => path.includes('getMultiRoutersNew')
    ? [{ meta: { title: '办公' }, children: [{ meta: { title: '助手', formId: 'form' } }] }]
    : { fields: ['插件名', '项目名', '插件种类', '插件图标'].map((title, id) => ({ title, id: String(id) })),
      items: [{ 0: 'assistant', 1: 'project', 2: '', 3: [{ url: 'javascript:alert(1)' }] }] }
  manager.fetchLatestPlugin = async (coordinate) => coordinate
  const [plugin] = await manager.authorizedPlugins('module', {})
  assert.equal(plugin.category, '办公')
  assert.equal(plugin.iconUrl, undefined)
})

test('loads independent forms and release records concurrently', async () => {
  const manager = new T4yReleaseManager({ profileContext: { dir: '/unused' }, pluginManager: {} })
  const forms = []
  const releases = []
  manager.enterpriseRequest = async (path, _auth, _module, body) => {
    if (path.includes('getMultiRoutersNew')) return [
      { meta: { formId: 'one', title: '一' } }, { meta: { formId: 'two', title: '二' } },
    ]
    return new Promise(resolve => forms.push({ id: body.formId, resolve }))
  }
  manager.fetchLatestPlugin = coordinate => new Promise(resolve => releases.push({ coordinate, resolve }))
  const result = manager.authorizedPlugins('project', {})
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(forms.length, 2)
  for (const form of forms) form.resolve({ fields: [{ title: '插件名', id: 'name' }, { title: '项目名', id: 'project' }], items: [{ name: form.id, project: 'p' }] })
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(releases.length, 2)
  releases.forEach(release => release.resolve(release.coordinate))
  assert.deepEqual((await result).map(item => item.name), ['one', 'two'])
})

test('restores only plugins suspended by a project change after authorization is checked', async (t) => {
  const { mkdtemp, rm } = await import('node:fs/promises')
  const { tmpdir } = await import('node:os')
  const { join } = await import('node:path')
  const dir = await mkdtemp(join(tmpdir(), 't4y-project-plugins-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  let current = 'a'
  const enabled = new Map([['plugin-a', true], ['plugin-b', false]])
  const changes = []
  const manager = new T4yReleaseManager({
    profileContext: { dir },
    t4yTenant: { getModuleId: () => current, catalogUrl: () => 'https://example.com' },
    pluginManager: {
      listBundles: async () => [...enabled].map(([name, value]) => ({ name, enabled: value })),
      setBundleEnabled: async (name, value) => { enabled.set(name, value); changes.push([name, value]); return { application: 'applied' } },
    },
  })
  manager.readState = async () => ({ plugins: { a: { package: 'plugin-a' }, b: { package: 'plugin-b' } } })
  manager.authorizedPlugins = async module => module === 'a' ? [{ name: 'a', projectName: 'hub', package: 'plugin-a' }] : [{ name: 'b', projectName: 'hub', package: 'plugin-b' }]
  current = 'b'
  await manager.applyModule('b', 'token')
  assert.deepEqual(changes, [['plugin-a', false]])
  current = 'a'
  await manager.applyModule('a', 'token')
  assert.deepEqual(changes, [['plugin-a', false], ['plugin-a', true]])
  assert.equal(enabled.get('plugin-b'), false)
  await manager.setAuthorizedEnabled('a', 'a', 'hub', false, 'token')
  current = 'b'
  await manager.applyModule('b', 'token')
  current = 'a'
  await manager.applyModule('a', 'token')
  assert.equal(enabled.get('plugin-a'), false)
})

test('an obsolete project authorization response cannot change plugin state', async (t) => {
  const { mkdtemp, rm } = await import('node:fs/promises')
  const { tmpdir } = await import('node:os')
  const { join } = await import('node:path')
  const dir = await mkdtemp(join(tmpdir(), 't4y-project-plugins-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  let current = 'a'
  let resolveAuthorization
  const changes = []
  const manager = new T4yReleaseManager({
    profileContext: { dir },
    t4yTenant: { getModuleId: () => current, catalogUrl: () => 'https://example.com' },
    pluginManager: { listBundles: async () => [{ name: 'plugin-a', enabled: true }], setBundleEnabled: async (...args) => changes.push(args) },
  })
  manager.readState = async () => ({ plugins: { a: { package: 'plugin-a' } } })
  manager.authorizedPlugins = () => new Promise(resolve => { resolveAuthorization = resolve })
  const pending = manager.applyModule('a', 'token')
  await new Promise(resolve => setImmediate(resolve))
  current = 'b'
  resolveAuthorization([])
  await pending
  assert.deepEqual(changes, [])
})
