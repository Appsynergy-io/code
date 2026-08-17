import { expect, test } from 'bun:test'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { readFileSync } from 'node:fs'
import type { DurableTaskRecord, DurableTaskStateFile } from '../../Task.ts'
import { decideCoordinatorTransition } from '../../coordinator/transitions.ts'
import { mergeDurableTasks, statusForStub } from './durableMerge.ts'

const ROOT = join(import.meta.dir, '../../../..')

function taskStatePath(transcript: string): string {
  if (transcript.endsWith('.jsonl')) {
    return transcript.slice(0, -'.jsonl'.length) + '.task-state.json'
  }
  return join(dirname(transcript), 'task-state.json')
}

async function persist(
  path: string,
  current: DurableTaskRecord[],
): Promise<DurableTaskStateFile> {
  let existing: DurableTaskRecord[] = []
  try {
    const raw = await readFile(path, 'utf8')
    existing = (JSON.parse(raw) as DurableTaskStateFile).tasks
  } catch {
    existing = []
  }
  const file: DurableTaskStateFile = {
    version: 1,
    updatedAt: Date.now(),
    tasks: mergeDurableTasks(existing, current),
  }
  await writeFile(path, JSON.stringify(file), 'utf8')
  return file
}

test('recover after compact / failed child / interrupt', () => {
  const compacted = mergeDurableTasks(
    [
      {
        id: 'worker',
        status: 'running',
        type: 'local_agent',
        inputs: 'implement feature',
        outputs: 'partial',
      },
    ],
    [
      {
        id: 'worker',
        status: 'failed',
        type: 'local_agent',
        inputs: 'implement feature',
        errors: ['tool crashed'],
      },
    ],
  )
  expect(compacted).toHaveLength(1)
  expect(compacted[0]?.status).toBe('failed')
  expect(compacted[0]?.inputs).toBe('implement feature')
  expect(compacted[0]?.errors).toEqual(['tool crashed'])

  expect(statusForStub('running')).toBe('killed')
  expect(statusForStub('pending')).toBe('killed')
  expect(statusForStub('failed')).toBe('failed')
  expect(statusForStub('completed')).toBe('completed')
  expect(statusForStub('killed')).toBe('killed')

  const resumeFailed = decideCoordinatorTransition({
    trigger: 'spawn',
    prompt: 'implement feature',
    canSpawn: true,
    durableTasks: compacted,
  })
  expect(resumeFailed.action).toBe('retry')

  const resumeAfterCompact = decideCoordinatorTransition({
    trigger: 'resume',
    durableTasks: compacted,
  })
  expect(resumeAfterCompact.action).toBe('rehydrate')
})

test('parallel local agents merge into one sidecar without clobbering', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'task-state-'))
  const transcript = join(dir, 'sess.jsonl')
  const path = taskStatePath(transcript)
  expect(path).toBe(join(dir, 'sess.task-state.json'))

  await persist(path, [
    { id: 'agent-a', status: 'running', type: 'local_agent', inputs: 'A' },
  ])
  const afterB = await persist(path, [
    { id: 'agent-b', status: 'running', type: 'local_agent', inputs: 'B' },
  ])
  expect(afterB.tasks.map(t => t.id).sort()).toEqual(['agent-a', 'agent-b'])
  expect(afterB.tasks.find(t => t.id === 'agent-a')?.inputs).toBe('A')
  expect(afterB.tasks.find(t => t.id === 'agent-b')?.inputs).toBe('B')

  const afterADone = await persist(path, [
    {
      id: 'agent-a',
      status: 'completed',
      type: 'local_agent',
      outputs: 'done-a',
    },
  ])
  expect(afterADone.tasks.find(t => t.id === 'agent-b')?.inputs).toBe('B')
  expect(afterADone.tasks.find(t => t.id === 'agent-a')?.outputs).toBe('done-a')

  const src = readFileSync(
    join(ROOT, 'source/src/utils/task/taskState.ts'),
    'utf8',
  )
  expect(src).toContain('mergeDurableTasks(existing, current)')
  expect(src).toContain('persistTaskStateFromAppState')
})
