import { expect, test } from 'bun:test'
import { existsSync } from 'node:fs'
import { buildMacro } from '../source/src/product/identity.ts'
import {
  NAPI_REMAPS,
  rewriteFeatureCalls,
  stubContents,
} from './build.ts'

test('MACRO define matches product identity used by the version banner', () => {
  const macro = buildMacro()
  const line = `${macro.VERSION} (${macro.DISPLAY_NAME})`
  expect(line).toBe('2.1.88 (Code)')
})

test('rewriteFeatureCalls folds single-line and trailing-comma calls', () => {
  expect(
    rewriteFeatureCalls(
      `import { feature } from 'bun:bundle'\nexport const on = feature('VOICE_MODE') ? 1 : 0\n`,
    ),
  ).toContain('false ? 1 : 0')
  const multiline = `const name = feature(\n  'EXPERIMENTAL_SKILL_SEARCH',\n) ? require('./missing.js') : null\n`
  const rewritten = rewriteFeatureCalls(multiline)
  expect(rewritten).toBe(
    `const name = false ? require('./missing.js') : null\n`,
  )
})

test('text assets stub as an empty string, not {}', () => {
  expect(stubContents('./verify/SKILL.md')).toBe('export default ""\n')
  expect(stubContents('./types/message.js', ['Message'])).toContain(
    'export const Message = __stub',
  )
  expect(stubContents('./types/message.js')).not.toContain('export default {}')
  expect(stubContents('./types/message.js')).not.toContain('export default ""')
})

test('napi remaps point at in-tree ports', () => {
  expect(NAPI_REMAPS['color-diff-napi']).toContain('native-ts/color-diff')
  expect(NAPI_REMAPS['modifiers-napi']).toContain('modifiers-napi-src')
  expect(existsSync(NAPI_REMAPS['color-diff-napi']!)).toBe(true)
  expect(existsSync(NAPI_REMAPS['modifiers-napi']!)).toBe(true)
})
