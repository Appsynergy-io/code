import { expect, test } from 'bun:test'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { buildMacro } from '../source/src/product/identity.ts'

test('MACRO define matches product identity used by the version banner', () => {
  const macro = buildMacro()
  const line = `${macro.VERSION} (${macro.DISPLAY_NAME})`
  expect(line).toBe('2.1.88 (Code)')
})

test('feature() replacement turns bun:bundle gates into false', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'code-build-'))
  const file = join(dir, 'gate.ts')
  writeFileSync(
    file,
    `import { feature } from 'bun:bundle'\nexport const on = feature('VOICE_MODE') ? 1 : 0\n`,
  )
  const contents = (await Bun.file(file).text()).replace(
    /\bfeature\s*\(\s*(['"`])[^'"`]*\1\s*\)/g,
    'false',
  )
  expect(contents).toContain('false ? 1 : 0')
  expect(contents).not.toContain("feature('VOICE_MODE')")
})
