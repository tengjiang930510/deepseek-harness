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
    const FALLBACK_LOGO_SRC = ${JSON.stringify(dataUrl)}
    const FALLBACK_BRAND_NAME = '智能助手'
    const BRAND_EVENT = 't4y-brand:changed'
    const SESSION_EVENT = 't4y-identity:session'

    function readBrand() {
      const session = window.__t4yIdentity?.getSession?.()
      if (!session) {
        return { name: FALLBACK_BRAND_NAME, logo: FALLBACK_LOGO_SRC, enterpriseLogo: '' }
      }
      const name = session.moduleName || session.systemName || FALLBACK_BRAND_NAME
      const enterpriseLogo = session.logo || ''
      const logo = session.moduleLogo || enterpriseLogo || FALLBACK_LOGO_SRC
      return { name, logo: logo || FALLBACK_LOGO_SRC, enterpriseLogo }
    }

    function BrandMark(props) {
      const [brand, setBrand] = React.useState(() => readBrand())
      const [src, setSrc] = React.useState(() => readBrand().logo)
      const lastBrand = React.useRef(brand)
      React.useEffect(() => {
        const sync = (event) => {
          if (event?.type === BRAND_EVENT && event.detail && typeof event.detail === 'object') {
            const next = {
              name: event.detail.name || FALLBACK_BRAND_NAME,
              logo: event.detail.logo || FALLBACK_LOGO_SRC,
              enterpriseLogo: typeof event.detail.enterpriseLogo === 'string'
                ? event.detail.enterpriseLogo
                : (window.__t4yIdentity?.getSession?.()?.logo || ''),
            }
            applyBrand(next)
            return
          }
          applyBrand(readBrand())
        }
        const applyBrand = (next) => {
          const previous = lastBrand.current
          if (next.name !== previous.name || next.logo !== previous.logo || next.enterpriseLogo !== previous.enterpriseLogo) {
            lastBrand.current = next
            setBrand(next)
            if (next.logo !== previous.logo || next.enterpriseLogo !== previous.enterpriseLogo) setSrc(next.logo)
          }
        }
        window.addEventListener(BRAND_EVENT, sync)
        window.addEventListener(SESSION_EVENT, sync)
        sync()
        return () => {
          window.removeEventListener(BRAND_EVENT, sync)
          window.removeEventListener(SESSION_EVENT, sync)
        }
      }, [])
      const size = typeof props.size === 'number' ? props.size : 24
      return React.createElement('img', {
        key: src,
        src,
        alt: '',
        width: size,
        height: size,
        className: props.className,
        draggable: false,
        style: { objectFit: 'contain', display: 'block', flex: 'none' },
        'aria-hidden': 'true',
        onError: () => {
          if (src && brand.enterpriseLogo && src !== brand.enterpriseLogo) {
            setSrc(brand.enterpriseLogo)
            return
          }
          if (src !== FALLBACK_LOGO_SRC) setSrc(FALLBACK_LOGO_SRC)
        },
      })
    }

    function BrandName() {
      const [name, setName] = React.useState(() => readBrand().name)
      React.useEffect(() => {
        const sync = (event) => {
          if (event?.type === BRAND_EVENT && event.detail && typeof event.detail.name === 'string' && event.detail.name !== '') {
            setName(event.detail.name)
            return
          }
          setName(readBrand().name)
        }
        window.addEventListener(BRAND_EVENT, sync)
        window.addEventListener(SESSION_EVENT, sync)
        sync()
        return () => {
          window.removeEventListener(BRAND_EVENT, sync)
          window.removeEventListener(SESSION_EVENT, sync)
        }
      }, [])
      return React.createElement('span', {
        style: {
          fontSize: '18px',
          lineHeight: '24px',
          fontWeight: 500,
          color: 'var(--dsw-alias-label-primary)',
          whiteSpace: 'nowrap',
        },
      }, name)
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

      window.__t4yBrand = {
        getBrand: readBrand,
        onChange: (listener) => {
          const handler = () => listener(readBrand())
          window.addEventListener(BRAND_EVENT, handler)
          window.addEventListener(SESSION_EVENT, handler)
          return () => {
            window.removeEventListener(BRAND_EVENT, handler)
            window.removeEventListener(SESSION_EVENT, handler)
          }
        },
      }
      ctx.effect(() => () => { delete window.__t4yBrand }, 't4y brand: bridge')
    }
    return module.exports
  },
})
`

fs.writeFileSync(path.join(root, 'client.js'), client)
console.log('wrote client.js', client.length, 'bytes')
