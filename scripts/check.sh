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
