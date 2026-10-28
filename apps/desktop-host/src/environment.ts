/** Host-only dotenv loading for installed and source Desktop applications. */
import { isAbsolute } from 'node:path'
import { loadLayeredEnv } from '@deepseek-ai/dsh-app-boot'

/**
 * Load the source repository's dotenv file, or the Host working directory's file for installed applications.
 * Inherited values take precedence over the selected project file and then the Harness-home file.
 * Accepted values are materialized into this Host's environment; absent files retain the existing fallbacks.
 * @param projectDirectory - Absolute source checkout directory supplied by Electron; undefined uses the Host working directory.
 * @returns The immutable launch environment with its original source labels.
 * @throws When the supplied directory is not absolute or a dotenv file declares a prohibited bootstrap variable.
 */
export function loadDesktopHostEnvironment(projectDirectory: string | undefined): ReturnType<typeof loadLayeredEnv> {
  if (projectDirectory !== undefined && !isAbsolute(projectDirectory)) {
    throw new Error('desktop host: DSH_DESKTOP_PROJECT_ENV_DIR must be an absolute source checkout directory')
  }
  return loadLayeredEnv('dsh', projectDirectory)
}
