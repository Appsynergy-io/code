import { readFileSync } from 'fs'
import { mkdir, readFile, writeFile } from 'fs/promises'
import { dirname } from 'path'
import { z } from 'zod/v4'
import {
  createTaskStateBase,
  isTerminalTaskStatus,
  type DurableTaskRecord,
  type DurableTaskStateFile,
  type TaskStatus,
  type TaskType,
} from '../../Task.js'
import { decideCoordinatorTransition } from '../../coordinator/transitions.js'
import type { AppState } from '../../state/AppState.js'
import type { InProcessTeammateTaskState } from '../../tasks/InProcessTeammateTask/types.js'
import type { LocalAgentTaskState } from '../../tasks/LocalAgentTask/LocalAgentTask.js'
import type { LocalShellTaskState } from '../../tasks/LocalShellTask/guards.js'
import type { TaskState } from '../../tasks/types.js'
import { asAgentId } from '../../types/ids.js'
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

const TASK_TYPES = [
  'local_bash',
  'local_agent',
  'remote_agent',
  'in_process_teammate',
  'local_workflow',
  'monitor_mcp',
  'dream',
] as const satisfies readonly TaskType[]

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
      type: z.enum(TASK_TYPES).optional(),
      description: z.string().optional(),
      sessionId: z.string().optional(),
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

/** Sync path for resume hooks. Always pass the resumed transcript path. */
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

function asStringList(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.filter((item): item is string => typeof item === 'string')
}

function firstError(errors: unknown[] | undefined): string | undefined {
  if (!errors || errors.length === 0) return undefined
  const first = errors[0]
  return typeof first === 'string' ? first : jsonStringify(first)
}

function completionEndTime(completion: unknown): number | undefined {
  if (
    completion !== null &&
    typeof completion === 'object' &&
    'endTime' in completion &&
    typeof (completion as { endTime: unknown }).endTime === 'number'
  ) {
    return (completion as { endTime: number }).endTime
  }
  return undefined
}

function inputString(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

/** Stubs have no process — only terminal statuses survive rehydrate. */
function statusForStub(recorded: TaskStatus): TaskStatus {
  if (
    recorded === 'completed' ||
    recorded === 'failed' ||
    recorded === 'killed'
  ) {
    return recorded
  }
  return 'killed'
}

function disposeSessionTasks(tasks: Record<string, TaskState>): void {
  for (const task of Object.values(tasks)) {
    try {
      if ('abortController' in task) {
        task.abortController?.abort()
      }
      if ('currentWorkAbortController' in task) {
        task.currentWorkAbortController?.abort()
      }
      if ('unregisterCleanup' in task) {
        task.unregisterCleanup?.()
      }
      if ('shellCommand' in task) {
        task.shellCommand?.kill()
      }
    } catch (e) {
      logForDebugging(`disposeSessionTasks ${task.id}: ${String(e)}`)
    }
  }
}

export function snapshotTask(task: TaskState): DurableTaskRecord {
  const record: DurableTaskRecord = {
    id: task.id,
    status: task.status,
    type: task.type,
    description: task.description,
    completion:
      task.endTime !== undefined
        ? { endTime: task.endTime, status: task.status }
        : undefined,
  }

  switch (task.type) {
    case 'local_agent':
      record.assignee = task.agentId
      record.inputs = task.prompt
      record.outputs = task.result
      record.errors = task.error !== undefined ? [task.error] : []
      record.pending = task.pendingMessages
      break
    case 'in_process_teammate':
      record.assignee = task.identity.agentId
      record.parent = task.identity.parentSessionId
      record.inputs = task.prompt
      record.outputs = task.result
      record.errors = task.error !== undefined ? [task.error] : []
      record.pending = task.pendingUserMessages
      break
    case 'local_bash':
      record.assignee = task.agentId
      record.inputs = task.command
      record.outputs = task.result
      break
    case 'remote_agent':
      record.sessionId = task.sessionId
      record.inputs = task.command
      record.outputs = task.title
      break
    case 'dream':
      record.inputs = task.phase
      record.outputs = task.filesTouched
      break
    default:
      break
  }

  return record
}

function isCleared(value: unknown): boolean {
  return (
    value === null ||
    value === '' ||
    (Array.isArray(value) && value.length === 0)
  )
}

function mergeRecord(
  prev: DurableTaskRecord,
  next: DurableTaskRecord,
): DurableTaskRecord {
  const out: DurableTaskRecord = { ...prev, id: next.id, status: next.status }
  for (const [key, value] of Object.entries(next) as [
    keyof DurableTaskRecord,
    DurableTaskRecord[keyof DurableTaskRecord],
  ][]) {
    if (value === undefined) continue
    if (isCleared(value)) {
      delete out[key]
      continue
    }
    ;(out as Record<string, unknown>)[key] = value
  }
  out.id = next.id
  out.status = next.status
  return out
}

export function mergeDurableTasks(
  existing: DurableTaskRecord[],
  current: DurableTaskRecord[],
): DurableTaskRecord[] {
  const byId = new Map(existing.map(t => [t.id, t]))
  for (const t of current) {
    const prev = byId.get(t.id)
    byId.set(t.id, prev ? mergeRecord(prev, t) : t)
  }
  return [...byId.values()]
}

/**
 * Deterministic compact-time persist. No LLM call — snapshot AppState.tasks
 * and merge onto the sidecar. Empty/null fields clear the previous value.
 */
export async function persistTaskStateFromAppState(
  tasks: Record<string, TaskState> | undefined,
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

export function rehydrateTask(record: DurableTaskRecord): TaskState | null {
  const type = record.type ?? 'local_agent'
  const base = createTaskStateBase(
    record.id,
    type,
    record.description ?? record.id,
  )
  // Stubs have no worker. restoreRemoteAgentTasks reconnects remotes from
  // their own metadata — leaving them running here would create zombies.
  base.status = statusForStub(record.status)
  const endTime = completionEndTime(record.completion)
  if (endTime !== undefined) {
    base.endTime = endTime
  } else if (base.status === 'killed' && !isTerminalTaskStatus(record.status)) {
    base.endTime = Date.now()
  }
  base.notified = false

  const pending = asStringList(record.pending)
  const error = firstError(record.errors)
  const input = inputString(record.inputs)

  switch (type) {
    case 'local_bash':
      return {
        ...base,
        type: 'local_bash',
        command: input,
        result: record.outputs as LocalShellTaskState['result'],
        completionStatusSentInAttachment: true,
        shellCommand: null,
        lastReportedTotalLines: 0,
        isBackgrounded: true,
        agentId: record.assignee ? asAgentId(record.assignee) : undefined,
      }
    case 'local_agent':
      return {
        ...base,
        type: 'local_agent',
        agentId: record.assignee ?? record.id,
        prompt: input,
        agentType: 'general-purpose',
        retrieved: true,
        lastReportedToolCount: 0,
        lastReportedTokenCount: 0,
        isBackgrounded: true,
        pendingMessages: pending,
        retain: false,
        diskLoaded: false,
        error,
        result: record.outputs as LocalAgentTaskState['result'],
      }
    case 'in_process_teammate':
      return {
        ...base,
        type: 'in_process_teammate',
        identity: {
          agentId: record.assignee ?? record.id,
          agentName: record.assignee ?? record.id,
          teamName: '',
          planModeRequired: false,
          parentSessionId: record.parent ?? '',
        },
        prompt: input,
        awaitingPlanApproval: false,
        permissionMode: 'default',
        error,
        result: record.outputs as InProcessTeammateTaskState['result'],
        pendingUserMessages: pending,
        isIdle: true,
        shutdownRequested: true,
        lastReportedToolCount: 0,
        lastReportedTokenCount: 0,
      }
    case 'remote_agent':
      return {
        ...base,
        type: 'remote_agent',
        remoteTaskType: 'remote-agent',
        sessionId: record.sessionId ?? '',
        command: input,
        title:
          typeof record.outputs === 'string'
            ? record.outputs
            : (record.description ?? record.id),
        todoList: [],
        log: [],
        pollStartedAt: Date.now(),
      }
    case 'dream':
      return {
        ...base,
        type: 'dream',
        phase: record.inputs === 'starting' ? 'starting' : 'updating',
        sessionsReviewing: 0,
        filesTouched: asStringList(record.outputs),
        turns: [],
        priorMtime: 0,
      }
    default:
      return null
  }
}

export function hydrateTasksFromDurable(
  file: DurableTaskStateFile | null,
): Record<string, TaskState> {
  const tasks: Record<string, TaskState> = {}
  if (!file) return tasks
  for (const record of file.tasks) {
    const hydrated = rehydrateTask(record)
    if (hydrated) tasks[record.id] = hydrated
  }
  return tasks
}

/** Resume apply: replace AppState.tasks with the sidecar (never merge sessions). */
export function applyResumedTaskState(
  setAppState: (f: (prev: AppState) => AppState) => void,
  transcriptPath?: string,
): Record<string, TaskState> {
  const file = transcriptPath
    ? readTaskStateFileSync(transcriptPath)
    : lastLoaded
  const decision = decideCoordinatorTransition({
    trigger: 'resume',
    durableTasks: file?.tasks,
    appStateHydrated: false,
  })
  logForDebugging(
    `coordinator resume: ${decision.action} (${decision.reason})`,
  )
  const tasks = hydrateTasksFromDurable(file)
  setAppState(prev => {
    disposeSessionTasks(prev.tasks)
    return { ...prev, tasks }
  })
  return tasks
}

export function loadHydratedTasks(
  transcriptPath?: string,
): Record<string, TaskState> {
  const file = readTaskStateFileSync(transcriptPath)
  const decision = decideCoordinatorTransition({
    trigger: 'resume',
    durableTasks: file?.tasks,
    appStateHydrated: false,
  })
  logForDebugging(
    `coordinator resume: ${decision.action} (${decision.reason})`,
  )
  return hydrateTasksFromDurable(file)
}

/**
 * Resume entry: read `{sessionId}.task-state.json` before the transcript.
 */
export async function loadTaskStateForResume(
  transcriptPath?: string,
): Promise<DurableTaskStateFile | null> {
  return readTaskStateFile(transcriptPath)
}
