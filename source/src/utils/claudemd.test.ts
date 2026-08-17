import { expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import product from '../../../config/product.json'
import {
  getProjectInstructionFileNames,
  isInstructionFileName,
  legacyInstructionFileNames,
} from '../product/identity.ts'
import { GENERAL_PURPOSE_AGENT } from '../tools/AgentTool/built-in/generalPurposeAgent.ts'
import {
  EXPLORE_OMIT_CLAUDE_MD,
  PLAN_OMIT_CLAUDE_MD,
  shouldOmitClaudeMd,
} from '../tools/AgentTool/omitClaudeMd.ts'
import { loadInstructionFilesFromTree } from './instructionLoad.ts'

test('instruction filenames come from product.json only', () => {
  expect(product.instructionFileName).toBe('AGENTS.md')
  expect(product.legacyInstructionFileNames).toEqual([])
  expect(getProjectInstructionFileNames()).toEqual(['AGENTS.md'])
  expect(isInstructionFileName('CLAUDE.md')).toBe(false)
})

test('temp-dir load reads AGENTS.md hierarchy and skips CLAUDE.md', async () => {
  const root = await mkdtemp(join(tmpdir(), 'agents-md-'))
  const nested = join(root, 'pkg', 'app')
  await mkdir(nested, { recursive: true })
  await mkdir(join(nested, '.claude'), { recursive: true })

  await writeFile(join(root, 'AGENTS.md'), 'root agents')
  await writeFile(join(root, 'CLAUDE.md'), 'should not load')
  await writeFile(join(nested, 'AGENTS.md'), 'nested agents')
  await writeFile(join(nested, '.claude', 'AGENTS.md'), 'settings agents')
  await writeFile(join(nested, 'AGENTS.local.md'), 'local agents')
  await writeFile(join(nested, 'CLAUDE.md'), 'nested claude should not load')

  const loaded = await loadInstructionFilesFromTree(nested)
  const contents = loaded.map(f => f.content.trim())
  const basenames = loaded.map(f => f.path.slice(root.length))

  expect(contents).toContain('root agents')
  expect(contents).toContain('nested agents')
  expect(contents).toContain('settings agents')
  expect(contents).toContain('local agents')
  expect(contents).not.toContain('should not load')
  expect(contents).not.toContain('nested claude should not load')
  expect(basenames.some(p => p.endsWith('CLAUDE.md'))).toBe(false)
  expect(legacyInstructionFileNames.includes('CLAUDE.md')).toBe(false)
})

test('Explore/Plan omit instruction files; general-purpose inherits them', () => {
  const slimOn = {
    hasUserContextOverride: false,
    slimSubagentClaudeMd: true,
  }
  expect(EXPLORE_OMIT_CLAUDE_MD).toBe(true)
  expect(PLAN_OMIT_CLAUDE_MD).toBe(true)
  expect(GENERAL_PURPOSE_AGENT.omitClaudeMd).toBeUndefined()

  expect(shouldOmitClaudeMd({ omitClaudeMd: EXPLORE_OMIT_CLAUDE_MD }, slimOn)).toBe(
    true,
  )
  expect(shouldOmitClaudeMd({ omitClaudeMd: PLAN_OMIT_CLAUDE_MD }, slimOn)).toBe(
    true,
  )
  expect(shouldOmitClaudeMd(GENERAL_PURPOSE_AGENT, slimOn)).toBe(false)
  expect(
    shouldOmitClaudeMd(
      { omitClaudeMd: EXPLORE_OMIT_CLAUDE_MD },
      { hasUserContextOverride: true, slimSubagentClaudeMd: true },
    ),
  ).toBe(false)
  expect(
    shouldOmitClaudeMd(
      { omitClaudeMd: EXPLORE_OMIT_CLAUDE_MD },
      { hasUserContextOverride: false, slimSubagentClaudeMd: false },
    ),
  ).toBe(false)

  const exploreSrc = readFileSync(
    join(import.meta.dir, '../tools/AgentTool/built-in/exploreAgent.ts'),
    'utf8',
  )
  const planSrc = readFileSync(
    join(import.meta.dir, '../tools/AgentTool/built-in/planAgent.ts'),
    'utf8',
  )
  const runAgentSrc = readFileSync(
    join(import.meta.dir, '../tools/AgentTool/runAgent.ts'),
    'utf8',
  )
  expect(exploreSrc).toContain('omitClaudeMd: EXPLORE_OMIT_CLAUDE_MD')
  expect(planSrc).toContain('omitClaudeMd: PLAN_OMIT_CLAUDE_MD')
  expect(runAgentSrc).toContain('shouldOmitClaudeMd(agentDefinition')
})
