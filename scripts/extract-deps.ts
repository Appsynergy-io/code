import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { join, relative } from 'node:path'

export const SOURCE_ROOT = 'source'

const NODE_BUILTINS = new Set([
  'assert',
  'async_hooks',
  'buffer',
  'child_process',
  'cluster',
  'console',
  'constants',
  'crypto',
  'dgram',
  'diagnostics_channel',
  'dns',
  'domain',
  'events',
  'fs',
  'http',
  'http2',
  'https',
  'inspector',
  'module',
  'net',
  'os',
  'path',
  'perf_hooks',
  'process',
  'punycode',
  'querystring',
  'readline',
  'repl',
  'stream',
  'string_decoder',
  'sys',
  'timers',
  'tls',
  'trace_events',
  'tty',
  'url',
  'util',
  'v8',
  'vm',
  'wasi',
  'worker_threads',
  'zlib',
])

const SOURCE_EXT = new Set(['.ts', '.tsx', '.js', '.jsx', '.mts', '.cts'])

// Unpublished / vendored — not written to package.json.
const SKIP_PACKAGES = new Set([
  'audio-capture.node',
  'audio-capture-napi',
  'color-diff-napi',
  'image-processor-napi',
  'modifiers-napi',
  'url-handler-napi',
])

const SPEC_RES = [
  /(?:^|[\n;{])\s*(?:import|export)\s+(?:type\s+)?(?:[^'";]+?\s+from\s+)?['"]([^'"]+)['"]/g,
  /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
  /\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
]

const SPECIFIER_NAME =
  /^(?:(?:bun|node):)?(?:@[\w.-]+\/)?[\w.-]+(?:\/[\w.+\-@/]+)?$/

export function extractSpecifiers(source: string): string[] {
  const withoutBlock = source.replace(/\/\*[\s\S]*?\*\//g, '')
  const withoutLine = withoutBlock.replace(/(^|[^:])\/\/.*$/gm, '$1')
  const specs: string[] = []
  for (const re of SPEC_RES) {
    re.lastIndex = 0
    let match: RegExpExecArray | null
    while ((match = re.exec(withoutLine)) !== null) {
      const spec = match[1]!
      if (SPECIFIER_NAME.test(spec)) specs.push(spec)
    }
  }
  return specs
}

export function packageNameFromSpecifier(spec: string): string | null {
  if (
    !spec ||
    spec.startsWith('.') ||
    spec.startsWith('/') ||
    spec.startsWith('src/') ||
    spec.startsWith('bun:') ||
    spec.startsWith('node:') ||
    spec.startsWith('#')
  ) {
    return null
  }
  const base = spec.startsWith('@')
    ? spec.split('/').slice(0, 2).join('/')
    : spec.split('/')[0]!
  if (!base || NODE_BUILTINS.has(base)) return null
  if (base.startsWith('@ant/')) return null
  if (SKIP_PACKAGES.has(base)) return null
  return base
}

export function walkSourceFiles(root: string): string[] {
  const out: string[] = []
  const visit = (dir: string): void => {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name)
      const st = statSync(full)
      if (st.isDirectory()) {
        visit(full)
        continue
      }
      const ext = name.slice(name.lastIndexOf('.'))
      if (SOURCE_EXT.has(ext)) out.push(full)
    }
  }
  visit(root)
  return out
}

export function collectPackageNames(root: string = SOURCE_ROOT): string[] {
  const names = new Set<string>()
  for (const file of walkSourceFiles(root)) {
    const text = readFileSync(file, 'utf8')
    for (const spec of extractSpecifiers(text)) {
      const name = packageNameFromSpecifier(spec)
      if (name) names.add(name)
    }
  }
  return [...names].sort()
}

export function reconstructDependencies(
  root: string = SOURCE_ROOT,
  existing: Record<string, string> = {},
): Record<string, string> {
  const deps: Record<string, string> = {}
  for (const name of collectPackageNames(root)) {
    deps[name] = existing[name] ?? '*'
  }
  return deps
}

type PackageJson = {
  dependencies?: Record<string, string>
  [key: string]: unknown
}

export function applyDependencies(
  packageJsonPath: string,
  deps: Record<string, string>,
): PackageJson {
  const pkg = JSON.parse(readFileSync(packageJsonPath, 'utf8')) as PackageJson
  pkg.dependencies = deps
  writeFileSync(packageJsonPath, `${JSON.stringify(pkg, null, 2)}\n`)
  return pkg
}

function main(): void {
  const write = process.argv.includes('--write')
  const root = join(import.meta.dir, '..')
  const sourceRoot = join(root, SOURCE_ROOT)
  const packageJsonPath = join(root, 'package.json')
  const pkg = JSON.parse(readFileSync(packageJsonPath, 'utf8')) as PackageJson
  const deps = reconstructDependencies(sourceRoot, pkg.dependencies ?? {})
  if (write) {
    applyDependencies(packageJsonPath, deps)
    process.stdout.write(
      `wrote ${Object.keys(deps).length} dependencies to ${relative(root, packageJsonPath)}\n`,
    )
    return
  }
  process.stdout.write(`${JSON.stringify(deps, null, 2)}\n`)
}

if (import.meta.main) {
  main()
}
