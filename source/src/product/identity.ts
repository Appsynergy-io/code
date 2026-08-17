import { join } from 'path'
import productJson from '../../../config/product.json'
import pkgJson from '../../../package.json'

export type ProductReleaseChannel = 'latest' | 'stable' | 'nightly'

export type ProductReleaseConfig = {
  binaryRepoUrl: string
  channels: ProductReleaseChannel[]
  nativePackageUrl?: string
  minVersion?: string
}

export type ProductRuntimeConfig = {
  contextTokensEnv: string
  maxConcurrentAgents?: number
}

export type ProductConfig = {
  productName: string
  cliName: string
  packageName: string
  displayName: string
  repository: string
  docsUrl: string
  issuesUrl: string
  feedbackChannel: string
  homepage: string
  description: string
  instructionFileName: string
  instructionLocalFileName: string
  legacyInstructionFileNames: string[]
  configDirName: string
  projectSettingsDir: string
  release: ProductReleaseConfig
  runtime: ProductRuntimeConfig
}

export type Macro = {
  VERSION: string
  BUILD_TIME: string
  PACKAGE_URL: string
  NATIVE_PACKAGE_URL: string
  FEEDBACK_CHANNEL: string
  ISSUES_EXPLAINER: string
  VERSION_CHANGELOG: string
  README_URL: string
  DISPLAY_NAME: string
}

const product = productJson as ProductConfig
const pkg = pkgJson as { version: string }

export const productName = product.productName
export const cliName = product.cliName
export const packageName = product.packageName
export const displayName = product.displayName
export const repository = product.repository
export const docsUrl = product.docsUrl
export const issuesUrl = product.issuesUrl
export const feedbackChannel = product.feedbackChannel
export const homepage = product.homepage
export const description = product.description
export const instructionFileName = product.instructionFileName
export const instructionLocalFileName = product.instructionLocalFileName
export const legacyInstructionFileNames = product.legacyInstructionFileNames
export const configDirName = product.configDirName
export const projectSettingsDir = product.projectSettingsDir
export const binaryRepoUrl = product.release.binaryRepoUrl
export const releaseChannels = product.release.channels
export const releaseMinVersion = product.release.minVersion
export const contextTokensEnv = product.runtime.contextTokensEnv
export const maxConcurrentAgents = product.runtime.maxConcurrentAgents
export const productConfig = product

export const syspromptPrefix = `You are ${displayName}.`
export const agentSdkProductPrefix = `You are ${displayName}, running within the Agent SDK.`
export const agentSdkPrefix = `You are an agent, built on the Agent SDK.`
export const welcomeMessage = `Welcome to ${displayName}`
export const issuesExplainer = `report the issue at ${issuesUrl}`

export function buildMacro(
  overrides?: Partial<Pick<Macro, 'VERSION' | 'BUILD_TIME' | 'VERSION_CHANGELOG'>>,
): Macro {
  return {
    VERSION: overrides?.VERSION ?? pkg.version,
    BUILD_TIME: overrides?.BUILD_TIME ?? process.env.BUILD_TIME ?? '',
    PACKAGE_URL: packageName,
    NATIVE_PACKAGE_URL: product.release.nativePackageUrl ?? packageName,
    FEEDBACK_CHANNEL: feedbackChannel,
    ISSUES_EXPLAINER: issuesExplainer,
    VERSION_CHANGELOG: overrides?.VERSION_CHANGELOG ?? '',
    README_URL: docsUrl,
    DISPLAY_NAME: displayName,
  }
}

export const productMacro = buildMacro()

/** CODE_* wins when set; CLAUDE_CONFIG_DIR / CLAUDE_CODE_* stay valid. */
export function codeAliasFor(claudeName: string): string | undefined {
  if (claudeName === 'CLAUDE_CONFIG_DIR') return 'CODE_CONFIG_DIR'
  if (claudeName.startsWith('CLAUDE_CODE_')) {
    return `CODE_${claudeName.slice('CLAUDE_CODE_'.length)}`
  }
  return undefined
}

export function getAliasedEnv(claudeName: string): string | undefined {
  const alias = codeAliasFor(claudeName)
  if (alias !== undefined && Object.hasOwn(process.env, alias)) {
    return process.env[alias]
  }
  return process.env[claudeName]
}

export function getContextTokensEnvValue(): string | undefined {
  return getAliasedEnv(contextTokensEnv)
}

/** Positive integer from the product context-tokens env (and CODE_ alias). */
export function parseContextWindowOverride(
  raw: string | undefined,
): number | undefined {
  if (!raw) return undefined
  const parsed = parseInt(raw, 10)
  if (Number.isNaN(parsed) || parsed <= 0) return undefined
  return parsed
}

export function getContextWindowOverride(): number | undefined {
  return parseContextWindowOverride(getContextTokensEnvValue())
}

/** Project-level instruction basenames: primary first, then any legacy names. */
export function getProjectInstructionFileNames(): string[] {
  return [...new Set([instructionFileName, ...legacyInstructionFileNames])]
}

export function isInstructionFileName(name: string): boolean {
  return (
    name === instructionFileName ||
    name === instructionLocalFileName ||
    legacyInstructionFileNames.includes(name)
  )
}

/** `<name>` and `<settingsDir>/<name>` for each project instruction basename. */
export function getProjectInstructionPaths(dir: string): string[] {
  const paths: string[] = []
  for (const name of getProjectInstructionFileNames()) {
    paths.push(join(dir, name))
    paths.push(join(dir, projectSettingsDir, name))
  }
  return paths
}
