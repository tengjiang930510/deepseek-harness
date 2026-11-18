/** Deployment-owned model routes and HTTP execution limits. */
import { resolve } from 'node:path'
import z from '@deepseek-ai/schemastery'
import { fileDeliveryConfig } from './file-delivery-config.ts'
import type { FileUploadConfig } from './file-delivery-config.ts'
export type { FileUploadConfig } from './file-delivery-config.ts'

/** Default model workspace relative to the service launch directory. */
export const defaultOpenAiWorkspace = resolve(process.cwd(), '.openai-service-workspace')

/** One public model identifier and its server-owned execution settings. */
export interface ModelRoute {
  /** Identifier accepted in the request's model field. */
  id: string
  /** Registered Harness provider. */
  provider: string
  /** Exact upstream model identifier. */
  model: string
  /** Absolute root for new Session workspaces on this route. */
  cwd: string
  /** Allowlisted Harness tools; an empty list permits no tools. */
  tools: string[]
  /** Output-token ceiling for each conversation-model call. */
  maxTokens: number
}

/** Authentication, public model routes, and finite request limits. */
export interface Config {
  /** Multipart publication defaults to enabled when omitted; explicit enabled:false disables it. */
  fileUpload?: FileUploadConfig | { enabled: false } | undefined
  /**
   * Optional credential reference resolved at startup and per request;
   * omission permits anonymous access. A configured missing credential rejects startup.
   */
  apiKeyEnv?: string
  /** Unique public model identifiers and their controlled capabilities. */
  models: ModelRoute[]
  /** Maximum simultaneous chat requests, including upload and cleanup. */
  maxConcurrent: number
  /** Complete JSON request body byte limit. */
  maxBodyBytes: number
  /** Combined UTF-8 byte limit on assistant answers and public execution progress. */
  maxOutputBytes: number
  /** Delay in milliseconds before an unfinished tool call receives a running notice. */
  progressDelayMs: number
  /** Deadline from admission through Agent execution, in milliseconds. */
  requestTimeoutMs: number
  /**
   * Maximum root-Agent model steps per HTTP request.
   * @default 100
   */
  maxSteps: number
  /**
   * Cumulative reported root conversation-model tokens; checked between calls, not a billing ceiling.
   * @default 10485760
   */
  maxTotalTokens: number
  /** Maximum queued response bytes before a slow client is disconnected. */
  maxBufferedBytes: number
}

/** Validate deployment settings without implicit execution-time defaults. */
export const Config: z<Config> = z.object({
  apiKeyEnv: z.string(),
  fileUpload: fileDeliveryConfig,
  models: z.array(z.object({
    id: z.string().required(), provider: z.string().required(), model: z.string().required(),
    cwd: z.string().default(defaultOpenAiWorkspace), tools: z.array(z.string()).required(),
    maxTokens: z.number().step(1).min(1).required(),
  })).required(),
  maxConcurrent: z.number().step(1).min(1).default(8),
  maxBodyBytes: z.number().step(1).min(1).default(1048576),
  maxOutputBytes: z.number().step(1).min(1).default(1048576),
  progressDelayMs: z.number().step(1).min(1).default(1500),
  requestTimeoutMs: z.number().step(1).min(1).default(1200000),
  maxSteps: z.number().step(1).min(1).default(100),
  maxTotalTokens: z.number().step(1).min(1).default(10485760),
  maxBufferedBytes: z.number().step(1).min(1).default(1048576),
})
