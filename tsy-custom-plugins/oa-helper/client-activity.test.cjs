const assert = require('node:assert/strict')
const { readFileSync } = require('node:fs')
const { runInNewContext } = require('node:vm')
const test = require('node:test')

const source = readFileSync(new URL('./client.js', `file://${__filename}`), 'utf8')
  .replace('    exports.inject =', '    exports.activity = { commandActivity, commandActivityView, definition, normalize }; exports.inject =')
let plugin
runInNewContext(source, { window: { __ModuleLoader__: { load: ({ factory }) => { plugin = factory(() => ({})) } } } })

test('OA commands activate the conversation while other commands do not', () => {
  const { commandActivity, commandActivityView } = plugin.activity
  assert.equal(commandActivity.match({ type: 'command/run', data: { name: 'other' } }), null)
  assert.equal(commandActivity.match({ type: 'command/run', data: { name: 'oa-helper', commandId: '1' } }).id, '1')
  const builder = commandActivityView.create()
  assert.equal(commandActivityView.isActive(builder.replace({ nodes: [] })), false)
  assert.equal(commandActivityView.isActive(builder.apply({ upserts: [{ key: '1' }] })), true)
  assert.equal(commandActivityView.isActive(builder.apply({ upserts: [] })), true)
  assert.equal(commandActivityView.isActive(builder.replace({ nodes: [] })), false)
})

test('the form is published only after a successful preparation result', () => {
  const { definition, normalize } = plugin.activity
  const state = definition.start({}, { event: { type: 'turn/start', data: { turn: 1 } } })
  const call = { type: 'tool/call', seq: 2, data: { turn: 1, callId: 'c1', name: 'office_workflow_prepare', arguments: JSON.stringify({ kind: 'travel', destination: '杭州' }) } }
  const pending = definition.update({ state }, { event: call })
  assert.equal(definition.buildLocationData({ state: pending }, 'turn', null), null)
  const failed = definition.update({ state: pending }, { event: { type: 'tool/result', data: { message: { source: { callId: 'c1' }, isError: true } } } })
  assert.equal(definition.buildLocationData({ state: failed }, 'turn', null), null)
  const complete = definition.update({ state: pending }, { event: { type: 'tool/result', data: { message: { source: { callId: 'c1' }, isError: false } } } })
  assert.equal(definition.buildLocationData({ state: complete }, 'turn', null).value.data.destination, '杭州')
  assert.equal(normalize({ kind: 'leave' }).leaveType, '')
  assert.equal(normalize({ kind: 'leave', reason: '明天' }).startDate, '')
})
