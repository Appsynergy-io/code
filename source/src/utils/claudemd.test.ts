import { expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import product from '../../../config/product.json'
import {
  getProjectInstructionFileNames,
  getProjectInstructionPaths,
  instructionFileName,
  instructionLocalFileName,
  isInstructionFileName,
  legacyInstructionFileNames,
} from '../product/identity.ts'

const ROOT = join(import.meta.dir, '../../..')

function readRepo(rel: string): string {
  return readFileSync(join(ROOT, rel), 'utf8')
}

test('instruction discovery uses product.json names, not a hardcoded CLAUDE.md default', () => {
  expect(product.instructionFileName).toBe('AGENTS.md')
  expect(product.legacyInstructionFileNames).toEqual([])
  expect(getProjectInstructionFileNames()).toEqual(['AGENTS.md'])
  expect(getProjectInstructionFileNames()).not.toContain('CLAUDE.md')
  expect(isInstructionFileName('CLAUDE.md')).toBe(false)
  expect(getProjectInstructionPaths('/proj')).toEqual([
    '/proj/AGENTS.md',
    '/proj/.claude/AGENTS.md',
  ])

  const discovery = readRepo('source/src/utils/claudemd.ts')
  expect(discovery).toContain('getProjectInstructionPaths')
  expect(discovery).toContain("from '../product/identity.js'")
  expect(discovery).not.toMatch(
    /getProjectInstructionFileNames\(\)[\s\S]{0,80}CLAUDE\.md/,
  )
  expect(discovery).toContain(
    'Empty legacyInstructionFileNames means CLAUDE.md is not loaded',
  )
})

test('AGENTS.md hierarchy walks managed → user → project → local toward cwd', () => {
  const discovery = readRepo('source/src/utils/claudemd.ts')
  expect(discovery).toContain('Process Managed file first')
  expect(discovery).toContain('Process User file')
  expect(discovery).toContain('Process from root downward to CWD')
  expect(discovery).toContain('getProjectInstructionPaths(dir)')
  expect(discovery).toContain('join(dir, instructionLocalFileName)')
  expect(instructionFileName).toBe('AGENTS.md')
  expect(instructionLocalFileName).toBe('AGENTS.local.md')
})

test('sub-agents inherit AGENTS.md unless omitClaudeMd is set (Explore/Plan only)', () => {
  const runAgent = readRepo('source/src/tools/AgentTool/runAgent.ts')
  expect(runAgent).toContain('shouldOmitClaudeMd')
  expect(runAgent).toContain('agentDefinition.omitClaudeMd')

  const explore = readRepo('source/src/tools/AgentTool/built-in/exploreAgent.ts')
  const plan = readRepo('source/src/tools/AgentTool/built-in/planAgent.ts')
  const general = readRepo(
    'source/src/tools/AgentTool/built-in/generalPurposeAgent.ts',
  )
  expect(explore).toContain('omitClaudeMd: true')
  expect(plan).toContain('omitClaudeMd: true')
  expect(general).not.toContain('omitClaudeMd')
})

test('CLAUDE.md is not an instruction basename unless listed in legacyInstructionFileNames', () => {
  expect(legacyInstructionFileNames.includes('CLAUDE.md')).toBe(false)
  expect(isInstructionFileName('CLAUDE.md')).toBe(false)

  const identity = readRepo('source/src/product/identity.ts')
  expect(identity).toContain('legacyInstructionFileNames.includes(name)')
  expect(identity).not.toMatch(
    /instructionFileName\s*=\s*['"]CLAUDE\.md['"]/,
  )
})
