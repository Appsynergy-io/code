/**
 * Write the binary-repo contract onto GitHub Releases.
 *
 * Layout (matches nativeInstaller/download.ts and autoUpdater.ts):
 *   {base}/{channel}                    → version text
 *   {base}/{version}/manifest.json
 *   {base}/{version}/checksums.txt
 *   {base}/{version}/{platform}/{bin}
 *
 * GitHub cannot host both tag `release-index` and `release-index/2.1.88`
 * (a ref cannot be both a file and a directory). Everything lives on
 * tag `release-index` as flattened assets:
 *   latest | stable | nightly
 *   {version}-manifest.json
 *   {version}-checksums.txt
 *   {version}-{platform}-{bin}
 *   install.sh | install.ps1
 *
 * Usage:
 *   bun release/publish-index.ts --version 2.1.88 --artifacts ./dist
 *   bun release/publish-index.ts --version 2.1.88 --channel nightly
 *
 * Default channel is `latest`. Pass --channel / --channels to move stable or nightly.
 *
 * Auth: GITHUB_TOKEN or GH_TOKEN.
 */
import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { readdir, readFile, stat } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'

type ProductConfig = {
  cliName: string
  repository: string
  release: {
    binaryRepoUrl: string
    channels: Array<'latest' | 'stable' | 'nightly'>
    minVersion?: string
  }
}

type PlatformEntry = {
  platform: string
  binaryName: string
  filePath: string
  checksum: string
}

type Manifest = {
  version: string
  minVersion?: string
  platforms: Record<string, { checksum: string }>
}

const require = createRequire(import.meta.url)
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const product = require(join(root, 'config/product.json')) as ProductConfig
const pkg = require(join(root, 'package.json')) as { version: string }

const API = 'https://api.github.com'
const UPLOADS = 'https://uploads.github.com'

function parseArgs(argv: string[]): Record<string, string | boolean> {
  const out: Record<string, string | boolean> = {}
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (!arg.startsWith('--')) continue
    const key = arg.slice(2)
    const next = argv[i + 1]
    if (!next || next.startsWith('--')) {
      out[key] = true
    } else {
      out[key] = next
      i++
    }
  }
  return out
}

function token(): string {
  const value = process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN
  if (!value) {
    throw new Error('GITHUB_TOKEN or GH_TOKEN is required')
  }
  return value
}

function parseBinaryRepo(
  binaryRepoUrl: string,
): { owner: string; repo: string; indexTag: string } {
  const match = binaryRepoUrl.match(
    /^https:\/\/github\.com\/([^/]+)\/([^/]+)\/releases\/download\/([^/]+)\/?$/,
  )
  if (!match) {
    throw new Error(
      `binaryRepoUrl is not a GitHub Releases download URL: ${binaryRepoUrl}`,
    )
  }
  return { owner: match[1]!, repo: match[2]!, indexTag: match[3]! }
}

function sha256File(filePath: string): Promise<string> {
  return new Promise((resolveHash, reject) => {
    const hash = createHash('sha256')
    const stream = createReadStream(filePath)
    stream.on('data', chunk => hash.update(chunk))
    stream.on('error', reject)
    stream.on('end', () => resolveHash(hash.digest('hex')))
  })
}

function binaryNameFor(platform: string): string {
  return platform.startsWith('win32') ? `${product.cliName}.exe` : product.cliName
}

async function discoverArtifacts(artifactsDir: string): Promise<PlatformEntry[]> {
  const entries: PlatformEntry[] = []
  const platforms = await readdir(artifactsDir)
  for (const platform of platforms) {
    const platformDir = join(artifactsDir, platform)
    const info = await stat(platformDir).catch(() => null)
    if (!info?.isDirectory()) continue
    const binaryName = binaryNameFor(platform)
    const filePath = join(platformDir, binaryName)
    const fileInfo = await stat(filePath).catch(() => null)
    if (!fileInfo?.isFile()) continue
    entries.push({
      platform,
      binaryName,
      filePath,
      checksum: await sha256File(filePath),
    })
  }
  if (entries.length === 0) {
    throw new Error(`No platform binaries found under ${artifactsDir}`)
  }
  return entries
}

function buildManifest(
  version: string,
  platforms: PlatformEntry[],
  minVersion?: string,
): Manifest {
  const manifest: Manifest = {
    version,
    platforms: Object.fromEntries(
      platforms.map(p => [p.platform, { checksum: p.checksum }]),
    ),
  }
  if (minVersion) {
    manifest.minVersion = minVersion
  }
  return manifest
}

function buildChecksums(platforms: PlatformEntry[]): string {
  return (
    platforms
      .map(p => `${p.checksum}  ${p.platform}/${p.binaryName}`)
      .join('\n') + '\n'
  )
}

async function gh(
  method: string,
  url: string,
  body?: Buffer | string,
  contentType?: string,
): Promise<{ status: number; json: unknown }> {
  const headers: Record<string, string> = {
    Accept: 'application/vnd.github+json',
    Authorization: `Bearer ${token()}`,
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'code-publish-index',
  }
  if (contentType) {
    headers['Content-Type'] = contentType
  }
  const response = await fetch(url, {
    method,
    headers,
    body,
  })
  const text = await response.text()
  let json: unknown = null
  if (text) {
    try {
      json = JSON.parse(text)
    } catch {
      json = text
    }
  }
  return { status: response.status, json }
}

async function ensureRelease(
  owner: string,
  repo: string,
  tag: string,
  name: string,
): Promise<{ id: number; assets: Array<{ id: number; name: string }> }> {
  const existing = await gh(
    'GET',
    `${API}/repos/${owner}/${repo}/releases/tags/${encodeURIComponent(tag)}`,
  )
  if (existing.status === 200) {
    const data = existing.json as {
      id: number
      assets: Array<{ id: number; name: string }>
    }
    return { id: data.id, assets: data.assets }
  }
  if (existing.status !== 404) {
    throw new Error(
      `Failed to look up release ${tag}: HTTP ${existing.status} ${JSON.stringify(existing.json)}`,
    )
  }
  const created = await gh(
    'POST',
    `${API}/repos/${owner}/${repo}/releases`,
    JSON.stringify({
      tag_name: tag,
      target_commitish: 'main',
      name,
      body: 'Binary-repo index (channel pointers and version artifacts).',
      draft: false,
      prerelease: tag.includes('nightly'),
    }),
    'application/json',
  )
  if (created.status !== 201) {
    throw new Error(
      `Failed to create release ${tag}: HTTP ${created.status} ${JSON.stringify(created.json)}`,
    )
  }
  const data = created.json as {
    id: number
    assets: Array<{ id: number; name: string }>
  }
  return { id: data.id, assets: data.assets ?? [] }
}

async function uploadAsset(
  owner: string,
  repo: string,
  release: { id: number; assets: Array<{ id: number; name: string }> },
  name: string,
  body: Buffer,
  contentType: string,
): Promise<void> {
  const existing = release.assets.find(a => a.name === name)
  if (existing) {
    const del = await gh(
      'DELETE',
      `${API}/repos/${owner}/${repo}/releases/assets/${existing.id}`,
    )
    if (del.status !== 204) {
      throw new Error(
        `Failed to replace asset ${name}: HTTP ${del.status} ${JSON.stringify(del.json)}`,
      )
    }
    release.assets = release.assets.filter(a => a.id !== existing.id)
  }
  const uploaded = await gh(
    'POST',
    `${UPLOADS}/repos/${owner}/${repo}/releases/${release.id}/assets?name=${encodeURIComponent(name)}`,
    body,
    contentType,
  )
  if (uploaded.status !== 201) {
    throw new Error(
      `Failed to upload ${name}: HTTP ${uploaded.status} ${JSON.stringify(uploaded.json)}`,
    )
  }
}

async function uploadBootstrapInstallers(
  owner: string,
  repo: string,
  release: { id: number; assets: Array<{ id: number; name: string }> },
  base: string,
): Promise<void> {
  for (const name of ['install.sh', 'install.ps1'] as const) {
    await uploadAsset(
      owner,
      repo,
      release,
      name,
      await readFile(join(root, name)),
      'text/plain',
    )
    process.stdout.write(`  ${base}/${name}\n`)
  }
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2))
  const version =
    (typeof args.version === 'string' && args.version) || pkg.version
  const artifactsDir =
    typeof args.artifacts === 'string' ? resolve(args.artifacts) : undefined
  const minVersion =
    (typeof args['min-version'] === 'string' && args['min-version']) ||
    product.release.minVersion
  const channelArg =
    typeof args.channel === 'string'
      ? args.channel
      : typeof args.channels === 'string'
        ? args.channels
        : undefined
  const requested = channelArg
    ? channelArg.split(',').map(c => c.trim()).filter(Boolean)
    : ['latest']
  const allowed = new Set(product.release.channels)
  const invalid = requested.filter(c => !allowed.has(c as (typeof product.release.channels)[number]))
  if (invalid.length > 0) {
    throw new Error(
      `Unknown channel(s): ${invalid.join(', ')}. Use ${product.release.channels.join(', ')}`,
    )
  }
  const channels = requested as Array<(typeof product.release.channels)[number]>

  const { owner, repo, indexTag } = parseBinaryRepo(
    product.release.binaryRepoUrl,
  )
  const base = product.release.binaryRepoUrl.replace(/\/$/, '')

  process.stdout.write(
    `Publishing ${version} to ${owner}/${repo} (${base})\n`,
  )

  if (artifactsDir) {
    const platforms = await discoverArtifacts(artifactsDir)
    const manifest = buildManifest(version, platforms, minVersion)
    const checksums = buildChecksums(platforms)
    const indexRelease = await ensureRelease(
      owner,
      repo,
      indexTag,
      'Release index',
    )
    await uploadAsset(
      owner,
      repo,
      indexRelease,
      `${version}-manifest.json`,
      Buffer.from(JSON.stringify(manifest, null, 2) + '\n'),
      'application/json',
    )
    await uploadAsset(
      owner,
      repo,
      indexRelease,
      `${version}-checksums.txt`,
      Buffer.from(checksums),
      'text/plain',
    )
    process.stdout.write(`  ${base}/${version}-manifest.json\n`)
    process.stdout.write(`  ${base}/${version}-checksums.txt\n`)

    for (const entry of platforms) {
      const assetName = `${version}-${entry.platform}-${entry.binaryName}`
      await uploadAsset(
        owner,
        repo,
        indexRelease,
        assetName,
        await readFile(entry.filePath),
        'application/octet-stream',
      )
      process.stdout.write(`  ${base}/${assetName}\n`)
    }

    for (const channel of channels) {
      await uploadAsset(
        owner,
        repo,
        indexRelease,
        channel,
        Buffer.from(`${version}\n`),
        'text/plain',
      )
      process.stdout.write(`  ${base}/${channel} → ${version}\n`)
    }
    await uploadBootstrapInstallers(owner, repo, indexRelease, base)
    return
  }

  const indexRelease = await ensureRelease(
    owner,
    repo,
    indexTag,
    'Release index',
  )
  for (const channel of channels) {
    await uploadAsset(
      owner,
      repo,
      indexRelease,
      channel,
      Buffer.from(`${version}\n`),
      'text/plain',
    )
    process.stdout.write(`  ${base}/${channel} → ${version}\n`)
  }
  await uploadBootstrapInstallers(owner, repo, indexRelease, base)
}

if (import.meta.main) {
  main().catch(error => {
    process.stderr.write(
      `${error instanceof Error ? error.message : String(error)}\n`,
    )
    process.exit(1)
  })
}

export {
  buildChecksums,
  buildManifest,
  parseBinaryRepo,
}
