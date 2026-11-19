/** Verify shell failure classification and the administrator's persisted report. */
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { SessionId } from '@deepseek-ai/dsh-session'
import { expect, it } from 'vitest'
import { missingPythonModule, PythonMissingReport, redirectedPythonMissingModules } from '../src/python-missing.ts'

it('records an uncaught missing import from stderr of a failed foreground command', () => {
  const traceback = [
    'Traceback (most recent call last):',
    '  File "<string>", line 1, in <module>',
    "ModuleNotFoundError: No module named 'fitz'",
  ].join('\r\n')
  const result = { kind: 'foreground', exitCode: 1, signal: null, timedOut: false, aborted: false,
    stderr: { text: traceback, truncated: false } }
  expect(missingPythonModule(result)).toBe('fitz')
  expect(missingPythonModule({ ...result, exitCode: 0 })).toBeUndefined()
  expect(missingPythonModule({ ...result, timedOut: true })).toBeUndefined()
  expect(missingPythonModule({ ...result, stderr: { ...result.stderr, truncated: true } })).toBeUndefined()
  expect(missingPythonModule({ ...result, stdout: result.stderr, stderr: { text: '', truncated: false } })).toBeUndefined()
  expect(missingPythonModule({ ...result, stderr: { text: traceback + '\nPermission denied', truncated: false } })).toBeUndefined()
})

it('collects redirected Python tracebacks even when the pipeline exits zero and prints more output', () => {
  const command = '"$DSH_OPENAI_PYTHON" -c "import matplotlib" 2>&1 | tail -3; date +%F; ls'
  const stdout = [
    'Python 3.10.17',
    'Traceback (most recent call last):',
    '  File "<string>", line 1, in <module>',
    "ModuleNotFoundError: No module named 'matplotlib'",
    '2026-11-18',
    'report',
  ].join('\n')
  const result = { kind: 'foreground', exitCode: 0, signal: null, timedOut: false, aborted: false,
    stdout: { text: stdout, truncated: false }, stderr: { text: '', truncated: false } }
  expect(redirectedPythonMissingModules(command, result)).toEqual(['matplotlib'])
  expect(redirectedPythonMissingModules('echo example', result)).toEqual([])
  expect(redirectedPythonMissingModules(command, { ...result, aborted: true })).toEqual([])
  expect(redirectedPythonMissingModules(command, { ...result, stdout: { text: stdout, truncated: true } })).toEqual([])
  expect(redirectedPythonMissingModules(command, { ...result, stdout: { text: stdout.split('\n')[3], truncated: false } })).toEqual([])
})

it('ranks cumulative Session counts and retains observations older than 30 days after restart', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'dsh-python-missing-'))
  try {
    const report = new PythonMissingReport(workspace)
    const path = join(workspace, 'python-missing.md')
    const day = 24 * 60 * 60 * 1000
    const now = Date.UTC(2026, 10, 18)
    const first = SessionId('first-session')
    const second = SessionId('second-session')
    await Promise.all([
      report.record(first, new Map([['pandas', now - day], ['fitz', now - day]]), now),
      report.record(first, new Map([['pandas', now]]), now),
      report.record(second, new Map([['pandas', now], ['report_utils', now]]), now),
    ])
    const saved = await readFile(path, 'utf8')
    expect(saved).toContain('| `pandas` | `pandas` | 2 | 待评估 |')
    expect(saved).toContain('| `fitz` | `PyMuPDF` | 1 | 待评估 |')
    expect(saved).toContain('| `report_utils` | 待确认 | 1 | 待确认模块来源 |')
    expect(saved).not.toContain(first)
    const restarted = new PythonMissingReport(workspace)
    const later = now + 90 * day
    await restarted.record(second, new Map([['pandas', later]]), later)
    const refreshed = await readFile(path, 'utf8')
    expect(refreshed).toContain('| 累计受影响会话数 |')
    expect(refreshed).toContain('| `pandas` | `pandas` | 2 | 待评估 |')
    expect(refreshed).toContain('| `fitz` | `PyMuPDF` | 1 | 待评估 |')
  } finally {
    await rm(workspace, { recursive: true, force: true })
  }
})
