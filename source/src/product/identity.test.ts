import { afterEach, expect, test } from 'bun:test'
import { join } from 'path'
import pkg from '../../../package.json'
import product from '../../../config/product.json'
import {
  binaryRepoUrl,
  buildMacro,
  configDirName,
  contextTokensEnv,
  displayName,
  getContextTokensEnvValue,
  getContextWindowOverride,
  getProjectInstructionFileNames,
  getProjectInstructionPaths,
  globalConfigFileName,
  instructionFileName,
  instructionLocalFileName,
  isInstructionFileName,
  legacyInstructionFileNames,
  projectSettingsDir,
  protocolScheme,
  urlHandlerAppName,
  urlHandlerBundleId,
  xdgDirName,
} from './identity.ts'

const savedEnv = {
  CLAUDE_CODE_MAX_CONTEXT_TOKENS: process.env.CLAUDE_CODE_MAX_CONTEXT_TOKENS,
  CODE_MAX_CONTEXT_TOKENS: process.env.CODE_MAX_CONTEXT_TOKENS,
}

afterEach(() => {
  if (savedEnv.CLAUDE_CODE_MAX_CONTEXT_TOKENS === undefined) {
    delete process.env.CLAUDE_CODE_MAX_CONTEXT_TOKENS
  } else {
    process.env.CLAUDE_CODE_MAX_CONTEXT_TOKENS =
      savedEnv.CLAUDE_CODE_MAX_CONTEXT_TOKENS
  }
  if (savedEnv.CODE_MAX_CONTEXT_TOKENS === undefined) {
    delete process.env.CODE_MAX_CONTEXT_TOKENS
  } else {
    process.env.CODE_MAX_CONTEXT_TOKENS = savedEnv.CODE_MAX_CONTEXT_TOKENS
  }
})

test('buildMacro reads display name Code from product.json', () => {
  const macro = buildMacro()
  expect(displayName).toBe('Code')
  expect(macro.DISPLAY_NAME).toBe('Code')
  expect(macro.VERSION).toBe(pkg.version)
  expect(macro.PACKAGE_URL).toBe('@appsynergy/code')
})

test('instruction filenames come from config/product.json only', () => {
  expect(instructionFileName).toBe(product.instructionFileName)
  expect(instructionFileName).toBe('AGENTS.md')
  expect(instructionLocalFileName).toBe(product.instructionLocalFileName)
  expect(instructionLocalFileName).toBe('AGENTS.local.md')
  expect(legacyInstructionFileNames).toEqual(product.legacyInstructionFileNames)
  expect(legacyInstructionFileNames).toEqual([])
  expect(getProjectInstructionFileNames()).toEqual(['AGENTS.md'])
  expect(isInstructionFileName('AGENTS.md')).toBe(true)
  expect(isInstructionFileName('AGENTS.local.md')).toBe(true)
  expect(isInstructionFileName('CLAUDE.md')).toBe(false)
  expect(getProjectInstructionPaths('/repo')).toEqual([
    join('/repo', 'AGENTS.md'),
    join('/repo', product.projectSettingsDir, 'AGENTS.md'),
  ])
})

test('context window env name and CODE_ alias come from product.json', () => {
  expect(contextTokensEnv).toBe(product.runtime.contextTokensEnv)
  delete process.env.CLAUDE_CODE_MAX_CONTEXT_TOKENS
  delete process.env.CODE_MAX_CONTEXT_TOKENS
  expect(getContextTokensEnvValue()).toBeUndefined()
  expect(getContextWindowOverride()).toBeUndefined()

  process.env.CLAUDE_CODE_MAX_CONTEXT_TOKENS = '128000'
  expect(getContextWindowOverride()).toBe(128000)

  process.env.CODE_MAX_CONTEXT_TOKENS = '64000'
  expect(getContextWindowOverride()).toBe(64000)
})

test('config home and global file names come from product.json', () => {
  expect(configDirName).toBe(product.configDirName)
  expect(configDirName).toBe('.code')
  expect(projectSettingsDir).toBe(product.projectSettingsDir)
  expect(projectSettingsDir).toBe('.code')
  expect(xdgDirName).toBe(product.xdgDirName)
  expect(xdgDirName).toBe('code')
  expect(globalConfigFileName).toBe(product.globalConfigFileName)
  expect(globalConfigFileName).toBe('.code.json')
  expect(protocolScheme).toBe(product.protocolScheme)
  expect(protocolScheme).toBe('code-cli')
  expect(urlHandlerBundleId).toBe(product.urlHandlerBundleId)
  expect(urlHandlerBundleId).toBe('com.appsynergy.code-url-handler')
  expect(urlHandlerAppName).toBe(product.urlHandlerAppName)
  expect(urlHandlerAppName).toBe('Code URL Handler')
})

test('binaryRepoUrl is the product-configured GitHub release-index', () => {
  expect(binaryRepoUrl).toBe(product.release.binaryRepoUrl)
  expect(binaryRepoUrl).toBe(
    'https://github.com/Appsynergy-io/code/releases/download/release-index',
  )
  expect(binaryRepoUrl).not.toMatch(/googleapis|npmjs|npm\.anthropic/i)
})
