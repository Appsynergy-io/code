import { expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import product from '../../../config/product.json'
import { binaryRepoUrl } from '../product/identity.ts'

const ROOT = join(import.meta.dir, '../../..')

const UPDATER_FILES = [
  'source/src/utils/autoUpdater.ts',
  'source/src/utils/nativeInstaller/download.ts',
  'source/src/utils/nativeInstaller/installer.ts',
  'config/product.json',
  'source/src/utils/autoUpdater.test.ts',
] as const

const ANTHROPIC_HOSTS =
  /storage\.googleapis\.com|npm\.anthropic|downloads\.claude\.ai|registry\.npmjs\.org\/@anthropic-ai/i

function binaryNameForPlatform(platform: string): string {
  return platform.startsWith('win32') ? 'claude.exe' : 'claude'
}

function artifactUrl(
  baseUrl: string,
  version: string,
  platform: string,
): string {
  return `${baseUrl}/${version}/${platform}/${binaryNameForPlatform(platform)}`
}

test('updater reads binaryRepoUrl from product config', () => {
  expect(binaryRepoUrl).toBe(product.release.binaryRepoUrl)
  expect(binaryRepoUrl).toContain('github.com/Appsynergy-io/code')

  const updater = readFileSync(join(ROOT, 'source/src/utils/autoUpdater.ts'), 'utf8')
  const download = readFileSync(
    join(ROOT, 'source/src/utils/nativeInstaller/download.ts'),
    'utf8',
  )
  expect(updater).toContain("from '../product/identity.js'")
  expect(updater).toContain('binaryRepoUrl')
  expect(updater).toContain('`${binaryRepoUrl}/${channel}`')
  expect(updater).toContain('`${binaryRepoUrl}/${latest}/manifest.json`')
  expect(download).toContain('binaryRepoUrl')
  expect(download).toContain('`${baseUrl}/${version}/manifest.json`')
})

test('updater fixtures have no Anthropic GCS or npm host', () => {
  for (const rel of UPDATER_FILES) {
    const text = readFileSync(join(ROOT, rel), 'utf8')
    expect(text, rel).not.toMatch(ANTHROPIC_HOSTS)
  }
})

test('artifact selection is per platform', () => {
  const download = readFileSync(
    join(ROOT, 'source/src/utils/nativeInstaller/download.ts'),
    'utf8',
  )
  const installer = readFileSync(
    join(ROOT, 'source/src/utils/nativeInstaller/installer.ts'),
    'utf8',
  )
  const pack = readFileSync(join(ROOT, 'build/package.sh'), 'utf8')

  expect(installer).toContain(
    "return platform.startsWith('win32') ? 'claude.exe' : 'claude'",
  )
  expect(download).toContain(
    '`${baseUrl}/${version}/${platform}/${binaryName}`',
  )
  expect(download).toContain('manifest.platforms[platform]')

  for (const platform of [
    'linux-x64',
    'linux-arm64',
    'darwin-x64',
    'darwin-arm64',
    'win32-x64',
    'win32-arm64',
  ]) {
    expect(pack).toContain(platform)
    const url = artifactUrl(binaryRepoUrl, '2.1.88', platform)
    expect(url).toBe(
      `${binaryRepoUrl}/2.1.88/${platform}/${binaryNameForPlatform(platform)}`,
    )
    expect(url).not.toMatch(ANTHROPIC_HOSTS)
  }
  expect(binaryNameForPlatform('win32-x64')).toBe('claude.exe')
  expect(binaryNameForPlatform('darwin-arm64')).toBe('claude')
})
