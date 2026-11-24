/** Compatibility conversion of final Markdown through the shared file-delivery component. */
import { realpath, stat } from 'node:fs/promises'
import { basename, isAbsolute, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { fromMarkdown } from 'mdast-util-from-markdown'
import type { Nodes } from 'mdast'
import { HarnessError } from '@deepseek-ai/dsh-error'
import { FileDeliveryError } from './file-delivery-error.ts'
import { isWorkspacePath } from './file-delivery.ts'
import type { FileDelivery } from './file-delivery.ts'

const failure = (message: string, cause?: unknown): FileDeliveryError => new FileDeliveryError(message, { cause })

function localPath(value: string, encoded: boolean): string | undefined {
  if (value.startsWith('file:')) return fileURLToPath(value)
  if (isAbsolute(value)) return encoded ? decodeURIComponent(value) : value
  if (/^[a-z][a-z0-9+.-]*:/iu.test(value) || value.startsWith('#') || value.startsWith('//')) return undefined
  return encoded ? decodeURIComponent(value) : value
}

/**
 * Replace Markdown file/image destinations and existing inline-code file paths with uploaded URLs.
 * Directories, outside-workspace inline paths, ordinary code, web links, and fenced code blocks are left untouched. Local files are retained.
 * @param text - Settled assistant Markdown, never tool traces or private reasoning.
 * @param delivery - Request-owned file component shared with the explicit delivery tool.
 * @returns Markdown with confirmed URLs and visible notices for references exceeding the file count.
 */
export async function publishFiles(text: string, delivery: FileDelivery): Promise<string> {
  const { cwd, signal } = delivery
  const nodes: Nodes[] = []
  const visit = (node: Nodes, insideLink = false): void => {
    if ('children' in node) for (const child of node.children) visit(child, insideLink || node.type === 'link')
    if (node.type === 'link' || node.type === 'image' || node.type === 'definition'
      || (node.type === 'inlineCode' && !insideLink)) nodes.push(node)
  }
  visit(fromMarkdown(text))
  const replacements: { start: number; end: number; value: string }[] = []
  let definitionLimitExceeded = false
  try {
    for (const node of nodes) {
      signal.throwIfAborted()
      if (node.type !== 'link' && node.type !== 'image' && node.type !== 'definition' && node.type !== 'inlineCode') continue
      const value = node.type === 'inlineCode' ? node.value : node.url
      const path = localPath(value, node.type !== 'inlineCode')
      if (path === undefined || path.trim() === '') continue
      let limitExceeded = false
      let url = node.type === 'inlineCode' ? undefined : delivery.previewUrl(path)
      if (url === undefined) {
        try {
          if (node.type === 'inlineCode' && !isWorkspacePath(await realpath(cwd), await realpath(resolve(cwd, path)))) continue
          if ((await stat(resolve(cwd, path))).isDirectory()) continue
        }
        catch (error) {
          if (node.type === 'inlineCode' && error instanceof Error && 'code' in error
            && (error.code === 'ENOENT' || error.code === 'ENOTDIR')) continue
          throw error
        }
        try {
          url = (await delivery.deliver(path)).url
        } catch (error) {
          signal.throwIfAborted()
          if (!(error instanceof FileDeliveryError) || !error.limitExceeded) throw error
          limitExceeded = true
        }
      }
      const start = node.position?.start.offset
      const end = node.position?.end.offset
      if (start === undefined || end === undefined) throw failure('A delivery reference has no Markdown position.')
      let replacement: string
      if (limitExceeded && node.type === 'definition') definitionLimitExceeded = true
      if (limitExceeded) replacement = node.type === 'definition'
        ? `[${node.identifier}]: #file-not-delivered "文件未交付：本轮文件数量已达上限，请下一轮单独请求。"`
        : '（文件未交付：本轮文件数量已达上限，请下一轮单独请求。）'
      else if (node.type === 'definition') replacement = `[${node.identifier}]: <${url}>`
      else if (node.type === 'inlineCode') replacement = `[${basename(path).replace(/[\\[\]]/gu, '\\$&')}](<${url}>)`
      else if (node.type === 'image') replacement = `![${(node.alt ?? '').replace(/[\\[\]]/gu, '\\$&')}](<${url}>)`
      else {
        const labelStart = node.children[0]?.position?.start.offset ?? start + 1
        const labelEnd = node.children.at(-1)?.position?.end.offset ?? labelStart
        let label = text.slice(labelStart, labelEnd)
        for (const change of replacements.filter(change => change.start >= labelStart && change.end <= labelEnd).reverse()) {
          label = label.slice(0, change.start - labelStart) + change.value + label.slice(change.end - labelStart)
        }
        replacement = `[${label}](<${url}>)`
      }
      for (let index = replacements.length - 1; index >= 0; index--) {
        const change = replacements[index]!
        if (change.start >= start && change.end <= end) replacements.splice(index, 1)
      }
      replacements.push({ start, end, value: replacement })
    }
    let result = text
    for (const change of replacements.reverse()) result = result.slice(0, change.start) + change.value + result.slice(change.end)
    if (definitionLimitExceeded) {
      result += '\n\n文件未交付：本轮文件数量已达上限，请下一轮单独请求。'
    }
    return result
  } catch (error) {
    signal.throwIfAborted()
    if (error instanceof HarnessError) throw error
    throw failure('File publication failed; local files were retained and remote effects may have occurred. Do not retry automatically.', error)
  }
}
