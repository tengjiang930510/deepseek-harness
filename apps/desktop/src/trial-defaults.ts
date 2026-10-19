/** Optional installer-owned model defaults for a private trial build. */

import { readFileSync } from 'node:fs'

/** Credential carried by one trial installer for its bundled runtime plugin. */
export interface DesktopTrialDefaults {
  /** Bundle name that owns the configuration using this credential. */
  readonly plugin: string
  readonly credentialRef: string
  readonly credential: string
}

/**
 * Read the optional trial resource before profile initialization and Host launch.
 * @param path - Resource path inside the installed application.
 * @returns Validated defaults, or undefined when the application has no trial resource.
 */
export function readDesktopTrialDefaults(path: string): DesktopTrialDefaults | undefined {
  let source: string
  try {
    source = readFileSync(path, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw error
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(source)
  } catch {
    throw new Error('desktop trial defaults: invalid JSON resource')
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error('desktop trial defaults: expected an object')
  }
  const value = parsed as Record<string, unknown>
  if (Object.keys(value).sort().join(',') !== 'credential,credentialRef,plugin'
    || typeof value.plugin !== 'string' || !/^(?:@[-a-z0-9~][a-z0-9~._-]*\/)?[-a-z0-9~][a-z0-9~._-]*$/iu.test(value.plugin)
    || typeof value.credentialRef !== 'string' || !/^[A-Za-z_][A-Za-z0-9_]*$/u.test(value.credentialRef)
    || typeof value.credential !== 'string' || !/^[\x21-\x7e]+$/u.test(value.credential)) {
    throw new Error('desktop trial defaults: invalid credential fields')
  }
  return { plugin: value.plugin, credentialRef: value.credentialRef, credential: value.credential }
}
