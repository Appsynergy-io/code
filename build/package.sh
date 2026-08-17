#!/usr/bin/env bash
# Emit dist/{os}-{arch}/claude[.exe] for the binary-repo contract.
# Vendor natives are keyed {arch}-{os}; cells without them are not packaged.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

DIST="${DIST:-$ROOT/dist}"

# os-arch (artifact) → arch-os (vendor/)
PLATFORMS=(
  linux-x64
  linux-arm64
  darwin-x64
  darwin-arm64
  win32-x64
  win32-arm64
)

usage() {
  echo "Usage: build/package.sh [--all | --checksums | os arch]" >&2
  exit 2
}

vendor_key() {
  local os="$1" arch="$2"
  printf '%s-%s' "$arch" "$os"
}

has_vendor() {
  local key="$1"
  [[ -f "vendor/ripgrep/${key}/rg" || -f "vendor/ripgrep/${key}/rg.exe" ]] \
    && [[ -f "vendor/audio-capture/${key}/audio-capture.node" ]]
}

binary_name() {
  local os="$1"
  if [[ "$os" == win32 ]]; then
    echo claude.exe
  else
    echo claude
  fi
}

ensure_cli() {
  if [[ ! -f "$ROOT/cli.js" ]]; then
    bun scripts/build.ts
  fi
  if [[ ! -s "$ROOT/cli.js" ]]; then
    echo "cli.js is missing or empty" >&2
    exit 1
  fi
}

package_one() {
  local os="$1" arch="$2"
  local platform="${os}-${arch}"
  local key
  key="$(vendor_key "$os" "$arch")"
  if ! has_vendor "$key"; then
    echo "no vendor natives for ${platform} (looked for vendor/*/${key})" >&2
    return 1
  fi
  ensure_cli
  local bin
  bin="$(binary_name "$os")"
  local outdir="${DIST}/${platform}"
  mkdir -p "$outdir"
  cp "$ROOT/cli.js" "${outdir}/${bin}"
  chmod +x "${outdir}/${bin}"
  echo "packaged ${platform}/${bin}"
}

write_checksums() {
  local tmp
  tmp="$(mktemp)"
  if [[ ! -d "$DIST" ]]; then
    echo "no ${DIST} to checksum" >&2
    exit 1
  fi
  # Stable order matches PLATFORMS, then any extras.
  local platform os bin path
  for platform in "${PLATFORMS[@]}"; do
    os="${platform%%-*}"
    bin="$(binary_name "$os")"
    path="${DIST}/${platform}/${bin}"
    if [[ -f "$path" ]]; then
      (cd "$DIST" && shasum -a 256 "${platform}/${bin}")
    fi
  done >"$tmp"
  if [[ ! -s "$tmp" ]]; then
    echo "no platform binaries found under ${DIST}" >&2
    rm -f "$tmp"
    exit 1
  fi
  mv "$tmp" "${DIST}/checksums.txt"
  echo "wrote ${DIST}/checksums.txt"
}

package_all() {
  local platform os arch
  local failed=0
  for platform in "${PLATFORMS[@]}"; do
    os="${platform%%-*}"
    arch="${platform#*-}"
    if has_vendor "$(vendor_key "$os" "$arch")"; then
      package_one "$os" "$arch" || failed=1
    fi
  done
  if [[ "$failed" -ne 0 ]]; then
    exit 1
  fi
  write_checksums
}

if [[ $# -eq 0 || "${1:-}" == --all ]]; then
  package_all
elif [[ "${1:-}" == --checksums ]]; then
  write_checksums
elif [[ $# -eq 2 ]]; then
  package_one "$1" "$2"
  write_checksums
else
  usage
fi
