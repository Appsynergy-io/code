import { expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import pkg from '../../../package.json'
import product from '../../../config/product.json'
import { binaryRepoUrl } from '../product/identity.ts'
import {
  binaryArtifactUrl,
  getBinaryName,
  manifestUrl,
} from './nativeInstaller/artifact.ts'

const ROOT = join(import.meta.dir, '../../..')

const UPDATER_FILES = [
  'source/src/utils/autoUpdater.ts',
  'source/src/utils/nativeInstaller/download.ts',
  'source/src/utils/nativeInstaller/installer.ts',
  'source/src/utils/nativeInstaller/artifact.ts',
  'config/product.json',
  'source/src/utils/autoUpdater.test.ts',
] as const

const ANTHROPIC_HOSTS =
  /storage\.googleapis\.com|npm\.anthropic|downloads\.claude\.ai|registry\.npmjs\.org\/@anthropic-ai/i

const PLATFORMS = [
  'linux-x64',
  'linux-arm64',
  'darwin-x64',
  'darwin-arm64',
  'win32-x64',
  'win32-arm64',
] as const

test('updater reads binaryRepoUrl from product config', () => {
  expect(binaryRepoUrl).toBe(product.release.binaryRepoUrl)
  expect(binaryRepoUrl).toContain('github.com/Appsynergy-io/code')
  expect(binaryRepoUrl).not.toMatch(ANTHROPIC_HOSTS)
})

test('updater fixtures have no Anthropic GCS or npm host', () => {
  for (const rel of UPDATER_FILES) {
    const text = readFileSync(join(ROOT, rel), 'utf8')
    expect(text, rel).not.toMatch(ANTHROPIC_HOSTS)
  }
})

test('artifact selection is per platform', () => {
  expect(getBinaryName('win32-x64')).toBe('claude.exe')
  expect(getBinaryName('win32-arm64')).toBe('claude.exe')
  expect(getBinaryName('darwin-arm64')).toBe('claude')
  expect(getBinaryName('linux-x64')).toBe('claude')

  const pack = readFileSync(join(ROOT, 'build/package.sh'), 'utf8')
  for (const platform of PLATFORMS) {
    expect(pack).toContain(platform)
    expect(manifestUrl(binaryRepoUrl, pkg.version)).toBe(
      `${binaryRepoUrl}/${pkg.version}-manifest.json`,
    )
    expect(binaryArtifactUrl(binaryRepoUrl, pkg.version, platform)).toBe(
      `${binaryRepoUrl}/${pkg.version}-${platform}-${getBinaryName(platform)}`,
    )
    expect(
      binaryArtifactUrl(binaryRepoUrl, pkg.version, platform),
    ).not.toMatch(ANTHROPIC_HOSTS)
  }
})
