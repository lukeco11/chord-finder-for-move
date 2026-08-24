# MIDI Routing Repair Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restore Chord Finder MIDI while its takeover is open, correct USB-A output, and add Schwung Chain as a preview-only destination.

**Architecture:** Chord Finder gains a third DSP destination and host-compatibility gating without changing its three progression routes. Schwung gains a bounded in-process ring dedicated to overtake DSP output; the existing shared-memory queue remains the test-bus/JavaScript input queue, so active overtake input and generated Move output no longer compete for one consumer.

**Tech Stack:** C11 DSP and host code, QuickJS UI JavaScript, Node.js tests, native C test binaries, Docker aarch64 cross-compilation, GitHub CLI.

**Spec:** `docs/superpowers/specs/2026-08-24-midi-routing-repair-design.md`

## Global Constraints

- Preserve Chord Finder's saved progression routes: `move`, `external`, and `both`.
- Add `schwung` only to the live-preview route choices.
- Preserve the Schwung plugin ABI and `/schwung-midi-inject` shared-memory ABI.
- Keep every DSP/host audio-thread path bounded and free of allocation, locks, logging, file I/O, and system calls.
- Preserve Chord Finder 0.4.2 settings and progression data.
- Use cable 2 for native Move track injection and USB-A musical MIDI.

---

### Task 1: Correct Chord Finder DSP Destinations

**Files:**
- Modify: `tests/dsp/test_chord_finder.c`
- Modify: `src/dsp/chord_finder.c`

**Interfaces:**
- Consumes: Schwung `host_api_v1_t` callbacks `midi_inject_to_move`, `midi_send_external`, and `midi_send_internal`.
- Produces: route value `3` for Schwung preview and config field `move_available` (`0` or `1`).

- [ ] **Step 1: Write failing DSP routing tests**

Add a `schwung_log`, wire `host.midi_send_internal = log_schwung`, and replace the cable assertion with these behaviors:

```c
assert(move_log.packets[0][0] == 0x29);
assert(external_log.packets[0][0] == 0x29);

api->set_param(instance, "command",
    "{\"v\":1,\"op\":\"voice_on\",\"owner\":13,\"route\":3,"
    "\"channel\":4,\"notes\":[60,64,67]}");
render(api, instance, 1);
assert(schwung_log.count == 3);
assert(move_log.count == 0);
assert(external_log.count == 0);
```

Add a separate test that configures `"move_available":0`, starts a Move voice,
renders it, and asserts no packet reaches `move_log` and `dropped` does not grow.

- [ ] **Step 2: Run the DSP test and verify RED**

Run: `bash tests/dsp/run.sh`

Expected: FAIL because USB-A uses `0x09`, route 3 is rejected, and native sends are not gated.

- [ ] **Step 3: Implement the third destination and compatibility gate**

In `src/dsp/chord_finder.c`:

```c
enum {
    DESTINATION_MOVE = 0,
    DESTINATION_EXTERNAL = 1,
    DESTINATION_SCHWUNG = 2,
    DESTINATION_COUNT = 3
};
enum {
    ROUTE_MOVE = 0,
    ROUTE_EXTERNAL = 1,
    ROUTE_BOTH = 2,
    ROUTE_SCHWUNG = 3
};
```

Expand `refs` and `pending_off` to `DESTINATION_COUNT`. Add `move_available`
defaulting to `1`. Use cable 2 for Move and external packets, cable 0 for the
internal chain packet, and dispatch each destination through its matching host
callback. Treat an unavailable native destination as intentionally suppressed,
not as a dropped callback. Accept route 3 only for `voice_on` and `output_test`;
keep `config.route` limited to 0 through 2. Apply three-destination bounds to
retry, panic, and state counting loops.

- [ ] **Step 4: Run the DSP test and verify GREEN**

Run: `bash tests/dsp/run.sh`

Expected: `DSP tests passed` from normal and sanitizer binaries.

- [ ] **Step 5: Commit the DSP repair**

```bash
git add tests/dsp/test_chord_finder.c src/dsp/chord_finder.c
git commit -m "fix: route Chord Finder MIDI to the intended destinations"
```

### Task 2: Add Preview Routing and Host Compatibility UI

**Files:**
- Modify: `tests/ui_state.test.mjs`
- Modify: `tests/ui_contract.test.mjs`
- Modify: `src/ui_state_v4.mjs`
- Modify: `src/ui.js`
- Modify: `src/help.json`

**Interfaces:**
- Consumes: DSP route value `3`, config field `move_available`, and Schwung JS sentinels `shadow_inbound_pad_midi_active` and `shadow_overtake_move_inject_active`.
- Produces: `PREVIEW_ROUTES`, `hostSupportsActiveMoveInject(globals)`, and preview setting value `schwung`.

- [ ] **Step 1: Write failing UI state tests**

Import `PREVIEW_ROUTES` and `hostSupportsActiveMoveInject`. Assert:

```javascript
assert.deepEqual(PREVIEW_ROUTES, ['move', 'external', 'both', 'schwung']);
assert.equal(migrateSettings({ route: 'schwung' }).route, 'move');
assert.equal(migrateSettings({ previewRoute: 'schwung' }).previewRoute, 'schwung');
assert.equal(hostSupportsActiveMoveInject({}), true); // Schwung <= 0.11.6
assert.equal(hostSupportsActiveMoveInject({ shadow_inbound_pad_midi_active() {} }), false);
assert.equal(hostSupportsActiveMoveInject({
  shadow_inbound_pad_midi_active() {},
  shadow_overtake_move_inject_active() {},
}), true);
```

Extend the UI contract test to require `PREVIEW_ROUTES` for menu item 2 and a
`move_available` field in DSP configuration.

- [ ] **Step 2: Run UI tests and verify RED**

Run: `node --test tests/ui_state.test.mjs tests/ui_contract.test.mjs`

Expected: FAIL because `PREVIEW_ROUTES`, the compatibility helper, and the DSP
field do not exist.

- [ ] **Step 3: Implement preview-only Schwung routing**

Keep `ROUTES` unchanged, add:

```javascript
export const PREVIEW_ROUTES = Object.freeze([...ROUTES, 'schwung']);
export function hostSupportsActiveMoveInject(globals = globalThis) {
  const hasOvertakeInput = typeof globals.shadow_inbound_pad_midi_active === 'function';
  const hasDedicatedOutput = typeof globals.shadow_overtake_move_inject_active === 'function';
  return !hasOvertakeInput || hasDedicatedOutput;
}
```

Validate `route` against `ROUTES` and `previewRoute` against
`PREVIEW_ROUTES`. In `ui.js`, add `schwung` labels/value 3, cycle menu item 2
through `PREVIEW_ROUTES`, calculate host compatibility during `init`, and send
`move_available` in every config command. When the selected live preview needs
Move on a known-broken host, do not silently rewrite the saved route; render
`MOVE FIX` in the route status and announce that Move preview requires a newer
Schwung host. Update help text to describe Schwung preview and the 0.12.0/0.12.1
native limitation.

- [ ] **Step 4: Run UI and full module tests and verify GREEN**

Run: `npm test`

Expected: all Node, DSP, sanitizer, and package tests pass.

- [ ] **Step 5: Commit the UI repair**

```bash
git add tests/ui_state.test.mjs tests/ui_contract.test.mjs src/ui_state_v4.mjs src/ui.js src/help.json
git commit -m "feat: add Schwung preview and host compatibility gating"
```

### Task 3: Separate Schwung Overtake Output from Test-Bus Input

**Files:**
- Create: `.context/schwung-current/src/host/shadow_overtake_midi.h`
- Create: `.context/schwung-current/src/host/shadow_overtake_midi.c`
- Create: `.context/schwung-current/tests/host/test_overtake_midi_route.c`
- Modify: `.context/schwung-current/tests/host/Makefile`
- Modify: `.context/schwung-current/src/host/shadow_midi.c`
- Modify: `.context/schwung-current/src/host/shadow_midi.h`
- Modify: `.context/schwung-current/src/schwung_shim.c`

**Interfaces:**
- Consumes: `shadow_midi_inject_t` and its bounded MPSC push/peek/pop helpers.
- Produces: `shadow_overtake_midi_init()`, `shadow_overtake_midi_send(msg, len)`, and `shadow_overtake_midi_drain(shared, overtake_active, midi_in, max_events)`.

- [ ] **Step 1: Create a Schwung feature branch**

Run in `.context/schwung-current`:

```bash
git checkout -b lukeco11/fix-overtake-move-inject
```

- [ ] **Step 2: Write the failing host route test**

The test initializes a shared test-bus ring and the dedicated ring, queues one
different note in each, then asserts the ownership contract:

```c
shadow_overtake_midi_init();
assert(shadow_overtake_midi_send(dsp_note, 4) == 4);
assert(shadow_midi_inject_push(&shared, test_note) == 0);

assert(shadow_overtake_midi_drain(&shared, 1, midi_in, 31) == 1);
assert(memcmp(midi_in, dsp_note, 4) == 0);
assert(shadow_midi_inject_peek(&shared, out) == 1);

memset(midi_in, 0, sizeof(midi_in));
assert(shadow_overtake_midi_drain(&shared, 0, midi_in, 31) == 1);
assert(memcmp(midi_in, test_note, 4) == 0);
```

Also fill the dedicated ring and assert the next send returns 0 without
overwriting queued packets.

- [ ] **Step 3: Run the host test and verify RED**

Add the new target to `tests/host/Makefile`, then run:

`make -C tests/host ../../build/tests/host/test_overtake_midi_route`

Expected: compilation fails because the dedicated route API does not exist.

- [ ] **Step 4: Implement the dedicated route**

Create a fixed in-process `shadow_midi_inject_t`, initialize it once, enqueue
overtake DSP packets with the existing bounded helper, and drain it before the
shared queue. The drain always consumes the dedicated queue; it consumes the
shared queue only when `overtake_active == 0`. Write 4-byte packets at an
8-byte MIDI_IN stride with zero timestamps and pop only after successful copy.

In `shadow_midi.c`, retain the existing transition hold and quiet-frame guard,
remove the active-overtake early return, and delegate the final copy loop to
`shadow_overtake_midi_drain`. In `schwung_shim.c`, initialize the dedicated
ring with MIDI routing and wire only `overtake_host_api.midi_inject_to_move` to
`shadow_overtake_midi_send`; chain and JavaScript callers stay on
`shadow_chain_midi_inject`.

- [ ] **Step 5: Run focused and complete host tests**

Run:

```bash
make -C tests/host test
for test_file in tests/host/*.sh; do bash "$test_file"; done
```

Expected: `ALL PASS` and every shell regression exits zero.

- [ ] **Step 6: Commit the host route repair**

```bash
git add src/host/shadow_overtake_midi.h src/host/shadow_overtake_midi.c \
  tests/host/test_overtake_midi_route.c tests/host/Makefile \
  src/host/shadow_midi.c src/host/shadow_midi.h src/schwung_shim.c
git commit -m "fix(overtake): keep generated Move MIDI separate from test input"
```

### Task 4: Expose and Document the Schwung Capability

**Files:**
- Modify: `.context/schwung-current/src/shadow/shadow_ui.c`
- Modify: `.context/schwung-current/docs/API.md`
- Modify: `.context/schwung-current/docs/ADDRESSING_MOVE_SYNTHS.md`
- Modify: `.context/schwung-current/CLAUDE.md`
- Create: `.context/schwung-current/tests/host/test_overtake_move_inject_contract.sh`

**Interfaces:**
- Consumes: dedicated overtake output route from Task 3.
- Produces: QuickJS sentinel `shadow_overtake_move_inject_active()`.

- [ ] **Step 1: Write the failing source contract test**

The shell test must assert that `shadow_ui.c` defines and registers
`shadow_overtake_move_inject_active`, `schwung_shim.c` wires the overtake host
callback to `shadow_overtake_midi_send`, and the API docs list the sentinel.

- [ ] **Step 2: Run the contract test and verify RED**

Run: `bash tests/host/test_overtake_move_inject_contract.sh`

Expected: FAIL because the sentinel is absent.

- [ ] **Step 3: Register and document the capability**

Add a zero-argument QuickJS function returning `1`, register it beside the
existing overtake MIDI capability sentinels, and document that overtake DSP
native output no longer shares the test-bus queue. Update the generator-tool
guide's queue description and testing section to reflect the two routes.

- [ ] **Step 4: Run Schwung verification and cross-compile**

Run:

```bash
make -C tests/host test
for test_file in tests/host/*.sh; do bash "$test_file"; done
DISABLE_SCREEN_READER=1 ./scripts/build.sh
```

Expected: all host tests pass and the aarch64 build exits zero.

- [ ] **Step 5: Commit the capability and docs**

```bash
git add src/shadow/shadow_ui.c docs/API.md docs/ADDRESSING_MOVE_SYNTHS.md \
  CLAUDE.md tests/host/test_overtake_move_inject_contract.sh
git commit -m "docs(overtake): advertise dedicated Move MIDI injection"
```

### Task 5: Package, Validate, and Publish

**Files:**
- Modify: `src/module.json`
- Modify: `release.json`
- Modify: `README.md`
- Modify: `docs/hardware-validation-results.md`

**Interfaces:**
- Consumes: completed module and Schwung host changes.
- Produces: Chord Finder 0.4.3 archive/release and a focused Schwung pull request.

- [ ] **Step 1: Update release metadata and documentation**

Bump the module and release metadata to `0.4.3`. Document Schwung preview,
correct USB-A cable routing, and the native-route compatibility rule: working
on 0.11.6, disabled on unpatched 0.12.0/0.12.1, and restored on hosts exposing
`shadow_overtake_move_inject_active`.

- [ ] **Step 2: Build and verify the release archive**

Run:

```bash
npm test
./scripts/build.sh
./scripts/verify-package.sh dist/chord-finder-module.tar.gz
tar -tzf dist/chord-finder-module.tar.gz
```

Expected: all tests pass; the archive contains `chord-finder/module.json`,
`ui.js`, ES modules, help, license, installer metadata, and aarch64 `dsp.so`.

- [ ] **Step 3: Install and validate on the attached Move**

Run: `./scripts/install.sh`

On Schwung 0.11.6, verify native note-on/off while the takeover is visible,
Schwung preview against a matching chain slot, rapid replacement, panic, and no
delayed notes after suspend. Record unavailable hardware routes explicitly if
no USB-A MIDI monitor is attached.

- [ ] **Step 4: Commit module release metadata**

```bash
git add src/module.json release.json README.md docs/hardware-validation-results.md
git commit -m "release: prepare Chord Finder 0.4.3"
```

- [ ] **Step 5: Push the Schwung branch and open the upstream PR**

Push the host branch to the `lukeco11/schwung` fork and open a PR against
`charlesvestal/schwung:main`. The PR body must include the 0.12 regression,
queue ownership diagram, realtime-safety properties, red-green host tests, and
device-validation status.

- [ ] **Step 6: Push and publish Chord Finder 0.4.3**

Push the Chord Finder branch, tag `v0.4.3`, create the GitHub release with
`dist/chord-finder-module.tar.gz`, and verify the release asset's checksum and
download URL before reporting completion.
