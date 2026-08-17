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
  retries?: number
  description?: string
  assignee?: string
  agentId?: string
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
  /** Sidecar records. Used when AppState has no match. */
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

function collectLocalAgents(
  tasks: CoordinatorTransitionInput['tasks'],
  durableTasks: CoordinatorTransitionInput['durableTasks'],
): TransitionTask[] {
  const byId = new Map<string, TransitionTask>()
  // AppState first — it is authority over the sidecar.
  for (const task of Object.values(tasks ?? {})) {
    if (isLocalAgentLike(task)) {
      byId.set(taskKey(task), task)
    }
  }
  for (const task of durableTasks ?? []) {
    if (!isLocalAgentLike(task)) {
      continue
    }
    const key = taskKey(task)
    if (!byId.has(key)) {
      byId.set(key, task)
    }
  }
  return [...byId.values()]
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

function pickMatch(matches: TransitionTask[]): TransitionTask | undefined {
  const running = matches.find(
    t => t.status === 'running' || t.status === 'pending',
  )
  if (running) {
    return running
  }
  const completed = matches.find(t => t.status === 'completed' && hasResult(t))
  if (completed) {
    return completed
  }
  return matches.find(t => t.status === 'failed' || t.status === 'killed')
}

function mostRecentCompleted(agents: TransitionTask[]): TransitionTask | undefined {
  let best: TransitionTask | undefined
  for (const task of agents) {
    if (task.status === 'completed' && hasResult(task)) {
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
  if (!input.appStateHydrated && durable.length > 0) {
    return {
      action: 'rehydrate',
      reason: 'task-state.json has records; AppState is not yet hydrated',
    }
  }
  const agents = collectLocalAgents(input.tasks, durable)
  const failed = agents.find(t => t.status === 'failed' && (t.retries ?? 0) > 0)
  if (failed) {
    return {
      action: 'retry',
      reason: 'failed task has remaining retries',
      taskId: taskKey(failed),
    }
  }
  const liveRunning = Object.values(input.tasks ?? {}).some(
    t => t.status === 'running',
  )
  if (input.appStateHydrated && liveRunning && durable.length === 0) {
    return {
      action: 'stop',
      reason: 'no sidecar; stop live tasks from the previous session',
    }
  }
  return { action: 'continue', reason: 'session tasks already applied' }
}

function decideSpawn(input: CoordinatorTransitionInput): CoordinatorTransition {
  const prompt = input.prompt
  const agents = collectLocalAgents(input.tasks, input.durableTasks)

  if (prompt && prompt.length > 0) {
    const match = pickMatch(findPromptMatches(agents, prompt))
    if (match) {
      if (match.status === 'running' || match.status === 'pending') {
        return {
          action: 'continue',
          reason: 'same prompt already running',
          taskId: taskKey(match),
        }
      }
      if (match.status === 'completed' && hasResult(match)) {
        return {
          action: 'reuse-result',
          reason: 'completed task-state already has this result',
          taskId: taskKey(match),
          result: match.result ?? match.outputs,
        }
      }
      if (match.status === 'failed' || match.status === 'killed') {
        return {
          action: 'retry',
          reason: 'retry failed/killed worker from task-state',
          taskId: taskKey(match),
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
    const idle = mostRecentCompleted(agents)
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
