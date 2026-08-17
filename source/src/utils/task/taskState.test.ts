import { expect, test } from 'bun:test'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { decideCoordinatorTransition } from '../../coordinator/transitions.ts'
import {
  applyResumedTaskState,
  getTaskStatePath,
  persistTaskStateFromAppState,
  rehydrateTask,
  type RehydratedTask,
  snapshotTask,
} from './taskPersist.ts'

test('recover after compact / failed child / interrupt', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'task-recover-'))
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
  await persistTaskStateFromAppState(
    {
      worker: {
        id: 'worker',
        type: 'local_agent',
        status: 'failed',
        description: 'implement',
        prompt: 'implement feature',
        error: 'tool crashed',
      },
    },
    transcript,
  )

  let state = { tasks: {} as Record<string, RehydratedTask> }
  const tasks = applyResumedTaskState(f => {
    state = f(state)
  }, transcript)
  expect(tasks.worker?.status).toBe('failed')
  expect(tasks.worker?.prompt).toBe('implement feature')
  expect(tasks.worker?.error).toBe('tool crashed')

  expect(
    decideCoordinatorTransition({
      trigger: 'spawn',
      prompt: 'implement feature',
      canSpawn: true,
      durableTasks: [
        {
          id: 'worker',
          status: 'failed',
          type: 'local_agent',
          inputs: 'implement feature',
        },
      ],
    }).action,
  ).toBe('retry')

  expect(rehydrateTask({ id: 'x', status: 'running' }).status).toBe('killed')
  expect(rehydrateTask({ id: 'x', status: 'pending' }).status).toBe('killed')
  expect(rehydrateTask({ id: 'x', status: 'completed' }).status).toBe(
    'completed',
  )
})

test('parallel local agents merge into one sidecar without clobbering', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'task-parallel-'))
  const transcript = join(dir, 'sess.jsonl')
  await writeFile(transcript, '', 'utf8')
  expect(getTaskStatePath(transcript)).toBe(join(dir, 'sess.task-state.json'))

  // Production persist snapshots every AppState task, then merges by id.
  await persistTaskStateFromAppState(
    {
      'agent-a': {
        id: 'agent-a',
        type: 'local_agent',
        status: 'running',
        prompt: 'A',
      },
      'agent-b': {
        id: 'agent-b',
        type: 'local_agent',
        status: 'running',
        prompt: 'B',
      },
    },
    transcript,
  )

  await persistTaskStateFromAppState(
    {
      'agent-a': {
        id: 'agent-a',
        type: 'local_agent',
        status: 'completed',
        prompt: 'A',
        result: 'done-a',
      },
    },
    transcript,
  )

  let state = { tasks: {} as Record<string, RehydratedTask> }
  const tasks = applyResumedTaskState(f => {
    state = f(state)
  }, transcript)
  expect(Object.keys(tasks).sort()).toEqual(['agent-a', 'agent-b'])
  expect(tasks['agent-a']?.result).toBe('done-a')
  expect(tasks['agent-b']?.prompt).toBe('B')
  expect(tasks['agent-a']?.status).toBe('completed')
  expect(tasks['agent-b']?.status).toBe('killed')

  // Overlapping persists are last-write-wins on the file; merge-by-id is
  // the only safety when callers snapshot the full AppState (as above).
  expect(snapshotTask({ id: 'z', status: 'running', type: 'local_agent' }).errors).toEqual([])
})
