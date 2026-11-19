/** Persist advisory Python import failures as one readable Markdown report. */
import { execFile } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { promisify } from 'node:util'
import type { SessionId } from '@deepseek-ai/dsh-session'
import { z } from 'zod'

const moduleName = /^[a-zA-Z_][a-zA-Z_0-9]*(?:\.[a-zA-Z_0-9]+)*$/u
const topLevelModule = /^[a-zA-Z_][a-zA-Z_0-9]{0,199}$/u
const records = z.array(z.tuple([z.string().max(200).regex(moduleName), z.string().regex(/^[0-9a-f]{64}$/u), z.number().int().nonnegative()]))
const untruncatedOutput = z.object({ text: z.string(), truncated: z.literal(false) })
const settledShell = z.object({
  kind: z.literal('foreground'),
  exitCode: z.number().int(),
  signal: z.null(),
  timedOut: z.literal(false),
  aborted: z.literal(false),
  stopped: z.never().optional(),
  sandbox: z.object({ denied: z.literal(false), runnerFailed: z.literal(false).optional() }).optional(),
})
const failedShell = settledShell.extend({ stderr: untruncatedOutput }).refine(result => result.exitCode !== 0)
const shellWithStdout = settledShell.extend({ stdout: untruncatedOutput })
const runPython = promisify(execFile)
const knownPackages = new Map([
  ['pandas', 'pandas'], ['numpy', 'numpy'], ['matplotlib', 'matplotlib'],
  ['fitz', 'PyMuPDF'], ['cv2', 'opencv-python'], ['bs4', 'beautifulsoup4'],
  ['PIL', 'Pillow'], ['docx', 'python-docx'], ['pptx', 'python-pptx'],
  ['openpyxl', 'openpyxl'], ['pypdf', 'pypdf'], ['yaml', 'PyYAML'],
])

/**
 * Identify a missing module from an untruncated, failed shell traceback.
 * @param output - the shell tool's execution-local result value.
 * @returns the reported import name when the failure can be identified.
 */
export function missingPythonModule(output: unknown): string | undefined {
  const result = failedShell.safeParse(output)
  if (!result.success) return undefined
  const stderr = result.data.stderr.text.trimEnd()
  if (!/^Traceback \(most recent call last\):\r?$/mu.test(stderr)) return undefined
  const name = /(?:^|\n)ModuleNotFoundError: No module named '([^'\r\n]{1,200})'$/u.exec(stderr)?.[1]
  return name !== undefined && moduleName.test(name) ? name : undefined
}

/**
 * Extract top-level import candidates from tracebacks in redirected Python output.
 * @param command - the shared interpreter invocation, including its redirection.
 * @param output - the shell tool's execution-local result value.
 * @returns names that require a shared interpreter check before reporting.
 */
export function redirectedPythonMissingModules(command: string, output: unknown): string[] {
  if (!/\b2\s*>\s*&\s*1\b/u.test(command)) return []
  const result = shellWithStdout.safeParse(output)
  if (!result.success) return []
  const traceback = /^Traceback \(most recent call last\):\r?\n(?=[ \t]+File )(?:(?:[ \t][^\n]*|\r?)\n)*ModuleNotFoundError: No module named '([^'\r\n]{1,200})'\r?$/gmu
  return [...result.data.stdout.text.matchAll(traceback)].flatMap(([, name]) =>
    name !== undefined && topLevelModule.test(name) ? [name] : [])
}

/**
 * Check module availability without importing candidates or using the Session working directory.
 * @param python - the configured shared interpreter.
 * @param modules - candidate top-level import names.
 * @param signal - the owning OpenAI request's deadline and cancellation signal.
 * @returns the candidates absent from the shared environment.
 */
export async function confirmMissingPythonModules(python: string, modules: readonly string[], signal: AbortSignal): Promise<string[]> {
  if (modules.length === 0) return []
  const { stdout } = await runPython(python, ['-I', '-c',
    'import importlib.util, json, sys; print(json.dumps([name for name in sys.argv[1:] if importlib.util.find_spec(name) is None]))',
    ...modules,
  ], { signal, windowsHide: true })
  return z.array(z.string().regex(topLevelModule)).parse(JSON.parse(stdout))
}

/** One report writer per OpenAI service process, shared by its model routes. */
export class PythonMissingReport {
  private pending: Promise<void> = Promise.resolve()

  /** @param workspace - the service workspace containing the report. */
  constructor(private readonly workspace: string) {}

  /**
   * Record observations and atomically replace the report. Failed writes leave the prior report readable.
   * @param session - Harness session whose observations are deduplicated.
   * @param modules - latest observation time for each module in the request.
   * @param now - time shown as the latest update in the report.
   * @returns completion of this write, or a rejection for the request owner to log.
   */
  record(session: SessionId, modules: ReadonlyMap<string, number>, now: number): Promise<void> {
    if (modules.size === 0) return Promise.resolve()
    const update = this.pending.then(() => this.write(session, modules, now))
    this.pending = update.catch(() => { /* The caller reports the failure and later observations may still be written. */ })
    return update
  }

  private async write(session: SessionId, modules: ReadonlyMap<string, number>, now: number): Promise<void> {
    await mkdir(this.workspace, { recursive: true })
    const report = join(this.workspace, 'python-missing.md')
    const previous = await readFile(report, 'utf8').catch((error: unknown) => {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return undefined
      throw error
    })
    const saved = previous === undefined ? [] : records.parse(JSON.parse(/\n<!-- python-missing:v1\n([^\n]+)\n-->\n$/u.exec(previous)?.[1] ?? 'null'))
    const observations = new Map<string, Map<string, number>>()
    for (const [name, key, time] of saved) {
      const sessions = observations.get(name) ?? new Map<string, number>()
      sessions.set(key, time)
      observations.set(name, sessions)
    }
    const key = createHash('sha256').update(session).digest('hex')
    for (const [name, time] of modules) {
      const sessions = observations.get(name) ?? new Map<string, number>()
      sessions.set(key, Math.max(sessions.get(key) ?? 0, time))
      observations.set(name, sessions)
    }
    const rows = [...observations].sort(([a, left], [b, right]) => right.size - left.size || a.localeCompare(b))
    const lines = ['# Python 缺包统计', '', `统计截至 ${new Date(now).toISOString()}。同一会话内的重复缺包只计一次。`, '',
      '| 缺少的模块 | 建议核对的 pip 包 | 累计受影响会话数 | 状态 |', '| --- | --- | ---: | --- |']
    for (const [name, sessions] of rows) {
      const pkg = knownPackages.get(name)
      lines.push(`| \`${name}\` | ${pkg === undefined ? '待确认' : `\`${pkg}\``} | ${sessions.size} | ${pkg === undefined ? '待确认模块来源' : '待评估'} |`)
    }
    // The comment preserves observations for deduplication after restart.
    const state = rows.flatMap(([name, sessions]) => [...sessions].map(([key, time]) => [name, key, time]))
    const temp = join(this.workspace, `.python-missing-${randomUUID()}.tmp`)
    try {
      await writeFile(temp, `${lines.join('\n')}\n\n<!-- python-missing:v1\n${JSON.stringify(state)}\n-->\n`, { mode: 0o600, flag: 'wx' })
      await rename(temp, report)
    } finally {
      await rm(temp, { force: true })
    }
  }
}
