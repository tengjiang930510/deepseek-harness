import { readFileSync } from 'node:fs'
import { createContext, runInContext } from 'node:vm'
import { createRequire } from 'node:module'
import { expect, it, onTestFinished } from 'vitest'
import {
  createClientModuleSystem, type ClientModuleLoaderTarget,
} from '../packages/client/modules/src/client/index.ts'

const reactModule: unknown = createRequire(new URL('../packages/client/modules/package.json', import.meta.url))('react')
if (typeof reactModule !== 'object' || reactModule === null) throw new Error('React must export an object')
const react = Object.fromEntries<unknown>(Object.entries(reactModule))

it.each(['t4y-brand', 't4y-capability-hub', 't4y-review'])('loads the %s client through its package graph row', async (name) => {
  const source = readFileSync(new URL(`../tsy-custom-plugins/${name}/client.js`, import.meta.url), 'utf8')
  const target: ClientModuleLoaderTarget = {
    mode: 'queue', pendingQueue: [],
    load(registration) { this.pendingQueue.push(registration) },
    create(options) {
      return createClientModuleSystem(this, { id: '@deepseek-ai/dsh-client-modules', exports: {} }, options)
    },
  }
  const realm = createContext({ window: { __ModuleLoader__: target } })
  const url = `plugins/??${name}/client.js&rev=test`
  const loader = target.create({
    boot: {
      rev: 'test', entries: [{ id: name, url, rev: 'test' }],
      batches: [{ phase: 'application', url, rev: 'test', entries: [name] }],
    },
    staticModules: [{ id: 'react', factory: () => react }],
    loadBundle: async () => { runInContext(source, realm) },
  })
  onTestFinished(() => loader.dispose())
  for (const revision of ['initial', 'updated']) {
    if (revision === 'updated') loader.invalidate(name, revision)
    const plugin = await loader.import(name)
    expect(typeof plugin === 'object' && plugin !== null && 'apply' in plugin && typeof plugin.apply === 'function').toBe(true)
  }
})
