import { existsSync, readFileSync, statSync } from 'node:fs'
import { dirname, extname, join, resolve } from 'node:path'
import type { BunPlugin } from 'bun'
import { buildMacro } from '../source/src/product/identity.ts'

const ROOT = resolve(import.meta.dir, '..')
const ENTRY = join(ROOT, 'source/src/entrypoints/cli.tsx')
const SHIM = join(ROOT, 'source/src/vendor/bun-bundle.ts')
const OUTFILE = 'cli.js'

const SOURCE_EXTS = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.json']

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

function stubModule(names: string[]): string {
  const lines = ['export default {}']
  for (const name of names) {
    if (name === 'default') continue
    lines.push(`export const ${name} = undefined`)
  }
  return `${lines.join('\n')}\n`
}

function missingModulePlugin(): BunPlugin {
  const stubMeta = new Map<string, { importer: string; spec: string }>()

  const missing = (importer: string, spec: string) => {
    const key = `${importer}::${spec}`
    stubMeta.set(key, { importer, spec })
    return { path: key, namespace: 'missing-module' as const }
  }

  return {
    name: 'external-build',
    setup(build) {
      build.onResolve({ filter: /^bun:bundle$/ }, () => ({ path: SHIM }))

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
        const names = data ? importedNames(data.importer, data.spec) : []
        return { contents: stubModule(names), loader: 'js' }
      })

      build.onLoad({ filter: /\.[cm]?[jt]sx?$/ }, async (args) => {
        let contents = await Bun.file(args.path).text()
        contents = contents.replace(
          /\bfeature\s*\(\s*(['"`])[^'"`]*\1\s*\)/g,
          'false',
        )
        const ext = extname(args.path)
        const loader =
          ext === '.tsx' ? 'tsx' : ext === '.jsx' ? 'jsx' : ext === '.ts' || ext === '.mts' ? 'ts' : 'js'
        return { contents, loader }
      })
    },
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

  const result = await Bun.build({
    entrypoints: [ENTRY],
    outdir: ROOT,
    target: 'node',
    format: 'esm',
    naming: outfile,
    minify: true,
    sourcemap: 'none',
    plugins: [missingModulePlugin()],
    define,
    banner: '#!/usr/bin/env node',
  })

  if (!result.success) {
    const detail = result.logs.map((log) => String(log)).join('\n')
    throw new Error(`bun build failed\n${detail}`)
  }
  return join(ROOT, outfile)
}

if (import.meta.main) {
  const out = await buildCli()
  process.stdout.write(`built ${out}\n`)
}
