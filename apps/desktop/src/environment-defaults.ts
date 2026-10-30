/** First-launch dotenv defaults supplied by a private installer. */
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Seed a profile dotenv only when the user has not created one.
 * @param profile - Initialized Desktop profile directory, under its transaction lock.
 * @param resource - Optional installer-owned dotenv resource; absent resources leave the profile unchanged.
 * @returns After the first-launch copy completes; existing user files are never overwritten.
 */
export function seedDesktopEnvironment(profile: string, resource: string): void {
  const target = join(profile, '.env')
  if (existsSync(target)) return
  let contents: Buffer
  try { contents = readFileSync(resource) }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return
    throw error
  }
  writeFileSync(target, contents, { flag: 'wx', mode: 0o600 })
}
