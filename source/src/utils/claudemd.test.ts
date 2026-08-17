import { expect, test } from 'bun:test'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import product from '../../../config/product.json'
import {
  getProjectInstructionFileNames,
  isInstructionFileName,
  legacyInstructionFileNames,
} from '../product/identity.ts'
import {
  agentInheritsInstructionFiles,
  loadInstructionFilesFromTree,
} from './instructionLoad.ts'

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

test('sub-agents inherit instruction files unless omitClaudeMd is set', () => {
  expect(agentInheritsInstructionFiles({})).toBe(true)
  expect(agentInheritsInstructionFiles({ omitClaudeMd: false })).toBe(true)
  expect(agentInheritsInstructionFiles({ omitClaudeMd: true })).toBe(false)
})
