import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { readDesktopTrialDefaults } from '../src/trial-defaults.ts'

const roots: string[] = []
function resource(contents: string): string {
  const root = mkdtempSync(join(tmpdir(), 'dsh-desktop-trial-'))
  roots.push(root)
  const path = join(root, 'trial-defaults.json')
  writeFileSync(path, contents)
  return path
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('trial installer defaults', () => {
  it('leaves ordinary builds without a trial resource unchanged', () => {
    expect(readDesktopTrialDefaults(join(tmpdir(), 'missing-desktop-trial-defaults.json'))).toBeUndefined()
  })

  it('reads a profile patch and credential for the Host', () => {
    const defaults = { patch: '- id: llm-pi-ai\n', credentialRef: 'TRIAL_API_KEY', credential: 'trial-key' }
    expect(readDesktopTrialDefaults(resource(JSON.stringify(defaults)))).toEqual(defaults)
  })

  it('rejects malformed resources without including their contents in the error', () => {
    const path = resource(JSON.stringify({ patch: '[]', credentialRef: 'BAD-REF', credential: 'private-value' }))
    expect(() => readDesktopTrialDefaults(path)).toThrow('desktop trial defaults: invalid profile patch or credential fields')
  })
})
