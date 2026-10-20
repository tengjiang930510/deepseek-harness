import { copyFileSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const src = join(root, 'src/bilibili-video-search.ts')
const upstream = 'F:/projects/cursor-projects/enterprise-browser-skills/src/skills/bilibili-video-search.ts'
copyFileSync(upstream, src)

let text = readFileSync(src, 'utf8')
text = text.replace("from '../browser/browser'", "from './browser.ts'")
if (!text.includes("from 'node:url'")) {
  text = text.replace(
    "import type { Page } from 'playwright';",
    "import { pathToFileURL } from 'node:url';\nimport type { Page } from 'playwright';",
  )
}
text = text.replace(
  /if \(require\.main === module\) \{[\s\S]*\}\s*$/,
  `const isCliMain = process.argv[1] !== undefined
  && import.meta.url === pathToFileURL(process.argv[1]).href
if (isCliMain) {
  runCli().catch((error) => {
    process.stderr.write(\`\${error instanceof Error ? error.message : String(error)}\\n\`)
    process.exit(1)
  })
}
`,
)
writeFileSync(src, text, 'utf8')
console.log({
  latestLabel: text.includes('最新发布'),
  isCliMain: text.includes('isCliMain'),
  browserImport: text.includes("./browser.ts"),
})
