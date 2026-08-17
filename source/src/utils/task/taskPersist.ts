import { readFileSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type {
  DurableTaskRecord,
  DurableTaskStateFile,
  TaskStatus,
} from '../../Task.js'
import { decideCoordinatorTransition } from '../../coordinator/transitions.js'
import { mergeDurableTasks, statusForStub } from './durableMerge.js'

export function getTaskStatePath(transcriptPath: string): string {
  if (transcriptPath.endsWith('.jsonl')) {
    return transcriptPath.slice(0, -'.jsonl'.length) + '.task-state.json'
  }
  return join(dirname(transcriptPath), 'task-state.json')
}

export type SnapshotableTask = {
  id: string
  status: TaskStatus
  type: string
  description?: string
  endTime?: number
  agentId?: string
  prompt?: string
  result?: unknown
  error?: string
  pendingMessages?: string[]
}

export function snapshotTask(task: SnapshotableTask): DurableTaskRecord {
  return {
    id: task.id,
    status: task.status,
    type: task.type as DurableTaskRecord['type'],
    description: task.description,
    completion:
      task.endTime !== undefined
        ? { endTime: task.endTime, status: task.status }
        : undefined,
    assignee: task.agentId,
    inputs: task.prompt,
    outputs: task.result,
    errors: task.error !== undefined ? [task.error] : [],
    pending: task.pendingMessages,
  }
}

export async function persistRecords(
  path: string,
  current: DurableTaskRecord[],
): Promise<DurableTaskStateFile | null> {
  let existing: DurableTaskRecord[] = []
  try {
    const raw = await readFile(path, 'utf8')
    existing = (JSON.parse(raw) as DurableTaskStateFile).tasks ?? []
  } catch {
    existing = []
  }
  if (existing.length === 0 && current.length === 0) return null
  const file: DurableTaskStateFile = {
    version: 1,
    updatedAt: Date.now(),
    tasks: mergeDurableTasks(existing, current),
  }
  await mkdir(dirname(path), { recursive: true, mode: 0o700 })
  await writeFile(path, JSON.stringify(file), { encoding: 'utf8', mode: 0o600 })
  return file
}

/** Compact-time persist: snapshot every AppState task and merge onto the sidecar. */
export async function persistTaskStateFromAppState(
  tasks: Record<string, SnapshotableTask> | undefined,
  transcriptPath: string,
): Promise<void> {
  const path = getTaskStatePath(transcriptPath)
  await persistRecords(path, Object.values(tasks ?? {}).map(snapshotTask))
}

export type RehydratedTask = {
  id: string
  type: string
  status: TaskStatus
  description: string
  prompt: string
  result: unknown
  error?: string
}

export function rehydrateTask(record: DurableTaskRecord): RehydratedTask {
  const first = record.errors?.[0]
  return {
    id: record.id,
    type: record.type ?? 'local_agent',
    status: statusForStub(record.status),
    description: record.description ?? record.id,
    prompt: typeof record.inputs === 'string' ? record.inputs : '',
    result: record.outputs,
    error: typeof first === 'string' ? first : undefined,
  }
}

export function readTaskStateFileSync(
  transcriptPath: string,
): DurableTaskStateFile | null {
  try {
    return JSON.parse(
      readFileSync(getTaskStatePath(transcriptPath), 'utf8'),
    ) as DurableTaskStateFile
  } catch {
    return null
  }
}

export function applyResumedTaskState(
  setAppState: (
    f: (prev: { tasks: Record<string, RehydratedTask> }) => {
      tasks: Record<string, RehydratedTask>
    },
  ) => void,
  transcriptPath: string,
): Record<string, RehydratedTask> {
  const file = readTaskStateFileSync(transcriptPath)
  decideCoordinatorTransition({
    trigger: 'resume',
    durableTasks: file?.tasks,
  })
  const tasks: Record<string, RehydratedTask> = {}
  for (const record of file?.tasks ?? []) {
    tasks[record.id] = rehydrateTask(record)
  }
  setAppState(prev => ({ ...prev, tasks }))
  return tasks
}
