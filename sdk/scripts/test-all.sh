#!/usr/bin/env bash
#
# Run every SDK's checks. Nothing here touches the network: all four suites
# drive a stub HTTP server on 127.0.0.1.
#
#   sdk/scripts/test-all.sh          # every SDK that has a toolchain installed
#   sdk/scripts/test-all.sh go rust  # only the named ones
#
# A missing toolchain is a skip, not a failure — you should be able to work on
# the Python client without installing Rust. Anything that actually runs and
# fails exits non-zero.

set -uo pipefail

SDK_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$SDK_DIR"

TARGETS=("$@")
if [ ${#TARGETS[@]} -eq 0 ]; then
  TARGETS=(typescript go python rust)
fi

FAILED=()
SKIPPED=()
PASSED=()

log() { printf '\n\033[1m── %s\033[0m\n' "$1"; }

# run <name> <required-binary> <command...>
run() {
  local name="$1" binary="$2"
  shift 2

  if ! command -v "$binary" >/dev/null 2>&1; then
    SKIPPED+=("$name (no $binary)")
    printf '   skipped: %s not installed\n' "$binary"
    return 0
  fi

  if "$@"; then
    PASSED+=("$name")
  else
    FAILED+=("$name")
  fi
}

typescript() {
  log "typescript"
  # pnpm, not npm: the rest of this repo is a pnpm workspace.
  run typescript pnpm bash -c 'cd typescript && pnpm install --frozen-lockfile && pnpm typecheck && pnpm test'
}

go_sdk() {
  log "go"
  run go go bash -c '
    cd go
    unformatted=$(gofmt -l .)
    if [ -n "$unformatted" ]; then
      echo "gofmt needed:"; echo "$unformatted"; exit 1
    fi
    go vet ./... && go build ./... && go test ./...
  '
}

python_sdk() {
  log "python"
  # tests/ is on the path as well as src/: the suite imports its stub server and
  # payload fixtures as top-level modules.
  run python python3 bash -c '
    cd python
    PYTHONPATH=src:tests python3 -m unittest discover -s tests -t tests -v
  '
}

rust_sdk() {
  log "rust"
  # --examples too: the examples are only checked if something compiles them.
  run rust cargo bash -c 'cd rust && cargo test && cargo build --examples'
}

for target in "${TARGETS[@]}"; do
  case "$target" in
    typescript|ts) typescript ;;
    go|golang)     go_sdk ;;
    python|py)     python_sdk ;;
    rust|rs)       rust_sdk ;;
    *) echo "unknown target: $target (expected typescript, go, python or rust)" >&2; exit 2 ;;
  esac
done

log "summary"
[ ${#PASSED[@]}  -gt 0 ] && printf '  passed:  %s\n' "${PASSED[*]}"
[ ${#SKIPPED[@]} -gt 0 ] && printf '  skipped: %s\n' "${SKIPPED[*]}"
[ ${#FAILED[@]}  -gt 0 ] && printf '  FAILED:  %s\n' "${FAILED[*]}"

if [ ${#FAILED[@]} -gt 0 ]; then
  exit 1
fi
if [ ${#PASSED[@]} -eq 0 ]; then
  echo "  nothing ran — no toolchains found" >&2
  exit 2
fi
echo "  all green"
