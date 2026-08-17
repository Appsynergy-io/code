import type { DurableTaskRecord, TaskStatus } from '../Task.js'

export const COORDINATOR_ACTIONS = [
  'continue',
  'compact',
  'checkpoint',
  'delegate',
  'reuse-result',
  'spawn',
  'rehydrate',
  'retry',
  'stop',
] as const

export type CoordinatorAction = (typeof COORDINATOR_ACTIONS)[number]

export type CoordinatorTrigger = 'compact' | 'spawn' | 'resume'

/** Structural task view — AppState.tasks or task-state.json records. */
export type TransitionTask = {
  id: string
  type?: string
  status: TaskStatus | string
  prompt?: string
  inputs?: unknown
  outputs?: unknown
  result?: unknown
  description?: string
  assignee?: string
  agentId?: string
  endTime?: number
  completion?: unknown
}

export type CoordinatorTransition = {
  action: CoordinatorAction
  reason: string
  taskId?: string
  result?: unknown
}

export type CoordinatorTransitionInput = {
  trigger: CoordinatorTrigger
  shouldCompact?: boolean
  compacted?: boolean
  canSpawn?: boolean
  remainingContext?: number
  perAgentReserve?: number
  prompt?: string
  appStateHydrated?: boolean
  /** Live AppState.tasks — coordinator authority. */
  tasks?: Record<string, TransitionTask> | undefined
  /** Current-session sidecar only. Do not pass lastLoaded from another transcript. */
  durableTasks?: readonly TransitionTask[] | readonly DurableTaskRecord[] | null
}

function taskPrompt(task: TransitionTask): string | undefined {
  if (typeof task.prompt === 'string' && task.prompt.length > 0) {
    return task.prompt
  }
  if (typeof task.inputs === 'string' && task.inputs.length > 0) {
    return task.inputs
  }
  return undefined
}

function isLocalAgentLike(task: TransitionTask): boolean {
  return task.type === undefined || task.type === 'local_agent'
}

function hasResult(task: TransitionTask): boolean {
  const out = task.result ?? task.outputs
  if (out === undefined || out === null) {
    return false
  }
  if (typeof out === 'string') {
    return out.length > 0
  }
  if (typeof out === 'object') {
    return Object.keys(out as object).length > 0
  }
  return true
}

function taskKey(task: TransitionTask): string {
  return task.agentId ?? task.assignee ?? task.id
}

function matchesPrompt(task: TransitionTask, prompt: string): boolean {
  return taskPrompt(task) === prompt
}

function findPromptMatches(
  agents: TransitionTask[],
  prompt: string,
): TransitionTask[] {
  return agents.filter(task => matchesPrompt(task, prompt))
}

function pickDurableMatch(matches: TransitionTask[]): TransitionTask | undefined {
  const completed = matches.find(t => t.status === 'completed' && hasResult(t))
  if (completed) {
    return completed
  }
  return matches.find(t => t.status === 'failed' || t.status === 'killed')
}

function taskEndTime(task: TransitionTask): number | undefined {
  if (typeof task.endTime === 'number') {
    return task.endTime
  }
  const completion = task.completion
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

function mostRecentCompleted(agents: TransitionTask[]): TransitionTask | undefined {
  let best: TransitionTask | undefined
  let bestTime = -Infinity
  let sawTimestamp = false
  for (const task of agents) {
    if (task.status !== 'completed' || !hasResult(task)) {
      continue
    }
    const ended = taskEndTime(task)
    if (ended !== undefined) {
      if (!sawTimestamp || ended >= bestTime) {
        best = task
        bestTime = ended
        sawTimestamp = true
      }
    } else if (!sawTimestamp) {
      best = task
    }
  }
  return best
}

function decideCompact(input: CoordinatorTransitionInput): CoordinatorTransition {
  if (input.shouldCompact) {
    return { action: 'compact', reason: 'context above autocompact threshold' }
  }
  if (input.compacted) {
    return { action: 'checkpoint', reason: 'persist task-state after compact' }
  }
  return { action: 'continue', reason: 'below compact threshold' }
}

function decideResume(input: CoordinatorTransitionInput): CoordinatorTransition {
  const durable = input.durableTasks ?? []
  if (durable.length > 0) {
    return {
      action: 'rehydrate',
      reason: 'task-state.json has records for this session',
    }
  }
  return { action: 'continue', reason: 'no sidecar records to apply' }
}

function sessionTerminals(
  live: TransitionTask[],
  durable: TransitionTask[],
): TransitionTask[] {
  const byId = new Map<string, TransitionTask>()
  // Sidecar first; same-session AppState terminals overwrite (authority).
  for (const task of durable) {
    if (
      task.status === 'completed' ||
      task.status === 'failed' ||
      task.status === 'killed'
    ) {
      byId.set(taskKey(task), task)
    }
  }
  for (const task of live) {
    if (
      task.status === 'completed' ||
      task.status === 'failed' ||
      task.status === 'killed'
    ) {
      byId.set(taskKey(task), task)
    }
  }
  return [...byId.values()]
}

function decideSpawn(input: CoordinatorTransitionInput): CoordinatorTransition {
  const prompt = input.prompt
  // This conversation's AppState. /clear already dropped other-session terminals.
  const live = Object.values(input.tasks ?? {}).filter(isLocalAgentLike)
  // Current session file only. Never lastLoaded from another transcript.
  const durable = [...(input.durableTasks ?? [])].filter(isLocalAgentLike)
  const terminals = sessionTerminals(live, durable)

  if (prompt && prompt.length > 0) {
    const liveMatch = live.find(
      t =>
        matchesPrompt(t, prompt) &&
        (t.status === 'running' || t.status === 'pending'),
    )
    if (liveMatch) {
      return {
        action: 'continue',
        reason: 'same prompt already running',
        taskId: taskKey(liveMatch),
      }
    }

    const terminalMatch = pickDurableMatch(findPromptMatches(terminals, prompt))
    if (terminalMatch) {
      if (terminalMatch.status === 'completed' && hasResult(terminalMatch)) {
        return {
          action: 'reuse-result',
          reason: 'completed worker in this conversation already has this result',
          taskId: taskKey(terminalMatch),
          result: terminalMatch.result ?? terminalMatch.outputs,
        }
      }
      if (terminalMatch.status === 'failed' || terminalMatch.status === 'killed') {
        return {
          action: 'retry',
          reason: 'retry failed/killed worker from this conversation',
          taskId: taskKey(terminalMatch),
        }
      }
    }
  }

  const remaining = input.remainingContext
  const reserve = input.perAgentReserve
  const noRoomForOne =
    remaining !== undefined && reserve !== undefined && remaining < reserve

  if (input.canSpawn === false) {
    if (input.shouldCompact || noRoomForOne) {
      return {
        action: 'compact',
        reason: 'no spawn slots; compact to reclaim context',
      }
    }
    const idle = mostRecentCompleted(terminals)
    if (idle) {
      return {
        action: 'delegate',
        reason: 'at capacity; reuse a completed worker',
        taskId: taskKey(idle),
      }
    }
    return {
      action: 'stop',
      reason: 'no remaining context for another local_agent',
    }
  }

  return { action: 'spawn', reason: 'no matching task-state; capacity available' }
}

/**
 * Deterministic coordinator decision. Prefers AppState, then task-state.json.
 * Does not ask the model what happened.
 */
export function decideCoordinatorTransition(
  input: CoordinatorTransitionInput,
): CoordinatorTransition {
  switch (input.trigger) {
    case 'compact':
      return decideCompact(input)
    case 'resume':
      return decideResume(input)
    case 'spawn':
      return decideSpawn(input)
  }
}
