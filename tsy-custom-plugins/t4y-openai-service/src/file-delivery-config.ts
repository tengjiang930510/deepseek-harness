/** Shared validated file-delivery defaults and deployment limits. */
import z from '@deepseek-ai/schemastery'

/** File publication settings for final OpenAI response references. */
export interface FileUploadConfig {
  enabled: true
  url: string
  businessKey: string
  maxFileBytes: number
  maxFiles: number
  timeoutMs: number
  maxResponseBytes: number
}

/** Resolve optional or partial settings; explicit enabled:false disables publication. */
export const fileDeliveryConfig = z.union([z.const(undefined), z.object({ enabled: z.const(false).required() }), z.object({
    enabled: z.const(true).default(true),
    url: z.string().default(process.env.DSH_FILE_UPLOAD_URL ?? 'https://jgyw.crfsdi.com.cn:51111/backendapi/file/anonymous-upload'),
    businessKey: z.string().default('zhjl-deepseek-harness'),
    maxFileBytes: z.number().step(1).min(1).default(52428800),
    maxFiles: z.number().step(1).min(1).default(10),
    timeoutMs: z.number().step(1).min(1).default(60000),
    maxResponseBytes: z.number().step(1).min(1).default(65536),
  })]).default({ enabled: true })
