// @vitest-environment jsdom
import { expect, it } from 'vitest'
import { installWindowsMenu } from '../src/preload-menu.ts'

it('does not mount the Windows caption menubar in this product build', () => {
  const menu = installWindowsMenu()
  expect(document.querySelector('[data-windows-menu]')).toBeNull()
  menu.update()
  expect(document.querySelector('[data-windows-menu]')).toBeNull()
  menu.dispose()
  expect(document.querySelector('[data-windows-menu]')).toBeNull()
})
