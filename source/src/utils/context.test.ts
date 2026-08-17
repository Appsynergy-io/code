import { afterEach, expect, test } from 'bun:test'
import {
  getContextWindowOverride,
  parseContextWindowOverride,
} from '../product/identity.ts'
import {
  COMPACT_MAX_OUTPUT_TOKENS,
  getCompactMaxOutputTokensForWindow,
  MODEL_CONTEXT_WINDOW_DEFAULT,
  resolveContextWindow,
  scaleTokensForContextWindow,
} from './contextWindow.ts'

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
  expect(parseContextWindowOverride('2000000')).toBe(2_000_000)

  delete process.env.CLAUDE_CODE_MAX_CONTEXT_TOKENS
  delete process.env.CODE_MAX_CONTEXT_TOKENS
  process.env.CLAUDE_CODE_MAX_CONTEXT_TOKENS = '1500000'
  expect(getContextWindowOverride()).toBe(1_500_000)
  expect(
    resolveContextWindow({
      envOverride: getContextWindowOverride(),
      advertised: 200_000,
    }),
  ).toBe(1_500_000)
})

test('resolveContextWindow prefers env, then advertised, with no cap on the override', () => {
  expect(
    resolveContextWindow({
      envOverride: 2_000_000,
      advertised: 128_000,
      has1mSuffix: true,
    }),
  ).toBe(2_000_000)

  expect(resolveContextWindow({ advertised: 256_000 })).toBe(256_000)
  expect(resolveContextWindow({ advertised: 1_000_000, disable1m: true })).toBe(
    MODEL_CONTEXT_WINDOW_DEFAULT,
  )
  expect(resolveContextWindow({ advertised: 400_000, disable1m: true })).toBe(
    400_000,
  )
  expect(resolveContextWindow({ has1mSuffix: true })).toBe(1_000_000)
  expect(resolveContextWindow({})).toBe(MODEL_CONTEXT_WINDOW_DEFAULT)
})

test('scaleTokensForContextWindow scales the 200k reference and floors small windows', () => {
  expect(scaleTokensForContextWindow(20_000, 200_000)).toBe(20_000)
  expect(scaleTokensForContextWindow(20_000, 400_000)).toBe(40_000)
  expect(scaleTokensForContextWindow(20_000, 1_000)).toBe(512)
  expect(getCompactMaxOutputTokensForWindow(200_000, 8_000)).toBe(8_000)
  expect(COMPACT_MAX_OUTPUT_TOKENS).toBe(20_000)
})
