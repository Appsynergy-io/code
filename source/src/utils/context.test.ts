import { afterEach, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  getContextWindowOverride,
  parseContextWindowOverride,
} from '../product/identity.ts'
import {
  COMPACT_MAX_OUTPUT_TOKENS,
  getCompactMaxOutputTokensForWindow,
  MODEL_CONTEXT_WINDOW_DEFAULT,
  scaleTokensForContextWindow,
} from './contextWindow.ts'

const ROOT = join(import.meta.dir, '../../..')
const saved = {
  CLAUDE_CODE_MAX_CONTEXT_TOKENS: process.env.CLAUDE_CODE_MAX_CONTEXT_TOKENS,
  CODE_MAX_CONTEXT_TOKENS: process.env.CODE_MAX_CONTEXT_TOKENS,
}

afterEach(() => {
  for (const key of [
    'CLAUDE_CODE_MAX_CONTEXT_TOKENS',
    'CODE_MAX_CONTEXT_TOKENS',
  ] as const) {
    if (saved[key] === undefined) delete process.env[key]
    else process.env[key] = saved[key]
  }
})

test('context window override comes from env with no hardcoded max', () => {
  expect(parseContextWindowOverride(undefined)).toBeUndefined()
  expect(parseContextWindowOverride('0')).toBeUndefined()
  expect(parseContextWindowOverride('-1')).toBeUndefined()
  expect(parseContextWindowOverride('not-a-number')).toBeUndefined()
  expect(parseContextWindowOverride('32000')).toBe(32000)
  expect(parseContextWindowOverride('2000000')).toBe(2_000_000)

  delete process.env.CLAUDE_CODE_MAX_CONTEXT_TOKENS
  delete process.env.CODE_MAX_CONTEXT_TOKENS
  process.env.CLAUDE_CODE_MAX_CONTEXT_TOKENS = '1500000'
  expect(getContextWindowOverride()).toBe(1_500_000)
})

test('getContextWindowForModel prefers env, then provider advertised, with no cap on the override', () => {
  const src = readFileSync(join(ROOT, 'source/src/utils/context.ts'), 'utf8')
  expect(src).toContain('getContextWindowOverride()')
  expect(src).toContain('getAdvertisedMaxInputTokens(model)')
  expect(src).toContain('No hardcoded ceiling')
  expect(src).not.toMatch(
    /getContextWindowOverride\(\)[\s\S]{0,200}Math\.min/,
  )
  expect(src).toContain('MODEL_CONTEXT_WINDOW_DEFAULT')
})

test('scaleTokensForContextWindow scales the 200k reference and floors small windows', () => {
  expect(MODEL_CONTEXT_WINDOW_DEFAULT).toBe(200_000)
  expect(scaleTokensForContextWindow(20_000, 200_000)).toBe(20_000)
  expect(scaleTokensForContextWindow(20_000, 400_000)).toBe(40_000)
  expect(scaleTokensForContextWindow(20_000, 1_000)).toBe(512)
  expect(
    getCompactMaxOutputTokensForWindow(200_000, 8_000),
  ).toBe(8_000)
  expect(COMPACT_MAX_OUTPUT_TOKENS).toBe(20_000)
})
