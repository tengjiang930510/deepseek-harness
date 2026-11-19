/** Model guidance derived from the pinned shared Python requirements. */
import { readFile } from 'node:fs/promises'

const importNames = new Map([
  ['pillow', 'PIL'], ['python-docx', 'docx'], ['python-pptx', 'pptx'],
])

/**
 * Read and validate the package's shared Python requirements at activation.
 * @returns a model-facing preference list with known import aliases.
 */
export async function loadPythonGuidance(): Promise<string> {
  const file = new URL('../requirements-python.txt', import.meta.url)
  const requirements = await readFile(file, 'utf8')
  const packages = new Map<string, string>()
  for (const [index, line] of requirements.split('\n').entries()) {
    const requirement = line.split('#', 1)[0]?.trim() ?? ''
    if (requirement === '') continue
    const name = /^([a-zA-Z0-9](?:[a-zA-Z0-9._-]*[a-zA-Z0-9])?)\s*==\s*[a-zA-Z0-9][a-zA-Z0-9._+!-]*$/u.exec(requirement)?.[1]
    if (name === undefined) throw new Error(`Expected a pinned Python requirement at requirements-python.txt:${index + 1}`)
    const key = name.toLowerCase().replace(/[-_.]+/gu, '-')
    if (packages.has(key)) throw new Error(`Duplicate Python requirement at requirements-python.txt:${index + 1}`)
    const importName = importNames.get(key)
    packages.set(key, importName === undefined ? name : `${name} (import ${importName})`)
  }
  const preferred = packages.size === 0 ? '' : ` When a third-party library is needed, prefer these configured shared packages if they fit: ${[...packages.values()].join(', ')}.`
  return 'Prefer the Python standard library whenever it meets the task requirements.'
    + preferred
    + ' Verify that the shared interpreter can import the third-party modules you choose before relying on them.'
}
