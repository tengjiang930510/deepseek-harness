import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import vm from 'node:vm'

const source = await readFile(new URL('../client.js', import.meta.url), 'utf8')

function fixture(t) {
  let client
  const entries = new Map()
  const disposers = []
  const styleNodes = new Set()
  const bindings = new Map()
  const bindingReads = []
  const stateWrites = []
  const projectionReads = []
  const React = {
    Fragment: Symbol('Fragment'),
    useEffect: effect => effect(),
    createElement: (type, props, ...children) => ({ type, props: { ...props, children } }),
    useState: value => [value, next => { stateWrites.push(next) }],
  }
  function Button(props) { return React.createElement('button', props, ...props.children) }
  vm.runInNewContext(source, {
    window: { __ModuleLoader__: { load: descriptor => {
      assert.equal(descriptor.id, 't4y-openai-ui')
      client = descriptor.factory(name => {
        if (name === 'react') return React
        if (name === '@deepseek-ai/dsh-client-ui-primitives') return { Button }
        throw new Error(`Unexpected runtime dependency: ${name}`)
      })
    } } },
    document: {
      createElement: () => {
        const node = { textContent: '', remove: () => { styleNodes.delete(node) } }
        return node
      },
      head: { appendChild: node => { styleNodes.add(node) } },
    },
  })
  const locales = new Map()
  const ctx = {
    effect: setup => {
      const dispose = setup()
      if (typeof dispose === 'function') disposers.push(dispose)
      return dispose
    },
    locale: { register: (namespace, dictionaries) => {
      locales.set(namespace, dictionaries)
      return () => { locales.delete(namespace) }
    } },
    slots: {
      inject: (_name, install) => install(),
      register: (options, Component) => {
        entries.set(options.name, { options, Component })
        const dispose = () => { entries.delete(options.name) }
        disposers.push(dispose)
        return dispose
      },
    },
    sessions: { refreshProjections: async id => { projectionReads.push(id) }, binding: id => {
      bindingReads.push(id)
      return bindings.get(id)
    } },
  }
  client.apply(ctx)
  const dispose = () => { for (const release of disposers.splice(0).reverse()) release() }
  t.after(dispose)
  const dictionaries = locales.get('t4y.openaiUi')
  const props = (id, readOnly = true) => ({
    sessionId: id, readOnly,
    useSession: select => select({ readOnly, openState: 'open' }),
    useSessions: select => select({ byId: { [id]: { readOnly } } }),
    refreshTitle: target => ctx.sessions.refreshProjections(target),
    t: key => dictionaries.en[key],
  })
  const render = node => {
    if (node === null) return null
    if (typeof node.type === 'function') return render(node.type(node.props))
    return node
  }
  return { projectionReads, entries, props, render, styleNodes, bindings, bindingReads, stateWrites, locales, dispose }
}

test('registers passive UI contributions and reverses its dictionaries and CSS on unload', t => {
  const f = fixture(t)
  assert.deepEqual([...f.entries.keys()], [
    'sidebar.session.row.badges',
    'conversation.session.header.readonly.actions',
    'conversation.session.header.readonly.utilities',
  ])
  const [style] = f.styleNodes
  assert.match(style.textContent, /background:var\(--dsw-static-blue-600\)/)
  assert.match(style.textContent, /color:var\(--dsw-static-neutral-00\)/)
  f.dispose()
  assert.equal(f.styleNodes.size, 0)
  assert.equal(f.locales.size, 0)
  assert.equal(f.entries.size, 0)
})

test('renders badges from row metadata without retaining or opening a Session', t => {
  const f = fixture(t)
  const row = f.entries.get('sidebar.session.row.badges')
  const badge = f.render(row.Component(f.props('openai-history')))
  assert.equal(badge.type, 'span')
  assert.equal(badge.props.children[0], 'API')
  assert.equal(row.Component(f.props('ordinary', true)), null)
  assert.equal(row.Component(f.props('openai-history', false)), null)
  assert.deepEqual(f.bindingReads, [])
  assert.deepEqual(f.projectionReads, ['openai-history'])
  const injected = row.options.inject()
  void injected.refreshTitle('openai-another')
  assert.deepEqual(f.projectionReads, ['openai-history', 'openai-another'])
})

test('keeps the header API-only and displays the same private badge', t => {
  const f = fixture(t)
  const header = f.entries.get('conversation.session.header.readonly.actions')
  assert.equal(f.render(header.Component(f.props('openai-history'))).props.children[0], 'API')
  assert.equal(header.Component(f.props('ordinary', true)), null)
  assert.equal(header.Component(f.props('openai-history', false)), null)
  assert.deepEqual(f.bindingReads, [])
})

test('refreshes only the retained Session history and exposes a failure when it is unavailable', async t => {
  const f = fixture(t)
  const entry = f.entries.get('conversation.session.header.readonly.utilities')
  let refreshed = 0
  f.bindings.set('openai-history', { session: { refreshHistory: async () => { refreshed++ } } })
  const injected = entry.options.inject('openai-history')
  assert.equal(await injected.refreshHistory(), true)
  assert.equal(refreshed, 1)
  const component = entry.Component({ ...f.props('openai-history'), ...injected })
  const button = component.props.children[0]
  assert.equal(button.props.children[0], 'Refresh records')
  assert.equal(button.props.disabled, false)
  f.bindings.clear()
  button.props.onClick()
  await Promise.resolve()
  await Promise.resolve()
  assert.equal(f.stateWrites.at(-1), true)
})

test('disables refresh while a history request is loading', t => {
  const f = fixture(t)
  const entry = f.entries.get('conversation.session.header.readonly.utilities')
  const props = f.props('openai-history')
  props.useSession = select => select({ readOnly: true, openState: 'loading' })
  const component = entry.Component({ ...props, ...entry.options.inject('openai-history') })
  assert.equal(component.props.children[0].props.disabled, true)
})
