import assert from 'node:assert/strict'
import test from 'node:test'

import { apply, officeWorkflowTool, parseOaHelperInvocation } from './index.js'

test('registers a single oa-helper slash command', async () => {
  const commands = []
  const tools = []
  await apply({
    commands: { register: command => commands.push(command) },
    tools: { register: tool => tools.push(tool) },
  })
  assert.equal(tools.length, 2)
  assert.deepEqual(tools.map(tool => tool.name), [
    'office_workflow_prepare',
    'zjy_leave_submit',
  ])
  assert.deepEqual(commands.map(command => command.name), ['oa-helper'])
  const messages = []
  const agent = { steer: message => messages.push(message) }
  assert.deepEqual(await commands[0].handler({ agent, rawInput: '年假 10 月 9 日到 10 月 10 日' }), {
    kind: 'success',
    text: '正在分析申请内容。',
  })
  assert.match(messages[0].content[0].text, /年假 10 月 9 日到 10 月 10 日/)
  assert.deepEqual(await commands[0].handler({ agent, rawInput: 'travel 去杭州' }), {
    kind: 'success',
    text: '正在分析申请内容。',
  })
  assert.equal((await commands[0].handler({ agent, rawInput: '' })).kind, 'error')
  assert.equal(messages.length, 2)
  assert.deepEqual(await commands[0].handler({ rawInput: 'submit' }), {
    kind: 'error',
    text: 'leave-submit 需要 JSON：leave_type、start_date、end_date、reason',
  })
})

test('parseOaHelperInvocation maps aliases and defaults', () => {
  assert.deepEqual(parseOaHelperInvocation(''), { action: 'leave', rest: '' })
  assert.deepEqual(parseOaHelperInvocation('出差 去杭州'), { action: 'travel', rest: '去杭州' })
  assert.deepEqual(parseOaHelperInvocation('年假明天'), { action: 'leave', rest: '年假明天' })
  assert.deepEqual(parseOaHelperInvocation('submit {"leave_type":"sick"}'), {
    action: 'submit',
    rest: '{"leave_type":"sick"}',
  })
  // Former review aliases are treated as free-text leave input, not review actions.
  assert.deepEqual(parseOaHelperInvocation('review 检查桥梁'), {
    action: 'leave',
    rest: 'review 检查桥梁',
  })
})

test('office workflow tool creates a structured conversation workflow', async () => {
  const tool = officeWorkflowTool()
  let concluded = false
  const result = await tool.execute({
    kind: 'travel',
    destination: '杭州',
    start_date: '2026-10-09',
    end_date: '2026-10-11',
    reason: '中能铁塔对接',
  }, { concludeTurn: () => { concluded = true } })
  assert.equal(concluded, true)
  assert.deepEqual(result, {
    kind: 'travel',
    message: '已创建办公申请卡片。请停止回复并等待用户在卡片中补全、确认后提交；本轮不要再输出任何文字或调用工具。',
  })
  await assert.rejects(() => tool.execute({ kind: 'unknown' }), /不支持的办公申请类型/)
})
