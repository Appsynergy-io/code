import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { dirname, extname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

export type BrandingAudit = {
  changed: string[]
  preserved: string[]
  generated: string[]
  needsReview: string[]
}

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

const SKIP_DIRS = new Set([
  '.git',
  'node_modules',
  'dist',
  'vendor',
])

const TEXT_EXTS = new Set([
  '.ts',
  '.tsx',
  '.js',
  '.json',
  '.md',
  '.sh',
  '.yml',
  '.yaml',
])

const GENERATED = new Set([
  'cli.js',
  'cli.js.map',
  'bun.lock',
  'release/branding-audit.json',
])

/** Files whose product-facing strings now come from config/product.json. */
const CHANGED = new Set([
  'config/product.json',
  'package.json',
  'README.md',
  'scripts/branding-audit.ts',
  'scripts/build.ts',
  'scripts/check.sh',
  'source/src/product/identity.ts',
  'source/src/product/identity.test.ts',
  'source/src/product/macros.d.ts',
  'source/src/constants/product.ts',
  'source/src/constants/system.ts',
  'source/src/constants/prompts.ts',
  'source/src/utils/claudemd.ts',
  'source/src/utils/config.ts',
  'source/src/utils/context.ts',
  'source/src/utils/autoUpdater.ts',
  'source/src/utils/nativeInstaller/download.ts',
  'source/src/commands/init.ts',
  'source/src/components/LogoV2/WelcomeV2.tsx',
  'source/src/components/memory/MemoryFileSelector.tsx',
  'source/src/projectOnboardingState.ts',
  'source/src/main.tsx',
])

const PRESERVED = new Set([
  'LICENSE.md',
])

const BRAND_RE =
  /Claude Code|Anthropic|anthropic|claude-code|CLAUDE\.md|@anthropic-ai|claude\.ai|CLAUDE_CODE_|ANTHROPIC_/

const PRESERVED_LINE_RE =
  /@anthropic-ai\/|ANTHROPIC_[A-Z_]+|CLAUDE_CODE_[A-Z_]+|CLAUDE_CONFIG|CODE_CONFIG_DIR|claude\.ai|code\.claude\.com|anthropic\.com|ClaudeError|isAnthropic|isFirstPartyAnthropic|getClaudeAi|CLAUDE_AI_|claude\.exe\b|bin=claude\b|USER_TYPE === 'ant'|tengu_|MACRO\.|instructionFileName|legacyInstructionFileNames/

const NEEDS_REVIEW_RE =
  /Claude Code(?! Remote)|Anthropic's official CLI|Unable to connect to Anthropic|author": "Anthropic|service:\s*'claude-code'|ATTR_SERVICE_NAME.+'claude-code'|Error: Claude Code requires/

function walk(dir: string, out: string[]): void {
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue
    const full = join(dir, name)
    const st = statSync(full)
    if (st.isDirectory()) {
      walk(full, out)
      continue
    }
    const rel = relative(ROOT, full).split('\\').join('/')
    if (GENERATED.has(rel) || TEXT_EXTS.has(extname(name))) {
      out.push(rel)
    }
  }
}

function sortUnique(items: Iterable<string>): string[] {
  return [...new Set(items)].sort((a, b) => a.localeCompare(b))
}

export function runBrandingAudit(): BrandingAudit {
  const files: string[] = []
  walk(ROOT, files)

  const changed: string[] = []
  const preserved: string[] = []
  const generated: string[] = []
  const needsReview: string[] = []

  for (const rel of files) {
    if (GENERATED.has(rel)) {
      generated.push(rel)
      continue
    }
    if (CHANGED.has(rel)) {
      changed.push(rel)
      continue
    }
    if (PRESERVED.has(rel)) {
      preserved.push(rel)
      continue
    }

    let text = ''
    try {
      text = readFileSync(join(ROOT, rel), 'utf8')
    } catch {
      continue
    }
    if (!BRAND_RE.test(text)) continue

    // User-facing leftover product strings. Extracted-source comments and
    // API/SDK identifiers stay in preserved.
    if (NEEDS_REVIEW_RE.test(text)) {
      needsReview.push(rel)
      continue
    }
    if (PRESERVED_LINE_RE.test(text) || BRAND_RE.test(text)) {
      preserved.push(rel)
    }
  }

  return {
    changed: sortUnique(changed),
    preserved: sortUnique(preserved),
    generated: sortUnique(generated),
    needsReview: sortUnique(needsReview),
  }
}

function writeAudit(audit: BrandingAudit): string {
  const outPath = join(ROOT, 'release/branding-audit.json')
  mkdirSync(dirname(outPath), { recursive: true })
  writeFileSync(outPath, `${JSON.stringify(audit, null, 2)}\n`, 'utf8')
  return outPath
}

if (import.meta.main) {
  const audit = runBrandingAudit()
  writeAudit(audit)
  process.stdout.write(`${JSON.stringify(audit, null, 2)}\n`)
}
