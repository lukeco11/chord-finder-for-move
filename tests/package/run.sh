#!/usr/bin/env sh
set -eu

node -e '
  const fs = require("fs");
  const manifest = JSON.parse(fs.readFileSync("src/module.json", "utf8"));
  const release = JSON.parse(fs.readFileSync("release.json", "utf8"));
  const catalog = JSON.parse(fs.readFileSync("catalog-entry.json", "utf8"));
  const help = JSON.parse(fs.readFileSync("src/help.json", "utf8"));
  const packageJson = JSON.parse(fs.readFileSync("package.json", "utf8"));
  if (manifest.id !== "chord-finder") throw new Error("wrong module id");
  if (release.version !== manifest.version) throw new Error("release version mismatch");
  if (packageJson.version !== manifest.version) throw new Error("package version mismatch");
  if (!release.download_url.includes(`/v${manifest.version}/`)) throw new Error("release URL version mismatch");
  if (catalog.id !== manifest.id) throw new Error("catalog id mismatch");
  if (manifest.component_type !== "tool") throw new Error("must be a tool");
  if (!manifest.tool_config || manifest.tool_config.overtake !== true) throw new Error("must use overtake");
  if (!manifest.capabilities || manifest.capabilities.suspend_keeps_js !== true) throw new Error("must suspend with JS");
  if (!manifest.capabilities.button_passthrough.includes(85) || !manifest.capabilities.button_passthrough.includes(86)) throw new Error("transport passthrough missing");
  const helpText = help.children.flatMap(section => section.lines).join(" ");
  for (const phrase of ["ROOT, NEXT, VOICE", "Shift + Step", "TEST OUTPUT", "Shift + left pad", "Hold a right chord", "next slot"]) {
    if (!helpText.includes(phrase)) throw new Error(`help missing ${phrase}`);
  }
'

test -f src/ui.js
test -f src/harmony.mjs
test -f src/keyboard.mjs
test -f src/ui_state_v4.mjs
test -f src/dsp/chord_finder.c
test -f src/install_swap.c
test -f src/help.json
test -f release.json
test -f LICENSE

node --check src/ui.js
sh -n scripts/build.sh scripts/build-dsp.sh scripts/package.sh scripts/install.sh scripts/verify-package.sh

grep -q 'settings.json' scripts/install.sh
grep -q 'chord-finder.install' scripts/install.sh
grep -q 'trap rollback' scripts/install.sh
grep -q 'install-swap' scripts/install.sh
grep -q 'RENAME_EXCHANGE' src/install_swap.c
grep -q 'ARM aarch64' scripts/build-dsp.sh
grep -q 'ARM aarch64' scripts/package.sh
grep -q 'keyboard.mjs' scripts/package.sh
grep -q 'ui_state_v4.mjs' scripts/package.sh
grep -q 'verify-package.sh' scripts/package.sh

if [ -f dist/chord-finder-module.tar.gz ]; then
  ./scripts/verify-package.sh
fi
