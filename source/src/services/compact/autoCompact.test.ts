import { expect, test } from 'bun:test'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { decideCoordinatorTransition } from '../../coordinator/transitions.ts'
import { scaleTokensForContextWindow } from '../../utils/contextWindow.ts'
import {
  applyResumedTaskState,
  persistTaskStateFromAppState,
  type RehydratedTask,
} from '../../utils/task/taskPersist.ts'

test('compact persists the durable snapshot and resume rehydrates it', async () => {
  expect(
    decideCoordinatorTransition({
      trigger: 'compact',
      compacted: true,
    }).action,
  ).toBe('checkpoint')

  const dir = await mkdtemp(join(tmpdir(), 'compact-persist-'))
  const transcript = join(dir, 'sess.jsonl')
  await writeFile(transcript, '', 'utf8')

  await persistTaskStateFromAppState(
    {
      worker: {
        id: 'worker',
        type: 'local_agent',
        status: 'running',
        description: 'implement',
        prompt: 'implement feature',
        result: 'partial',
      },
    },
    transcript,
  )

  let state = { tasks: {} as Record<string, RehydratedTask> }
  const tasks = applyResumedTaskState(f => {
    state = f(state)
  }, transcript)
  expect(
    decideCoordinatorTransition({
      trigger: 'resume',
      durableTasks: [
        {
          id: 'worker',
          status: 'running',
          type: 'local_agent',
          inputs: 'implement feature',
        },
      ],
    }).action,
  ).toBe('rehydrate')
  expect(tasks.worker?.prompt).toBe('implement feature')
  expect(tasks.worker?.result).toBe('partial')
  expect(tasks.worker?.status).toBe('killed')
})

test('autocompact buffers scale from the detected window', () => {
  expect(scaleTokensForContextWindow(13_000, 100_000)).toBe(
    Math.max(512, Math.round((13_000 / 200_000) * 100_000)),
  )
})
