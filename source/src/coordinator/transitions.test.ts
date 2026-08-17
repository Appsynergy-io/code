import { expect, test } from 'bun:test'
import { decideCoordinatorTransition } from './transitions.ts'

test('compact trigger checkpoints the durable snapshot after compaction', () => {
  expect(
    decideCoordinatorTransition({
      trigger: 'compact',
      shouldCompact: true,
    }),
  ).toEqual({
    action: 'compact',
    reason: 'context above autocompact threshold',
  })
  expect(
    decideCoordinatorTransition({
      trigger: 'compact',
      compacted: true,
    }),
  ).toEqual({
    action: 'checkpoint',
    reason: 'persist task-state after compact',
  })
  expect(
    decideCoordinatorTransition({ trigger: 'compact' }).action,
  ).toBe('continue')
})

test('resume rehydrates current-session sidecar records only', () => {
  expect(
    decideCoordinatorTransition({ trigger: 'resume' }).action,
  ).toBe('continue')
  expect(
    decideCoordinatorTransition({
      trigger: 'resume',
      durableTasks: [{ id: 'a', status: 'completed' }],
    }),
  ).toMatchObject({
    action: 'rehydrate',
    reason: 'task-state.json has records for this session',
  })
})

test('spawn reuses, retries, or stops without inventing a parent transcript', () => {
  const completed = {
    id: 'w1',
    type: 'local_agent',
    status: 'completed' as const,
    inputs: 'same prompt',
    outputs: { text: 'done' },
  }
  expect(
    decideCoordinatorTransition({
      trigger: 'spawn',
      prompt: 'same prompt',
      canSpawn: true,
      durableTasks: [completed],
    }),
  ).toMatchObject({
    action: 'reuse-result',
    taskId: 'w1',
    result: { text: 'done' },
  })

  expect(
    decideCoordinatorTransition({
      trigger: 'spawn',
      prompt: 'same prompt',
      canSpawn: true,
      durableTasks: [{ ...completed, status: 'failed', outputs: undefined }],
    }).action,
  ).toBe('retry')

  expect(
    decideCoordinatorTransition({
      trigger: 'spawn',
      prompt: 'new work',
      canSpawn: false,
      remainingContext: 100,
      perAgentReserve: 200,
    }).action,
  ).toBe('compact')

  expect(
    decideCoordinatorTransition({
      trigger: 'spawn',
      prompt: 'new work',
      canSpawn: true,
    }).action,
  ).toBe('spawn')
})
