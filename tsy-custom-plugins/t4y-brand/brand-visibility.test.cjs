const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')

test('duplicate session updates do not restart a failed logo, while new logos are tried', () => {
  const handlers = new Map()
  const win = {
    __t4yIdentity: { getSession: () => ({ moduleName: 'A', moduleLogo: 'bad.png', logo: 'fallback.png' }) },
    addEventListener: (name, fn) => handlers.set(name, fn),
    removeEventListener: name => handlers.delete(name),
    __ModuleLoader__: { load: value => { win.factory = value.factory } },
  }
  const slots = []
  let index = 0
  let mounted = false
  const cleanups = []
  const react = {
    useState(initial) {
      const i = index++
      if (!(i in slots)) slots[i] = typeof initial === 'function' ? initial() : initial
      return [slots[i], value => { slots[i] = value }]
    },
    useRef(initial) { const i = index++; if (!(i in slots)) slots[i] = { current: initial }; return slots[i] },
    useEffect(effect) { index++; if (!mounted) cleanups.push(effect()) },
    createElement: (type, props) => ({ type, props }),
  }
  const source = fs.readFileSync(path.join(__dirname, 'client.js'), 'utf8')
    .replace('    return module.exports\n', '    module.exports.__BrandMark = BrandMark\n    return module.exports\n')
  vm.runInNewContext(source, { window: win })
  const BrandMark = win.factory(() => react).__BrandMark
  const render = () => { index = 0; const result = BrandMark({}); mounted = true; return result }
  const first = render()
  assert.equal(first.props.src, 'bad.png')
  first.props.onError()
  assert.equal(render().props.src, 'fallback.png')
  handlers.get('t4y-identity:session')({ type: 't4y-identity:session' })
  assert.equal(render().props.src, 'fallback.png')
  handlers.get('t4y-brand:changed')({ type: 't4y-brand:changed', detail: { name: 'A', logo: 'new.png', enterpriseLogo: 'fallback.png' } })
  assert.equal(render().props.src, 'new.png')
  cleanups.forEach(cleanup => cleanup?.())
  assert.equal(handlers.size, 0)
})
