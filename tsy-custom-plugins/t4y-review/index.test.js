import assert from 'node:assert/strict'
import test from 'node:test'

import { apply, officeWorkflowTool } from './index.js'

test('registers review slash commands without skills', async () => {
  const commands = []
  const tools = []
  await apply({
    commands: { register: command => commands.push(command) },
    tools: { register: tool => tools.push(tool) }
  })
  assert.equal(tools.length, 1)
  assert.equal(tools[0].name, 'office_workflow_prepare')
  assert.deepEqual(commands.map(command => command.name), [
    'leave', 'travel', 'office', 'brand-review', 'brand-review-guidance'
  ])
  assert.deepEqual(await commands[0].handler({ rawInput: '年假 10 月 9 日到 10 月 10 日' }), {
    kind: 'success',
    text: '已创建办公申请，请在会话卡片中补全并确认。'
  })
  assert.deepEqual(await commands[3].handler({ rawInput: '检查桥梁方案' }), {
    kind: 'success',
    text: '已收到审查重点：检查桥梁方案'
  })
  const guidance = await commands[4].handler({ rawInput: '桥梁方案' })
  assert.equal(guidance.kind, 'success')
  assert.match(guidance.text, /审查指导/)
  assert.match(guidance.text, /本次补充：桥梁方案/)
})

test('office workflow tool creates a structured conversation workflow', async () => {
  const tool = officeWorkflowTool()
  const result = await tool.execute({
    kind: 'travel',
    destination: '杭州',
    start_date: '2026-10-09',
    end_date: '2026-10-11',
    reason: '中能铁塔对接'
  })
  assert.deepEqual(result, {
    kind: 'travel',
    message: '已在会话中创建办公申请卡片，请补全并确认后提交。'
  })
  await assert.rejects(() => tool.execute({ kind: 'unknown' }), /kind.*one of/)
})
