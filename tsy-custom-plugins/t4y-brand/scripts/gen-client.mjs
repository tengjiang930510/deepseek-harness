import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const dataUrl = fs.readFileSync(path.join(root, 'assets/data-url.txt'), 'utf8').trim()

const client = `window.__ModuleLoader__.load({
  id: 't4y-brand/client',
  factory: (require) => {
    const module = { exports: {} }
    const exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })

    const React = require('react')
    const LOGO_SRC = ${JSON.stringify(dataUrl)}
    const BRAND_NAME = '武汉地铁智能助手'

    function BrandMark(props) {
      const size = typeof props.size === 'number' ? props.size : 24
      return React.createElement('img', {
        src: LOGO_SRC,
        alt: '',
        width: size,
        height: size,
        className: props.className,
        draggable: false,
        style: { objectFit: 'contain', display: 'block', flex: 'none' },
        'aria-hidden': 'true',
      })
    }

    function BrandName() {
      return React.createElement('span', {
        style: {
          fontSize: '18px',
          lineHeight: '24px',
          fontWeight: 500,
          color: 'var(--dsw-alias-label-primary)',
          whiteSpace: 'nowrap',
        },
      }, BRAND_NAME)
    }

    exports.inject = ['slots']
    exports.apply = (ctx) => {
      ctx.slots.inject('sidebar.brand.mark', () =>
        ctx.slots.inject('sidebar.brand.name', function* () {
          yield ctx.slots.register({ name: 'sidebar.brand.mark' }, BrandMark)
          yield ctx.slots.register({ name: 'sidebar.brand.name' }, BrandName)
        }))
      ctx.slots.inject('conversation.hero.brand.mark', () =>
        ctx.slots.register({ name: 'conversation.hero.brand.mark' }, BrandMark))
    }
    return module.exports
  },
})
`

fs.writeFileSync(path.join(root, 'client.js'), client)
console.log('wrote client.js', client.length, 'bytes')
