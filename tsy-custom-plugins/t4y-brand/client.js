/** Configurable brand occupants; resources are emitted by the product build. */
window.__ModuleLoader__.load({
  id: 't4y-brand/client',
  factory: (require) => {
    const React = require('react')
    return {
      inject: ['slots'],
      async apply(ctx) {
        const response = await fetch('./product/brand.json', { cache: 'no-store' })
        if (!response.ok) throw new Error('Product brand resources are unavailable; rebuild the application.')
        const brand = await response.json()
        if (typeof brand.name !== 'string' || !brand.name.trim()
          || typeof brand.logo !== 'string' || !/^logo-[a-f0-9]{16}\.png$/.test(brand.logo)) {
          throw new Error('Product brand metadata is invalid; rebuild the application.')
        }
        function BrandMark({ size = 24, className }) {
          return React.createElement('img', {
            src: `./product/${brand.logo}`, alt: '', width: size, height: size, className,
            draggable: false, 'aria-hidden': 'true',
            style: { objectFit: 'contain', display: 'block', flex: 'none' },
          })
        }
        function BrandName() {
          return React.createElement('span', {
            title: brand.name,
            style: { fontWeight: 500, display: 'block', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
          }, brand.name)
        }
        function RunningMark() { return React.createElement(BrandMark, { size: 16 }) }
        function HeroName() { return brand.name }
        ctx.slots.inject('sidebar.brand.mark', () =>
          ctx.slots.inject('sidebar.brand.name', function* () {
            yield ctx.slots.register({ name: 'sidebar.brand.mark' }, BrandMark)
            yield ctx.slots.register({ name: 'sidebar.brand.name' }, BrandName)
          }))
        ctx.slots.inject('conversation.hero.brand.mark', () =>
          ctx.slots.register({ name: 'conversation.hero.brand.mark' }, BrandMark))
        ctx.slots.inject('conversation.hero.brand.name', () =>
          ctx.slots.register({ name: 'conversation.hero.brand.name' }, HeroName))
        ctx.slots.inject('conversation.chat.running.brand.mark', () =>
          ctx.slots.register({ name: 'conversation.chat.running.brand.mark' }, RunningMark))
      },
    }
  },
})
