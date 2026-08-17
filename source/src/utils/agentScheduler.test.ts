import { expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  countRunningLocalAgents,
  getAgentScheduleFromParts,
  PER_AGENT_RESERVE_TOKENS,
  softCapFromRemaining,
} from './agentScheduler.ts'
import { scaleTokensForContextWindow } from './contextWindow.ts'

const ROOT = join(import.meta.dir, '../../..')

test('soft cap is remaining/reserve, optionally min with product maxConcurrentAgents', () => {
  expect(softCapFromRemaining(80_000, 20_000)).toBe(4)
  expect(softCapFromRemaining(80_000, 20_000, 2)).toBe(2)
  expect(softCapFromRemaining(10_000, 20_000)).toBe(0)
  expect(softCapFromRemaining(80_000, 0)).toBe(0)
  expect(PER_AGENT_RESERVE_TOKENS).toBe(20_000)
  expect(scaleTokensForContextWindow(PER_AGENT_RESERVE_TOKENS, 100_000)).toBe(
    10_000,
  )
})

test('running local agents consume spawn slots; others do not', () => {
  expect(
    countRunningLocalAgents({
      a: { type: 'local_agent', status: 'running' },
      b: { type: 'local_agent', status: 'running' },
      c: { type: 'local_agent', status: 'completed' },
      d: { type: 'local_bash', status: 'running' },
    }),
  ).toBe(2)
  expect(countRunningLocalAgents(undefined)).toBe(0)

  const schedule = getAgentScheduleFromParts({
    remainingContext: 60_000,
    perAgentReserve: 20_000,
    runningLocalAgents: 2,
  })
  expect(schedule.softCap).toBe(3)
  expect(schedule.available).toBe(1)
  expect(schedule.canSpawn).toBe(true)

  const full = getAgentScheduleFromParts({
    remainingContext: 40_000,
    perAgentReserve: 20_000,
    runningLocalAgents: 2,
  })
  expect(full.canSpawn).toBe(false)
})

test('non-fork sub-agent does not receive the parent transcript', () => {
  const agentTool = readFileSync(
    join(ROOT, 'source/src/tools/AgentTool/AgentTool.tsx'),
    'utf8',
  )
  expect(agentTool).toContain(
    'forkContextMessages: isForkPath ? toolUseContext.messages : undefined',
  )
  expect(agentTool).toMatch(
    /promptMessages = \[createUserMessage\(\{\s*content: prompt\s*\}\)\]/,
  )

  const runAgent = readFileSync(
    join(ROOT, 'source/src/tools/AgentTool/runAgent.ts'),
    'utf8',
  )
  expect(runAgent).toContain(
    'const contextMessages: Message[] = forkContextMessages',
  )
  expect(runAgent).toContain('? filterIncompleteToolCalls(forkContextMessages)')
  expect(runAgent).toContain(': []')
})
