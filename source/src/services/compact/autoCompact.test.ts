import { expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { decideCoordinatorTransition } from '../../coordinator/transitions.ts'
import { mergeDurableTasks } from '../../utils/task/durableMerge.ts'
import { scaleTokensForContextWindow } from '../../utils/contextWindow.ts'

const ROOT = join(import.meta.dir, '../../../..')

function readRepo(rel: string): string {
  return readFileSync(join(ROOT, rel), 'utf8')
}

test('compact persists the durable snapshot and resume rehydrates it', () => {
  const autoCompact = readRepo('source/src/services/compact/autoCompact.ts')
  const compact = readRepo('source/src/services/compact/compact.ts')
  expect(autoCompact).toContain('persistTaskStateFromAppState')
  expect(compact).toContain('persistTaskStateFromAppState')
  expect(compact).toMatch(
    /persistTaskStateFromAppState\(context\.getAppState\(\)\.tasks\)/,
  )

  const afterCompact = decideCoordinatorTransition({
    trigger: 'compact',
    compacted: true,
  })
  expect(afterCompact.action).toBe('checkpoint')
  expect(afterCompact.reason).toContain('persist task-state')

  const snapshot = mergeDurableTasks(
    [],
    [
      {
        id: 'a1',
        status: 'running',
        type: 'local_agent',
        inputs: 'research the API',
      },
    ],
  )
  const resume = decideCoordinatorTransition({
    trigger: 'resume',
    durableTasks: snapshot,
  })
  expect(resume.action).toBe('rehydrate')
})

test('autocompact buffers scale from the detected window, not a hardcoded 200k max', () => {
  const src = readRepo('source/src/services/compact/autoCompact.ts')
  expect(src).toContain('scaleTokensForContextWindow')
  expect(src).toContain('getContextWindowForModel')
  expect(scaleTokensForContextWindow(13_000, 100_000)).toBe(
    Math.max(512, Math.round((13_000 / 200_000) * 100_000)),
  )
})
