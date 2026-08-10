#!/usr/bin/env sh
set -eu

ROOT=$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)
ARCHIVE=${1:-"$ROOT/dist/chord-finder-module.tar.gz"}
EXPECTED_VERSION=$(sed -n 's/.*"version": "\([^"]*\)".*/\1/p' "$ROOT/src/module.json")

test -f "$ARCHIVE"

expected=$(printf '%s\n' \
  chord-finder/ \
  chord-finder/LICENSE \
  chord-finder/README.md \
  chord-finder/dsp.so \
  chord-finder/harmony.mjs \
  chord-finder/help.json \
  chord-finder/install-swap \
  chord-finder/keyboard.mjs \
  chord-finder/module.json \
  chord-finder/ui.js \
  chord-finder/ui_state_v4.mjs | LC_ALL=C sort)
actual=$(tar -tzf "$ARCHIVE" | LC_ALL=C sort)
if [ "$actual" != "$expected" ]; then
  echo "Archive runtime files do not match the expected module contents." >&2
  printf 'Expected:\n%s\nActual:\n%s\n' "$expected" "$actual" >&2
  exit 1
fi

archive_version=$(tar -xOf "$ARCHIVE" chord-finder/module.json | \
  sed -n 's/.*"version": "\([^"]*\)".*/\1/p')
if [ "$archive_version" != "$EXPECTED_VERSION" ]; then
  echo "Archive version $archive_version does not match source version $EXPECTED_VERSION." >&2
  exit 1
fi

for pair in \
  module.json:src/module.json \
  ui.js:src/ui.js \
  harmony.mjs:src/harmony.mjs \
  keyboard.mjs:src/keyboard.mjs \
  ui_state_v4.mjs:src/ui_state_v4.mjs \
  help.json:src/help.json \
  dsp.so:dist/dsp.so \
  install-swap:dist/install-swap \
  README.md:README.md \
  LICENSE:LICENSE; do
  packaged=${pair%%:*}
  source=${pair#*:}
  tar -xOf "$ARCHIVE" "chord-finder/$packaged" | cmp -s - "$ROOT/$source" || {
    echo "Archive contains a stale or changed copy of $packaged." >&2
    exit 1
  }
done

for imported in $(tar -xOf "$ARCHIVE" chord-finder/ui.js | \
  sed -n "s/.*from '\.\/\([^']*\)'.*/\1/p"); do
  printf '%s\n' "$actual" | grep -qx "chord-finder/$imported" || {
    echo "Archive is missing local UI import: $imported" >&2
    exit 1
  }
done

echo "Verified Chord Finder archive $archive_version."
