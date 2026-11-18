/** Agent-scoped tool adapter over request-owned file delivery. */
import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { FileDelivery } from './file-delivery.ts'

/** Tool name reserved for confirmed API file publications. */
export const DELIVER_FILE_TOOL = 'deliver_file'

/**
 * Register a delivery tool whose results enter the ordinary durable tool transcript.
 * @param ctx - Agent scope owning the tool registration.
 * @param delivery - Shared request component for tool and Markdown publications.
 */
export function registerDeliveryTool(ctx: Context, delivery: FileDelivery): void {
  ctx.effect(() => ctx.tools.register(defineTool({
    name: DELIVER_FILE_TOOL,
    description: 'Upload a finished file for the user and return its confirmed download URL, filename, size and MIME type. '
      + 'The original stays local. Do not automatically retry a failed upload: a remote copy may already exist.',
    parameters: {
      path: { type: 'string', required: true,
        description: 'Existing individual file within the working directory; relative paths use that directory.' },
    },
    output: {
      schema: {
        type: 'object', additionalProperties: false,
        properties: {
          name: { type: 'string', required: true }, url: { type: 'string', required: true },
          size: { type: 'integer', required: true }, mediaType: { type: 'string', required: true },
        },
      },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
    },
    execute: (args, exec) => delivery.deliver(args.path, exec.signal),
  })))
}
