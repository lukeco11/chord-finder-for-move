#!/usr/bin/env sh
set -eu

ROOT=$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)
CC_BIN=${CC:-${CROSS_PREFIX:-aarch64-linux-gnu-}gcc}

mkdir -p "$ROOT/dist"
"$CC_BIN" -std=c11 -O2 -Wall -Wextra -Werror -fPIC -shared \
  -I"$ROOT/src/vendor" \
  "$ROOT/src/dsp/chord_finder.c" \
  -o "$ROOT/dist/dsp.so"
"$CC_BIN" -std=c11 -O2 -Wall -Wextra -Werror \
  "$ROOT/src/install_swap.c" \
  -o "$ROOT/dist/install-swap"

file "$ROOT/dist/dsp.so"
file "$ROOT/dist/install-swap"
for artifact in "$ROOT/dist/dsp.so" "$ROOT/dist/install-swap"; do
  if ! file "$artifact" | grep -q 'ARM aarch64'; then
    rm -f "$ROOT/dist/dsp.so" "$ROOT/dist/install-swap"
    echo "Native build is not ARM aarch64: $artifact" >&2
    exit 1
  fi
done
