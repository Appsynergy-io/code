import { expect, test } from 'bun:test'
import { buildMacro, displayName } from './identity.ts'

test('buildMacro reads display name Code from product.json', () => {
  const macro = buildMacro()
  expect(displayName).toBe('Code')
  expect(macro.DISPLAY_NAME).toBe('Code')
  expect(macro.VERSION).toBe('2.1.88')
  expect(macro.PACKAGE_URL).toBe('@appsynergy/code')
})
