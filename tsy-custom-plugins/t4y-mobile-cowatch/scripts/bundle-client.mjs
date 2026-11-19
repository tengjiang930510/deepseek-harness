/**
 * Concatenate client-src/*.js into the ModuleLoader factory at ../client.js.
 * Runtime still loads a single client entry; edit parts, then re-run this script.
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const pkgRoot = path.resolve(here, '..')
const srcDir = path.join(pkgRoot, 'client-src')
const outFile = path.join(pkgRoot, 'client.js')

/** Concatenation order: shared → phone surface → desktop → apply. */
const PART_FILES = [
  'shared.js',
  'phone-styles.js',
  'phone-waitgate.js',
  'phone-idle.js',
  'phone-presence.js',
  'desktop-access.js',
  'phone-switcher.js',
  'apply.js',
]

const header = `/**
 * GENERATED FILE — edit client-src/*.js then run:
 *   node scripts/bundle-client.mjs
 *
 * Mobile co-watch client: treat the phone as a remote control of the PC Host.
 * Desktop browsers must stay inert — no wait gate, no fetch hooks, no layout rewrite.
 */
window.__ModuleLoader__.load({
  id: 't4y-mobile-cowatch/client',
  factory: (require) => {
    const module = { exports: {} }
    const exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })

    const React = require('react')

`

const footer = `
    return module.exports
  },
})
`

function main() {
  const bodies = PART_FILES.map((name) => {
    const file = path.join(srcDir, name)
    if (!fs.existsSync(file)) {
      throw new Error(`bundle-client: missing part ${name}`)
    }
    const text = fs.readFileSync(file, 'utf8').replace(/\s+$/u, '')
    return `    // --- client-src/${name} ---\n${text}`
  })
  const out = `${header}${bodies.join('\n\n')}${footer}`.replace(/\n+$/u, '\n')
  fs.writeFileSync(outFile, out)
  console.log(`wrote ${path.relative(pkgRoot, outFile)} (${out.length} bytes) from ${PART_FILES.length} parts`)
}

main()
