import { defineTool } from '@deepseek-ai/dsh-tools'
import z from '@deepseek-ai/schemastery'
import { searchVideos } from './lib/search.js'

export const name = 't4y-bilibili-search'
export const inject = ['tools', 'commands']

/** @typedef {{ headed: boolean }} Config */

export const Config = z.object({
  /** When true, show the Chromium window (also honors HEADED=1). */
  headed: z.boolean().default(false),
})

const ORDERS = ['default', 'latest', 'plays', 'comments', 'favorites', 'danmaku']

/**
 * @param {unknown} value
 * @returns {value is Record<string, unknown>}
 */
function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * @param {unknown[]} videos
 * @param {{ keyword: string, order: string }} meta
 * @returns {string}
 */
function renderMarkdown(videos, meta) {
  const orderLabel = meta.order === 'default' ? '综合排序' : meta.order
  const lines = [
    `B站搜索结果（关键词「${meta.keyword}」，${orderLabel}，共 ${videos.length} 条）`,
    '',
    '| # | 标题 | UP主 | 发布 | 播放 | 弹幕 | 评论 |',
    '|---|---|---|---|---|---|---|',
  ]
  videos.forEach((raw, index) => {
    const video = isRecord(raw) ? raw : {}
    const title = String(video.title ?? '')
    const url = String(video.url ?? '')
    const link = url ? `[${title || url}](${url})` : (title || '—')
    lines.push([
      `| ${index + 1} `,
      `| ${link.replace(/\|/g, '\\|')} `,
      `| ${String(video.author ?? '—').replace(/\|/g, '\\|')} `,
      `| ${String(video.publishTime ?? '—').replace(/\|/g, '\\|')} `,
      `| ${String(video.playCount ?? '—')} `,
      `| ${String(video.danmakuCount ?? '—')} `,
      `| ${String(video.commentCount ?? '—')} |`,
    ].join(''))
  })
  return lines.join('\n')
}

/**
 * @param {Config} config
 */
export function bilibiliVideoSearchTool(config) {
  return defineTool({
    name: 'bilibili_video_search',
    description:
      '在 B站（Bilibili）用真实 Chromium（Playwright）搜索视频，返回标题、UP主、发布时间、播放量、弹幕数、评论数与 URL。'
      + '用户要搜 B站/Bilibili、按最新/最多播放/最多评论/最多收藏/最多弹幕排序、或打开第一条时必须调用本工具。'
      + '不要改用 B站 HTTP API，也不要自己写 Playwright 脚本。',
    parameters: {
      keyword: { type: 'string', required: true, description: '搜索关键词。' },
      limit: { type: 'number', description: '返回条数，默认 10。' },
      order: {
        type: 'string',
        enum: ORDERS,
        description:
          '排序：default 综合；latest 最新发布；plays 最多播放；comments 最多评论；favorites 最多收藏；danmaku 最多弹幕。',
      },
      open_first: { type: 'boolean', description: '为 true 时在浏览器中打开第一条视频。' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          keyword: { type: 'string', required: true },
          order: { type: 'string', required: true },
          count: { type: 'number', required: true },
          videos: { type: 'array', required: true },
          markdown: { type: 'string', required: true },
        },
      },
      render: (_args, value) => [{ type: 'text', text: value.markdown }],
    },
    presentCall: (args) => ({
      card: 'generic',
      kind: 'read',
      title: 'B站视频搜索',
      rawInput: args,
    }),
    async execute(args, exec) {
      const keyword = String(args.keyword ?? '').trim()
      if (!keyword) throw new Error('keyword 不能为空')
      const limit = typeof args.limit === 'number' && Number.isFinite(args.limit) && args.limit > 0
        ? Math.floor(args.limit)
        : 10
      const order = ORDERS.includes(args.order) ? args.order : 'default'
      if (exec?.signal?.aborted) throw new Error('Bilibili search was cancelled.')

      const videos = await searchVideos(
        {
          keyword,
          limit,
          order,
          openFirst: args.open_first === true,
        },
        { headed: config.headed === true },
      )
      if (exec?.signal?.aborted) throw new Error('Bilibili search was cancelled.')
      const markdown = renderMarkdown(videos, { keyword, order })
      return { keyword, order, count: videos.length, videos, markdown }
    },
  })
}

/**
 * @param {import('@deepseek-ai/cordis').Context} ctx
 * @param {Config} config
 */
export async function apply(ctx, config) {
  ctx.tools.register(bilibiliVideoSearchTool(config))
  ctx.commands.register({
    name: 'bilibili',
    description: '在 B站搜索视频（可选：关键词与排序说明）。',
    input: { hint: '例如：刘欢 最多播放 10条' },
    handler({ rawInput = '' } = {}) {
      const focus = rawInput.trim()
      return {
        kind: 'success',
        text: focus
          ? `请使用 bilibili_video_search 工具搜索：${focus}`
          : '请使用 bilibili_video_search 工具，并填写 keyword（及可选 limit / order）。',
      }
    },
  })
}
