// @vitest-environment jsdom

import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { RunningWhaleTail } from '../src/client/chat/RunningWhaleTail.tsx'

afterEach(cleanup)

describe('RunningWhaleTail', () => {
  it('renders the Wuhan Metro brand mark as a decorative image', () => {
    const view = render(<RunningWhaleTail />)
    const icon = view.container.firstElementChild!
    expect(icon.tagName).toBe('SPAN')
    expect(icon.getAttribute('aria-hidden')).toBe('true')
    const img = icon.querySelector('img')!
    expect(img).toBeTruthy()
    expect(img.getAttribute('alt')).toBe('')
    expect(img.getAttribute('draggable')).toBe('false')
    expect(img.getAttribute('src')).toBeTruthy()
  })
})
