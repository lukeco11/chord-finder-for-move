#!/usr/bin/env sh
set -eu

ROOT=$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)
VERSION=$(sed -n 's/.*"version": "\([^"]*\)".*/\1/p' "$ROOT/src/module.json")
MOVE_HOST=${MOVE_HOST:-move.local}
MOVE_USER=${MOVE_USER:-ableton}
REMOTE="/data/UserData/schwung/modules/tools/chord-finder"
REMOTE_BASE="/data/UserData/schwung/modules/tools"
TOKEN=$$
REMOTE_STAGE="$REMOTE_BASE/.chord-finder.install.$TOKEN"
REMOTE_ARCHIVE="/tmp/chord-finder-$TOKEN.tar.gz"

test -f "$ROOT/dist/chord-finder-module.tar.gz"
scp "$ROOT/dist/chord-finder-module.tar.gz" "$MOVE_USER@$MOVE_HOST:$REMOTE_ARCHIVE"
ssh "$MOVE_USER@$MOVE_HOST" sh -s -- \
  "$REMOTE" "$REMOTE_STAGE" "$REMOTE_ARCHIVE" <<'REMOTE_SCRIPT'
set -eu
remote=$1
stage=$2
archive=$3

rollback() {
  status=$?
  trap - 0 1 2 15
  rm -rf "$stage"
  rm -f "$archive"
  exit "$status"
}
trap rollback 0 1 2 15

rm -rf "$stage"
mkdir -p "$stage"
tar -xzf "$archive" -C "$stage" --strip-components=1
if [ -f "$remote/settings.json" ]; then
  cp "$remote/settings.json" "$stage/settings.json"
fi
chown -R ableton:users "$stage"

if [ -d "$remote" ]; then
  "$stage/install-swap" "$stage" "$remote"
  rm -rf "$stage"
else
  mv "$stage" "$remote"
fi
REMOTE_SCRIPT

echo "Installed Chord Finder. Exit and reopen it from Schwung Tools to load version $VERSION."
