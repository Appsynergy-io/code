#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

echo ':: typecheck'
bun x tsc --noEmit -p tsconfig.json

echo ':: tests'
bun test \
  scripts/extract-deps.test.ts \
  source/src/vendor/bun-bundle.test.ts \
  source/src/product/identity.test.ts \
  scripts/build.test.ts

echo ':: build'
bun scripts/build.ts

echo ':: smoke --version'
expected="$(bun -e 'import pkg from "./package.json"; import product from "./config/product.json"; process.stdout.write(`${pkg.version} (${product.displayName})`)' )"
out="$(bun cli.js --version)"
printf '%s\n' "$out"
if [ "$out" != "$expected" ]; then
  echo "expected version line '$expected', got: $out" >&2
  exit 1
fi

echo ':: smoke --help'
bun -e '
const proc = Bun.spawn(["node", "cli.js", "--help"], { stdout: "pipe", stderr: "pipe" })
const timer = setTimeout(() => proc.kill(), 45_000)
const [stdout, stderr, code] = await Promise.all([
  new Response(proc.stdout).text(),
  new Response(proc.stderr).text(),
  proc.exited,
])
clearTimeout(timer)
const text = stdout + stderr
if (/parseFrontmatter|SKILL_MD is not|markdown\.match/.test(text)) {
  process.stderr.write(text)
  process.exit(1)
}
if (code !== 0) {
  process.stderr.write(text)
  process.stderr.write(`node cli.js --help exited ${code}\\n`)
  process.exit(1)
}
if (!/Usage:/.test(stdout)) {
  process.stderr.write(text)
  process.stderr.write("node cli.js --help produced no Usage line\\n")
  process.exit(1)
}
process.stdout.write(stdout.slice(0, 400) + "\\n")
'
