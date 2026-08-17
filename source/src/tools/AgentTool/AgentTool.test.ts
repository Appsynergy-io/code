import { expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = join(import.meta.dir, '../../../..')

test('non-fork Agent tool spawn does not pass the parent transcript', () => {
  const src = readFileSync(
    join(ROOT, 'source/src/tools/AgentTool/AgentTool.tsx'),
    'utf8',
  )
  expect(src).toContain('forkContextMessages: isForkPath ? toolUseContext.messages : undefined')
  expect(src).toContain('Normal path: build the selected agent')
  expect(src).toMatch(/if \(isForkPath\) \{[\s\S]*buildForkedMessages/)
  expect(src).toMatch(
    /\} else \{[\s\S]*promptMessages = \[createUserMessage\(\{\s*content: prompt\s*\}\)\]/,
  )
})
