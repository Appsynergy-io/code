import { maxConcurrentAgents } from '../product/identity.js'
import { scaleTokensForContextWindow } from './contextWindow.js'

/**
 * 200k-window reference for one local_agent's reserved working set.
 * Live cap is floor(remainingContext / scaledReserve) — not a fixed agent count.
 */
export const PER_AGENT_RESERVE_TOKENS = 20_000

export type AgentSchedule = {
  remainingContext: number
  perAgentReserve: number
  softCap: number
  running: number
  available: number
  canSpawn: boolean
}

export function countRunningLocalAgents(
  tasks: Record<string, { type: string; status: string }> | undefined,
): number {
  let n = 0
  for (const task of Object.values(tasks ?? {})) {
    if (task.type === 'local_agent' && task.status === 'running') {
      n++
    }
  }
  return n
}

export function getPerAgentReserveTokens(model: string): number {
  /* eslint-disable @typescript-eslint/no-require-imports */
  const { getContextWindowForModel } = require('./context.js') as typeof import('./context.js')
  /* eslint-enable @typescript-eslint/no-require-imports */
  return scaleTokensForContextWindow(
    PER_AGENT_RESERVE_TOKENS,
    getContextWindowForModel(model),
  )
}

/** Pure cap: floor(remaining / reserve), optionally min'd with product config. */
export function softCapFromRemaining(
  remainingContext: number,
  perAgentReserve: number,
  configuredMax?: number,
): number {
  if (perAgentReserve <= 0) {
    return 0
  }
  const fromContext = Math.floor(Math.max(0, remainingContext) / perAgentReserve)
  if (configuredMax !== undefined && configuredMax >= 0) {
    return Math.min(fromContext, configuredMax)
  }
  return fromContext
}

export function getAgentScheduleFromParts(input: {
  remainingContext: number
  perAgentReserve: number
  runningLocalAgents: number
  maxConcurrentAgents?: number
}): AgentSchedule {
  const softCap = softCapFromRemaining(
    input.remainingContext,
    input.perAgentReserve,
    input.maxConcurrentAgents,
  )
  const running = Math.max(0, input.runningLocalAgents)
  const available = Math.max(0, softCap - running)
  return {
    remainingContext: Math.max(0, input.remainingContext),
    perAgentReserve: input.perAgentReserve,
    softCap,
    running,
    available,
    canSpawn: available > 0,
  }
}

export function getAgentSchedule(input: {
  model: string
  usedTokens: number
  runningLocalAgents: number
}): AgentSchedule {
  /* eslint-disable @typescript-eslint/no-require-imports */
  const { getContextWindowForModel } = require('./context.js') as typeof import('./context.js')
  /* eslint-enable @typescript-eslint/no-require-imports */
  const window = getContextWindowForModel(input.model)
  return getAgentScheduleFromParts({
    remainingContext: window - input.usedTokens,
    perAgentReserve: scaleTokensForContextWindow(
      PER_AGENT_RESERVE_TOKENS,
      window,
    ),
    runningLocalAgents: input.runningLocalAgents,
    // Product config only — unset means no extra cap.
    maxConcurrentAgents,
  })
}

export function canSpawnLocalAgent(input: {
  model: string
  usedTokens: number
  runningLocalAgents: number
}): boolean {
  return getAgentSchedule(input).canSpawn
}
