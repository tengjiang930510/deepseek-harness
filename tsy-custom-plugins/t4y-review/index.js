import { readFile } from 'node:fs/promises'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { submitLeaveForm } from './src/leave-open.js'

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

/** Login, fill 办公平台请假 form, and click 发起流程. */
export function leaveFormSubmitTool() {
  return defineTool({
    name: 'zjy_leave_submit',
    description:
      '用 Playwright 登录办公平台，进入请假申请「新增」，填写假别/开始日期/结束日期/事由并点击「发起流程」。'
      + '当用户确认要将请假单提交到办公平台时必须调用本工具。'
      + 'leave_type：annual 年假、personal 事假、sick 病假；日期 YYYY-MM-DD。',
    parameters: {
      leave_type: {
        type: 'string',
        required: true,
        enum: ['annual', 'personal', 'sick'],
        description: '假别：annual 年假，personal 事假，sick 病假。',
      },
      start_date: { type: 'string', required: true, description: '开始日期，YYYY-MM-DD。' },
      end_date: { type: 'string', required: true, description: '结束日期，YYYY-MM-DD。' },
      reason: { type: 'string', required: true, description: '请假事由。' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          finalUrl: { type: 'string', required: true },
          title: { type: 'string', required: true },
          leaveType: { type: 'string', required: true },
          startDate: { type: 'string', required: true },
          endDate: { type: 'string', required: true },
          reason: { type: 'string', required: true },
          submitted: { type: 'boolean', required: true },
          message: { type: 'string', required: true },
        },
      },
      render: (_args, value) => [{ type: 'text', text: value.message }],
    },
    presentCall: (args) => ({
      card: 'generic',
      kind: 'write',
      title: '办公平台请假提交',
      rawInput: args,
    }),
    async execute(args, exec) {
      if (exec?.signal?.aborted) throw new Error('Leave submit was cancelled.')
      const result = await submitLeaveForm({
        leaveType: args.leave_type,
        startDate: args.start_date,
        endDate: args.end_date,
        reason: args.reason,
        headed: process.env.HEADED === '1' || process.env.HEADED === 'true',
        submit: true,
      })
      if (exec?.signal?.aborted) throw new Error('Leave submit was cancelled.')
      return {
        ...result,
        message: [
          '已在办公平台填写并点击「发起流程」。',
          `假别：${result.leaveType}`,
          `开始：${result.startDate}`,
          `结束：${result.endDate}`,
          `事由：${result.reason}`,
          `页面：${result.title}`,
          `URL：${result.finalUrl}`,
        ].join('\n'),
      }
    },
  })
}

/**
 * Parse JSON payload from `/leave-submit {...}`.
 * @param {string} rawInput
 */
function parseLeaveSubmitPayload(rawInput) {
  const text = String(rawInput ?? '').trim()
  if (!text) throw new Error('leave-submit 需要 JSON：leave_type、start_date、end_date、reason')
  let payload
  try {
    payload = JSON.parse(text)
  } catch {
    throw new Error('leave-submit 参数不是合法 JSON')
  }
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
    throw new Error('leave-submit 参数必须是 JSON 对象')
  }
  const leaveType = String(payload.leave_type ?? '').trim()
  const startDate = String(payload.start_date ?? '').trim()
  const endDate = String(payload.end_date ?? '').trim()
  const reason = String(payload.reason ?? '').trim()
  if (!leaveType || !startDate || !endDate || !reason) {
    throw new Error('leave-submit 缺少 leave_type / start_date / end_date / reason')
  }
  return { leaveType, startDate, endDate, reason }
}

export async function apply(ctx) {
  ctx.tools.register(officeWorkflowTool())
  ctx.tools.register(leaveFormSubmitTool())
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
    name: 'leave-submit',
    description: '将会话请假卡片提交到办公平台（Playwright 填表并发起流程）。',
    input: { hint: 'JSON：{"leave_type":"sick","start_date":"YYYY-MM-DD","end_date":"YYYY-MM-DD","reason":"..."}' },
    async handler({ rawInput = '', signal } = {}) {
      try {
        const payload = parseLeaveSubmitPayload(rawInput)
        if (signal?.aborted) throw new Error('Leave submit was cancelled.')
        const result = await submitLeaveForm({
          ...payload,
          headed: false,
          submit: true,
        })
        if (signal?.aborted) throw new Error('Leave submit was cancelled.')
        return {
          kind: 'success',
          text: [
            '已提交到办公平台并点击「发起流程」。',
            `假别：${result.leaveType}`,
            `开始：${result.startDate}`,
            `结束：${result.endDate}`,
            `事由：${result.reason}`,
          ].join('\n'),
        }
      } catch (error) {
        return {
          kind: 'error',
          text: error instanceof Error ? error.message : String(error),
        }
      }
    },
  })
  ctx.commands.register({
    name: 'brand-review',
    description: '发起武汉地铁智能助手审查任务。',
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
    description: '查看武汉地铁智能助手的审查指导。',
    input: { hint: '可选：补充审查对象或重点' },
    handler({ rawInput = '' } = {}) {
      return loadGuidance(rawInput)
    }
  })
}
