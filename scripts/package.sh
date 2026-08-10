#!/usr/bin/env sh
set -eu

ROOT=$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)
STAGE="$ROOT/dist/chord-finder"

test -f "$ROOT/dist/dsp.so"
test -f "$ROOT/dist/install-swap"
for artifact in "$ROOT/dist/dsp.so" "$ROOT/dist/install-swap"; do
  if ! file "$artifact" | grep -q 'ARM aarch64'; then
    echo "Refusing to package a native artifact that is not ARM aarch64: $artifact" >&2
    exit 1
  fi
done
rm -rf "$STAGE" "$ROOT/dist/chord-finder-module.tar.gz"
mkdir -p "$STAGE"

cp "$ROOT/src/module.json" "$STAGE/module.json"
cp "$ROOT/src/ui.js" "$STAGE/ui.js"
cp "$ROOT/src/harmony.mjs" "$STAGE/harmony.mjs"
cp "$ROOT/src/ui_state.mjs" "$STAGE/ui_state.mjs"
cp "$ROOT/src/help.json" "$STAGE/help.json"
cp "$ROOT/dist/dsp.so" "$STAGE/dsp.so"
cp "$ROOT/dist/install-swap" "$STAGE/install-swap"
cp "$ROOT/README.md" "$STAGE/README.md"
cp "$ROOT/LICENSE" "$STAGE/LICENSE"

(cd "$ROOT/dist" && tar -czf chord-finder-module.tar.gz chord-finder)
tar -tzf "$ROOT/dist/chord-finder-module.tar.gz"
