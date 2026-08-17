import { expect, test } from 'bun:test'
import { feature } from './bun-bundle.ts'

test('feature() is off for every external-build gate', () => {
  expect(feature('VOICE_MODE')).toBe(false)
  expect(feature('DAEMON')).toBe(false)
  expect(feature('BRIDGE_MODE')).toBe(false)
  expect(feature('DUMP_SYSTEM_PROMPT')).toBe(false)
  expect(feature('KAIROS')).toBe(false)
})
