import { readFileSync } from 'fs'
import { mkdir, readFile, writeFile } from 'fs/promises'
import { dirname } from 'path'
import { z } from 'zod/v4'
import type {
  DurableTaskRecord,
  DurableTaskStateFile,
  TaskStatus,
  TaskType,
} from '../../Task.js'
import { logForDebugging } from '../debug.js'
import { isFsInaccessible } from '../errors.js'
import { safeParseJSON } from '../json.js'
import { lazySchema } from '../lazySchema.js'
import { getTaskStatePath } from '../sessionStorage.js'
import { jsonStringify } from '../slowOperations.js'

const TASK_STATUSES = [
  'pending',
  'running',
  'completed',
  'failed',
  'killed',
] as const satisfies readonly TaskStatus[]

const DurableTaskRecordSchema = lazySchema(() =>
  z
    .object({
      id: z.string(),
      parent: z.string().optional(),
      status: z.enum(TASK_STATUSES),
      assignee: z.string().optional(),
      deps: z.array(z.string()).optional(),
      inputs: z.unknown().optional(),
      outputs: z.unknown().optional(),
      validation: z.unknown().optional(),
      errors: z.array(z.unknown()).optional(),
      retries: z.number().optional(),
      checkpoints: z.array(z.unknown()).optional(),
      pending: z.unknown().optional(),
      completion: z.unknown().optional(),
      type: z.string().optional(),
      description: z.string().optional(),
    })
    .strip(),
)

const DurableTaskStateFileSchema = lazySchema(() =>
  z.object({
    version: z.literal(1),
    updatedAt: z.number(),
    tasks: z.array(DurableTaskRecordSchema()),
  }),
)

let lastLoaded: DurableTaskStateFile | null = null

export function getLastLoadedTaskState(): DurableTaskStateFile | null {
  return lastLoaded
}

function parseTaskState(raw: string): DurableTaskStateFile | null {
  const parsed = DurableTaskStateFileSchema().safeParse(
    safeParseJSON(raw, false),
  )
  return parsed.success ? (parsed.data as DurableTaskStateFile) : null
}

export async function readTaskStateFile(
  transcriptPath?: string,
): Promise<DurableTaskStateFile | null> {
  const path = getTaskStatePath(transcriptPath)
  try {
    const raw = await readFile(path, 'utf-8')
    const loaded = parseTaskState(raw)
    if (loaded) lastLoaded = loaded
    return loaded
  } catch (e) {
    if (isFsInaccessible(e)) return null
    logForDebugging(`readTaskStateFile: ${String(e)}`)
    return null
  }
}

/** Sync path for resume hooks that run before the async transcript walk. */
export function readTaskStateFileSync(
  transcriptPath?: string,
): DurableTaskStateFile | null {
  const path = getTaskStatePath(transcriptPath)
  try {
    // eslint-disable-next-line custom-rules/no-sync-fs -- resume must read sidecar before transcript
    const raw = readFileSync(path, 'utf-8')
    const loaded = parseTaskState(raw)
    if (loaded) lastLoaded = loaded
    return loaded
  } catch (e) {
    if (isFsInaccessible(e)) return null
    logForDebugging(`readTaskStateFileSync: ${String(e)}`)
    return null
  }
}

export async function writeTaskStateFile(
  file: DurableTaskStateFile,
  transcriptPath?: string,
): Promise<void> {
  const path = getTaskStatePath(transcriptPath)
  await mkdir(dirname(path), { recursive: true, mode: 0o700 })
  await writeFile(path, jsonStringify(file), { encoding: 'utf-8', mode: 0o600 })
  lastLoaded = file
}

type SnapshotSource = {
  id: string
  status: TaskStatus
  type?: TaskType | string
  description?: string
  endTime?: number
  agentId?: string
  prompt?: string
  command?: string
  result?: unknown
  error?: string
  pendingMessages?: unknown
  parent?: string
  parentTaskId?: string
  deps?: string[]
  validation?: unknown
  retries?: number
  checkpoints?: unknown[]
}

function omitUndefined<T extends object>(obj: T): T {
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(obj)) {
    if (v !== undefined) out[k] = v
  }
  return out as T
}

export function snapshotTask(task: SnapshotSource): DurableTaskRecord {
  const record: DurableTaskRecord = {
    id: task.id,
    status: task.status,
    parent: task.parent ?? task.parentTaskId,
    assignee: task.agentId,
    deps: task.deps,
    inputs: task.prompt ?? task.command,
    outputs: task.result,
    validation: task.validation,
    errors: task.error !== undefined ? [task.error] : undefined,
    retries: task.retries,
    checkpoints: task.checkpoints,
    pending: task.pendingMessages,
    completion:
      task.endTime !== undefined
        ? { endTime: task.endTime, status: task.status }
        : undefined,
    type: task.type as TaskType | undefined,
    description: task.description,
  }
  return omitUndefined(record)
}

export function mergeDurableTasks(
  existing: DurableTaskRecord[],
  current: DurableTaskRecord[],
): DurableTaskRecord[] {
  const byId = new Map(existing.map(t => [t.id, t]))
  for (const t of current) {
    const prev = byId.get(t.id)
    byId.set(t.id, prev ? { ...prev, ...omitUndefined(t) } : t)
  }
  return [...byId.values()]
}

/**
 * Deterministic compact-time persist. No LLM call — snapshot AppState.tasks
 * and merge onto the sidecar so evicted completed tasks are not forgotten.
 */
export async function persistTaskStateFromAppState(
  tasks: Record<string, SnapshotSource> | undefined,
  transcriptPath?: string,
): Promise<void> {
  try {
    const existing = (await readTaskStateFile(transcriptPath))?.tasks ?? []
    const current = Object.values(tasks ?? {}).map(snapshotTask)
    if (existing.length === 0 && current.length === 0) return
    const file: DurableTaskStateFile = {
      version: 1,
      updatedAt: Date.now(),
      tasks: mergeDurableTasks(existing, current),
    }
    await writeTaskStateFile(file, transcriptPath)
  } catch (e) {
    logForDebugging(`persistTaskStateFromAppState: ${String(e)}`)
  }
}

/**
 * Resume entry: read `{sessionId}.task-state.json` before the transcript.
 * Populates the process-local cache consulted by getLastLoadedTaskState().
 */
export async function loadTaskStateForResume(
  transcriptPath?: string,
): Promise<DurableTaskStateFile | null> {
  return readTaskStateFile(transcriptPath)
}
