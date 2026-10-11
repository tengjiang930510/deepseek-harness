import assert from 'node:assert/strict'
import test from 'node:test'

import { apply } from './index.js'

async function searchCommand() {
  const commands = []
  await apply({
    tools: { register() {} },
    commands: { register(command) { commands.push(command) } },
  }, { headed: false })
  return commands.find(command => command.name === 'bilibili')
}

test('bilibili submits the search request to the receiving agent', async () => {
  const command = await searchCommand()
  const messages = []
  const result = command.handler({
    agent: { steer(message) { messages.push(message) } },
    rawInput: '  帮我搜索刘欢视频 最多播放 10条  ',
  })
  assert.deepEqual(result, { kind: 'success' })
  assert.equal(messages.length, 1)
  assert.equal(typeof messages[0].id, 'string')
  assert.deepEqual(messages[0].source, { kind: 'user' })
  assert.deepEqual(messages[0].content, [{
    type: 'text',
    text: '请使用 bilibili_video_search 工具搜索：帮我搜索刘欢视频 最多播放 10条',
  }])
})

test('bilibili rejects empty keywords without waking the agent', async () => {
  const command = await searchCommand()
  for (const rawInput of ['', ' \t\n ']) {
    const result = command.handler({
      agent: { steer() { assert.fail('empty keywords must not wake the agent') } },
      rawInput,
    })
    assert.deepEqual(result, {
      kind: 'error',
      text: '请输入 B站搜索关键词，例如：刘欢 最多播放 10条。',
    })
  }
})

test('bilibili reports an agent submission failure instead of success', async () => {
  const command = await searchCommand()
  const failure = new Error('agent disposed')
  assert.throws(() => command.handler({
    agent: { steer() { throw failure } },
    rawInput: '刘欢',
  }), error => error === failure)
})
