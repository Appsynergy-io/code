import { existsSync, readFileSync, statSync } from 'node:fs'
import { dirname, extname, join, relative, resolve } from 'node:path'
import type { BunPlugin } from 'bun'
import { buildMacro } from '../source/src/product/identity.ts'

const ROOT = resolve(import.meta.dir, '..')
const ENTRY = join(ROOT, 'source/src/entrypoints/cli.tsx')
const SHIM = join(ROOT, 'source/src/vendor/bun-bundle.ts')
const OUTFILE = 'cli.js'

const SOURCE_EXTS = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.json']

export const TEXT_ASSET_RE = /\.(md|txt|html|htm|svg|css|csv|ya?ml)$/i

export const NAPI_REMAPS: Record<string, string> = {
  'color-diff-napi': join(ROOT, 'source/src/native-ts/color-diff/index.ts'),
  'modifiers-napi': join(ROOT, 'source/vendor/modifiers-napi-src/index.ts'),
  'image-processor-napi': join(ROOT, 'source/vendor/image-processor-src/index.ts'),
  'audio-capture-napi': join(ROOT, 'source/vendor/audio-capture-src/index.ts'),
  'url-handler-napi': join(ROOT, 'source/vendor/url-handler-src/index.ts'),
}

export type StubKind = 'text' | 'missing'
export type StubRecord = { spec: string; importer: string; kind: StubKind }

export function rewriteFeatureCalls(source: string): string {
  return source.replace(
    /\bfeature\s*\(\s*(['"`])[^'"`]*\1\s*,?\s*\)/g,
    'false',
  )
}

export function isTextAsset(spec: string): boolean {
  return TEXT_ASSET_RE.test(spec)
}

export function stubContents(spec: string, names: string[] = []): string {
  if (isTextAsset(spec)) {
    return 'export default ""\n'
  }
  // Empty array: named collection imports (.map) must not throw at module init.
  const lines = ['const __stub = Object.freeze([])', 'export default __stub']
  for (const name of names) {
    if (name === 'default') continue
    lines.push(`export const ${name} = __stub`)
  }
  return `${lines.join('\n')}\n`
}

function isFile(path: string): boolean {
  try {
    return statSync(path).isFile()
  } catch {
    return false
  }
}

function stemOf(base: string): string {
  if (base.endsWith('.jsx')) return base.slice(0, -4)
  if (base.endsWith('.mjs') || base.endsWith('.cjs') || base.endsWith('.tsx')) {
    return base.slice(0, -4)
  }
  if (base.endsWith('.js') || base.endsWith('.ts')) return base.slice(0, -3)
  return base
}

function resolveLocal(base: string): string | null {
  if (isFile(base)) return base
  const stem = stemOf(base)
  for (const ext of SOURCE_EXTS) {
    const candidate = stem + ext
    if (isFile(candidate)) return candidate
  }
  for (const ext of SOURCE_EXTS) {
    const candidate = join(stem, `index${ext}`)
    if (isFile(candidate)) return candidate
  }
  return null
}

function importedNames(importer: string, spec: string): string[] {
  if (!importer || !existsSync(importer)) return []
  const text = readFileSync(importer, 'utf8')
  const names = new Set<string>()
  const escaped = spec.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const fromRe = new RegExp(
    `(?:import|export)\\s+(?:type\\s+)?(?:([\\w$]+)|\\*\\s+as\\s+[\\w$]+|\\{([^}]*)\\})\\s+from\\s+['"]${escaped}['"]`,
    'g',
  )
  let match: RegExpExecArray | null
  while ((match = fromRe.exec(text)) !== null) {
    if (match[1]) names.add(match[1])
    if (match[2]) {
      for (const part of match[2].split(',')) {
        const ident = part
          .replace(/\btype\b/g, '')
          .replace(/\s+as\s+[\w$]+/g, '')
          .trim()
        if (ident && /^[\w$]+$/.test(ident)) names.add(ident)
      }
    }
  }
  return [...names]
}

export function createBuildPlugin(): { plugin: BunPlugin; stubs: StubRecord[] } {
  const stubs: StubRecord[] = []
  const stubMeta = new Map<string, { importer: string; spec: string }>()

  const missing = (importer: string, spec: string) => {
    const kind: StubKind = isTextAsset(spec) ? 'text' : 'missing'
    stubs.push({ spec, importer, kind })
    const key = `${importer}::${spec}`
    stubMeta.set(key, { importer, spec })
    return { path: key, namespace: 'missing-module' as const }
  }

  const plugin: BunPlugin = {
    name: 'external-build',
    setup(build) {
      build.onResolve({ filter: /^bun:bundle$/ }, () => ({ path: SHIM }))

      const napiNames = Object.keys(NAPI_REMAPS).join('|')
      build.onResolve({ filter: new RegExp(`^(?:${napiNames})$`) }, (args) => {
        const dest = NAPI_REMAPS[args.path]
        if (dest && existsSync(dest)) return { path: dest }
        return missing(args.importer, args.path)
      })

      build.onResolve({ filter: /^src\// }, (args) => {
        const abs = join(ROOT, 'source', args.path)
        const resolved = resolveLocal(abs)
        if (resolved) return { path: resolved }
        return missing(args.importer, args.path)
      })

      build.onResolve({ filter: /^\./ }, (args) => {
        if (!args.importer || args.namespace === 'missing-module') return
        const abs = resolve(dirname(args.importer), args.path)
        const resolved = resolveLocal(abs)
        if (resolved) return { path: resolved }
        return missing(args.importer, args.path)
      })

      build.onResolve({ filter: /^(?:@ant\/|audio-capture\.node$|.*-napi$)/ }, (args) =>
        missing(args.importer, args.path),
      )

      build.onLoad({ filter: /.*/, namespace: 'missing-module' }, (args) => {
        const data = stubMeta.get(args.path)
        const spec = data?.spec ?? args.path
        const names = data ? importedNames(data.importer, data.spec) : []
        return { contents: stubContents(spec, names), loader: 'js' }
      })

      build.onLoad({ filter: /\.[cm]?[jt]sx?$/ }, async (args) => {
        let contents = await Bun.file(args.path).text()
        contents = rewriteFeatureCalls(contents)
        const ext = extname(args.path)
        const loader =
          ext === '.tsx' ? 'tsx' : ext === '.jsx' ? 'jsx' : ext === '.ts' || ext === '.mts' ? 'ts' : 'js'
        return { contents, loader }
      })
    },
  }

  return { plugin, stubs }
}

function printStubInventory(stubs: StubRecord[]): void {
  const text = stubs.filter((s) => s.kind === 'text')
  const missing = stubs.filter((s) => s.kind === 'missing')
  process.stdout.write(
    `stubbed ${text.length} text assets, ${missing.length} missing modules\n`,
  )
  for (const s of text) {
    process.stdout.write(`  [text] ${s.spec}\n`)
  }
  const shown = missing.slice(0, 20)
  for (const s of shown) {
    const from = s.importer ? relative(ROOT, s.importer) : '?'
    process.stdout.write(`  [missing] ${s.spec}  (${from})\n`)
  }
  if (missing.length > shown.length) {
    process.stdout.write(`  … ${missing.length - shown.length} more missing\n`)
  }
}

export async function buildCli(outfile = OUTFILE): Promise<string> {
  if (!existsSync(ENTRY)) {
    throw new Error(`missing entrypoint: ${ENTRY}`)
  }
  const macro = buildMacro()
  const define: Record<string, string> = {
    MACRO: JSON.stringify(macro),
  }
  for (const [key, value] of Object.entries(macro)) {
    define[`MACRO.${key}`] = JSON.stringify(value)
  }

  const { plugin, stubs } = createBuildPlugin()
  const result = await Bun.build({
    entrypoints: [ENTRY],
    outdir: ROOT,
    target: 'node',
    format: 'esm',
    naming: outfile,
    minify: true,
    sourcemap: 'none',
    plugins: [plugin],
    define,
    banner: '#!/usr/bin/env node',
  })

  if (!result.success) {
    const detail = result.logs.map((log) => String(log)).join('\n')
    throw new Error(`bun build failed\n${detail}`)
  }
  printStubInventory(stubs)
  return join(ROOT, outfile)
}

if (import.meta.main) {
  const out = await buildCli()
  process.stdout.write(`built ${out}\n`)
}
