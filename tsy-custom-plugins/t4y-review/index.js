import { readFile } from 'node:fs/promises'
import { defineTool } from '@deepseek-ai/dsh-tools'

export const name = 't4y-review'
export const inject = ['commands', 'tools']

const guidanceFile = new URL('./guidance.md', import.meta.url)

async function loadGuidance(rawInput = '') {
  const guidance = (await readFile(guidanceFile, 'utf8')).trim()
  const focus = rawInput.trim()
  return {
    kind: 'success',
    text: focus ? `${guidance}\n\n本次补充：${focus}` : guidance
  }
}

const OFFICE_KINDS = new Set(['leave', 'travel', 'office'])

function optionalText(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

export function officeWorkflowTool() {
  return defineTool({
    name: 'office_workflow_prepare',
    description: '当用户自然语言提出请假、出差、会议预约、办公用品申领或流程台账查询时，必须调用此工具创建或补全会话中的办公申请卡片。优先从用户原话提取信息；不确定的字段留空，不要编造。请假用 kind="leave"，出差用 kind="travel"，其他办公事务用 kind="office"。日期使用 YYYY-MM-DD；如用户仅给出相对日期，结合当前日期换算后填写。用户说“明天请假去杭州、三天后回”属于出差，应填 destination、start_date、end_date 和 reason。',
    parameters: {
      kind: { type: 'string', required: true, enum: ['leave', 'travel', 'office'], description: '申请类型。' },
      leave_type: { type: 'string', enum: ['annual', 'personal', 'sick'], description: '请假类型。' },
      start_date: { type: 'string', description: '开始日期，YYYY-MM-DD。' },
      end_date: { type: 'string', description: '结束日期，YYYY-MM-DD。' },
      destination: { type: 'string', description: '出差地点。' },
      itinerary: { type: 'string', description: '行程安排。' },
      budget: { type: 'number', description: '预算金额（元）。' },
      companions: { type: 'string', description: '同行人。' },
      office_type: { type: 'string', enum: ['meeting', 'supplies', 'ledger'], description: '办公事务类型。' },
      subject: { type: 'string', description: '会议主题、用品名称或台账查询主题。' },
      reason: { type: 'string', description: '请假或出差事由。' },
      detail: { type: 'string', description: '办公事务说明。' }
    },
    output: {
      schema: { type: 'object', additionalProperties: false, properties: {
        kind: { type: 'string', required: true },
        message: { type: 'string', required: true }
      } },
      render: (_args, value) => [{ type: 'text', text: value.message }]
    },
    presentCall: args => ({ card: 'generic', kind: 'write', title: '创建办公申请', rawInput: args }),
    async execute(args) {
      if (!OFFICE_KINDS.has(args.kind)) throw new Error('不支持的办公申请类型。')
      return { kind: args.kind, message: '已在会话中创建办公申请卡片，请补全并确认后提交。' }
    }
  })
}

export async function apply(ctx) {
  ctx.tools.register(officeWorkflowTool())
  for (const [name, description] of [
    ['leave', '发起请假申请，在会话中填写并确认表单。'],
    ['travel', '发起出差申请，在会话中填写并确认表单。'],
    ['office', '发起会议、用品或流程台账办公事务，在会话中填写并确认表单。']
  ]) {
    ctx.commands.register({
      name,
      description,
      input: { hint: '可选：先填写已知信息，例如“年假 10 月 9 日到 10 月 10 日”' },
      handler: () => ({ kind: 'success', text: '已创建办公申请，请在会话卡片中补全并确认。' })
    })
  }
  ctx.commands.register({
    name: 'brand-review',
    description: '发起铁四院智能助手审查任务。',
    input: { hint: '可选：补充审查重点' },
    async handler({ rawInput = '' } = {}) {
      const focus = rawInput.trim()
      return {
        kind: 'success',
        text: focus ? `已收到审查重点：${focus}` : '已收到审查任务。'
      }
    }
  })
  ctx.commands.register({
    name: 'brand-review-guidance',
    description: '查看铁四院智能助手的审查指导。',
    input: { hint: '可选：补充审查对象或重点' },
    handler({ rawInput = '' } = {}) {
      return loadGuidance(rawInput)
    }
  })
}
