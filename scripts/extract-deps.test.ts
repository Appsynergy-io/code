import { expect, test } from 'bun:test'
import {
  extractSpecifiers,
  packageNameFromSpecifier,
  reconstructDependencies,
} from './extract-deps.ts'

test('extracts from/import/require specifiers and ignores comments', () => {
  const src = `
    import { x } from 'chalk'
    import type { Y } from '@anthropic-ai/sdk/resources/index.mjs'
    import {
      tokenize
    } from '@alcalzone/ansi-tokenize'
    const z = require('lodash-es/memoize.js')
    await import('zod/v4')
    // import { no } from 'not-a-dep'
    /* from 'also-not' */
    import { join } from 'node:path'
    import { feature } from 'bun:bundle'
    import { foo } from 'src/utils/foo.js'
    import { bar } from './local.js'
    const msg = "tokens from 'claude setup-token'"
  `
  expect(extractSpecifiers(src).sort()).toEqual([
    '@alcalzone/ansi-tokenize',
    '@anthropic-ai/sdk/resources/index.mjs',
    'bun:bundle',
    'chalk',
    'lodash-es/memoize.js',
    'node:path',
    'src/utils/foo.js',
    './local.js',
    'zod/v4',
  ].sort())
})

test('packageNameFromSpecifier keeps scoped names and drops builtins', () => {
  expect(packageNameFromSpecifier('chalk')).toBe('chalk')
  expect(packageNameFromSpecifier('lodash-es/memoize.js')).toBe('lodash-es')
  expect(packageNameFromSpecifier('@anthropic-ai/sdk/resources/index.mjs')).toBe(
    '@anthropic-ai/sdk',
  )
  expect(packageNameFromSpecifier('zod/v4')).toBe('zod')
  expect(packageNameFromSpecifier('node:fs')).toBeNull()
  expect(packageNameFromSpecifier('fs')).toBeNull()
  expect(packageNameFromSpecifier('src/utils/foo.js')).toBeNull()
  expect(packageNameFromSpecifier('./local.js')).toBeNull()
  expect(packageNameFromSpecifier('bun:bundle')).toBeNull()
  expect(packageNameFromSpecifier('@ant/computer-use-mcp')).toBeNull()
  expect(packageNameFromSpecifier('image-processor-napi')).toBeNull()
})

test('reconstructDependencies walks source and preserves existing versions', () => {
  const deps = reconstructDependencies('source', { react: '19.1.0' })
  expect(deps.react).toBe('19.1.0')
  expect(deps.zod).toBe('*')
  expect(deps.chalk).toBeDefined()
  expect(deps['@ant/computer-use-mcp']).toBeUndefined()
})
