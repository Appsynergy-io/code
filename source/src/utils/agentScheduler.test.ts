import { expect, test } from 'bun:test'
import {
  forkContextMessagesForSpawn,
  initialSpawnMessages,
} from '../tools/AgentTool/spawnMessages.ts'
import {
  countRunningLocalAgents,
  getAgentScheduleFromParts,
  PER_AGENT_RESERVE_TOKENS,
  softCapFromRemaining,
} from './agentScheduler.ts'
import { scaleTokensForContextWindow } from './contextWindow.ts'

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
})

test('non-fork sub-agent does not receive the parent transcript', () => {
  const parent = [{ content: 'parent transcript' }]
  expect(forkContextMessagesForSpawn(false, parent)).toBeUndefined()
  expect(
    initialSpawnMessages({
      isForkPath: false,
      parentMessages: parent,
      promptMessages: [{ content: 'child prompt' }],
    }),
  ).toEqual([{ content: 'child prompt' }])
})
