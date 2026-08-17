#!/usr/bin/env bash
# Named stages so CI jobs can run a subset. Missing tests skip until PR 8.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

DIST="${DIST:-$ROOT/dist}"

UNIT_TESTS=(
  scripts/extract-deps.test.ts
  source/src/vendor/bun-bundle.test.ts
  source/src/product/identity.test.ts
  scripts/build.test.ts
  source/src/utils/claudemd.test.ts
)

INTEGRATION_TESTS=(
  source/src/utils/autoUpdater.test.ts
)

CONTEXT_TESTS=(
  source/src/utils/context.test.ts
  source/src/services/compact/autoCompact.test.ts
)

TASK_TESTS=(
  source/src/utils/task/taskState.test.ts
)

SUBAGENT_TESTS=(
  source/src/coordinator/transitions.test.ts
  source/src/utils/agentScheduler.test.ts
  source/src/tools/AgentTool/AgentTool.test.ts
)

existing() {
  local f
  for f in "$@"; do
    [[ -f "$f" ]] && printf '%s\n' "$f"
  done
}

run_tests() {
  local label="$1"
  shift
  local -a files=()
  while IFS= read -r f; do
    files+=("$f")
  done < <(existing "$@")
  if [[ ${#files[@]} -eq 0 ]]; then
    echo ":: skip ${label} (no tests yet)"
    return 0
  fi
  echo ":: ${label}"
  bun test "${files[@]}"
}

stage_lint() {
  echo ':: lint'
  if [[ -f scripts/branding-audit.ts ]]; then
    bun scripts/branding-audit.ts >/dev/null
  else
    echo 'skip lint (no linter configured)'
  fi
}

stage_format() {
  echo ':: format'
  echo 'skip format (no formatter configured)'
}

stage_typecheck() {
  echo ':: typecheck'
  bun x tsc --noEmit -p tsconfig.json
}

stage_unit() {
  run_tests tests "${UNIT_TESTS[@]}"
}

stage_integration() {
  run_tests integration "${INTEGRATION_TESTS[@]}"
}

stage_context() {
  run_tests context-management "${CONTEXT_TESTS[@]}"
}

stage_task() {
  run_tests task-recovery "${TASK_TESTS[@]}"
}

stage_subagent() {
  run_tests 'sub-agent orchestration' "${SUBAGENT_TESTS[@]}"
}

stage_build() {
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
}

stage_package() {
  echo ':: package'
  bash "$ROOT/build/package.sh" "$@"
}

validate_one() {
  local os="$1" arch="$2"
  local platform="${os}-${arch}"
  local vendor="${arch}-${os}"
  local bin=claude
  [[ "$os" == win32 ]] && bin=claude.exe
  local path="${DIST}/${platform}/${bin}"
  if [[ ! -f "$path" ]]; then
    echo "missing artifact ${path}" >&2
    return 1
  fi
  if [[ ! -s "$path" ]]; then
    echo "empty artifact ${path}" >&2
    return 1
  fi
  if [[ ! -f "vendor/ripgrep/${vendor}/rg" && ! -f "vendor/ripgrep/${vendor}/rg.exe" ]]; then
    echo "missing vendor ripgrep for ${platform} (vendor/ripgrep/${vendor})" >&2
    return 1
  fi
  if [[ ! -f "vendor/audio-capture/${vendor}/audio-capture.node" ]]; then
    echo "missing vendor audio-capture for ${platform}" >&2
    return 1
  fi
  local sums="${DIST}/checksums.txt"
  if [[ ! -f "$sums" && -f "${DIST}/${platform}/checksums.txt" ]]; then
    sums="${DIST}/${platform}/checksums.txt"
  fi
  if [[ ! -f "$sums" ]]; then
    echo "missing checksums.txt for ${platform}" >&2
    return 1
  fi
  local expected actual
  expected="$(awk -v key="${platform}/${bin}" '$2 == key { print $1; exit }' "$sums")"
  if [[ -z "$expected" ]]; then
    echo "checksums.txt has no entry for ${platform}/${bin}" >&2
    return 1
  fi
  actual="$(shasum -a 256 "$path" | awk '{ print $1 }')"
  if [[ "$actual" != "$expected" ]]; then
    echo "checksum mismatch for ${platform}/${bin}: ${actual} != ${expected}" >&2
    return 1
  fi
  echo "ok ${platform}/${bin} ($(wc -c <"$path" | tr -d ' ') bytes)"
}

stage_validate() {
  echo ':: artifact validation'
  if [[ $# -eq 2 ]]; then
    validate_one "$1" "$2"
    return
  fi
  if [[ ! -d "$DIST" ]]; then
    echo "no ${DIST}; run scripts/check.sh package first" >&2
    exit 1
  fi
  local found=0 platform os arch
  for platform in linux-x64 linux-arm64 darwin-x64 darwin-arm64 win32-x64 win32-arm64; do
    os="${platform%%-*}"
    arch="${platform#*-}"
    if [[ -d "${DIST}/${platform}" ]]; then
      validate_one "$os" "$arch"
      found=1
    fi
  done
  if [[ "$found" -eq 0 ]]; then
    echo "no platform artifacts under ${DIST}" >&2
    exit 1
  fi
}

run_stage() {
  local stage="$1"
  shift || true
  case "$stage" in
    lint) stage_lint ;;
    format) stage_format ;;
    typecheck) stage_typecheck ;;
    unit|tests) stage_unit ;;
    integration) stage_integration ;;
    context-management|context) stage_context ;;
    task-recovery|task) stage_task ;;
    sub-agent|sub-agent-orchestration|'sub-agent orchestration') stage_subagent ;;
    build) stage_build ;;
    package) stage_package "$@" ;;
    validate|artifact-validation|'artifact validation') stage_validate "$@" ;;
    *)
      echo "unknown stage: ${stage}" >&2
      echo "stages: lint format typecheck unit integration context-management task-recovery sub-agent build package validate" >&2
      exit 2
      ;;
  esac
}

if [[ $# -eq 0 ]]; then
  # Local/full gate: current PR 2 checks plus package/validate.
  stage_typecheck
  stage_unit
  stage_build
  stage_package
  stage_validate
  exit 0
fi

# Remaining args after the last known stage name are os/arch for package|validate.
stages=()
extras=()
while [[ $# -gt 0 ]]; do
  case "$1" in
    lint|format|typecheck|unit|tests|integration|context-management|context|task-recovery|task|sub-agent|sub-agent-orchestration|build|package|validate|artifact-validation)
      stages+=("$1")
      shift
      ;;
    'sub-agent orchestration'|'artifact validation')
      stages+=("$1")
      shift
      ;;
    *)
      extras+=("$@")
      break
      ;;
  esac
done

if [[ ${#stages[@]} -eq 0 ]]; then
  echo "unknown stage: ${extras[0]:-}" >&2
  exit 2
fi

i=0
for stage in "${stages[@]}"; do
  i=$((i + 1))
  if [[ "$i" -eq ${#stages[@]} && ${#extras[@]} -gt 0 ]]; then
    run_stage "$stage" "${extras[@]}"
  else
    run_stage "$stage"
  fi
done
