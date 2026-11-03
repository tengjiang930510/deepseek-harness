const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const path = require('node:path')

function projectionFactory(cache = {}) {
  const source = fs.readFileSync(path.join(__dirname, 'client.js'), 'utf8')
    .replace('    return module.exports\n', '    module.exports.__projection = createMenuProjection\n    return module.exports\n')
  let factory
  vm.runInNewContext(source, { window: { __ModuleLoader__: { load: value => { factory = value.factory } } }, localStorage: { getItem: () => JSON.stringify(cache) } })
  return factory(() => ({})).__projection
}

test('menu projection removes only duplicate command rows and retains original indexes', () => {
  let state = { open: true, groups: [
    { source: 'command', status: 'ready', items: [{ name: 'goal' }, { name: 'office' }, { name: 'plan' }] },
    { source: 't4y-plugins', status: 'ready', items: [{ name: 'office' }] },
    { source: 'reference', status: 'ready', items: [{ name: 'office' }] },
  ], highlight: { source: 'command', index: 1 } }
  const project = projectionFactory()({ menu: { getSnapshot: () => state, subscribe: () => () => {} } })
  const view = project.menu.getSnapshot()
  assert.equal(view.groups[0].items.length, 2)
  assert.equal(view.groups[2].items.length, 1)
  assert.equal(project.originalIndex('command', 1), 2)
  assert.equal(view.highlight.source, 't4y-plugins')
  assert.equal(view.highlight.index, 0)
  assert.equal(view.hasDuplicates, true)
  state = { ...state, groups: [state.groups[0]], highlight: null }
  assert.equal(project.menu.getSnapshot().groups[0].items.length, 3)
  assert.equal(project.menu.getSnapshot().hasDuplicates, false)
})

test('does not show a previously known plugin command when it is absent from the authorized results', () => {
  const state = { open: true, groups: [
    { source: 'command', status: 'ready', items: [{ name: 'goal' }, { name: 'office' }] },
    { source: 't4y-plugins', status: 'ready', items: [] },
  ], highlight: null }
  const factory = projectionFactory({ 'project/office': { commands: ['/office'] } })
  const view = factory({ menu: { getSnapshot: () => state, subscribe: () => () => {} } }).menu.getSnapshot()
  assert.deepEqual(Array.from(view.groups[0].items, item => item.name), ['goal'])
})
