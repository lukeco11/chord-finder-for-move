# Simultaneous Root Revoice Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make held right-pad chords immediately revoice to a newly played left root regardless of Move's pad-event order, while Capture appends every audible revoice as a new progression step.

**Architecture:** Add physical right-pad intent and a pure snapshot-replacement helper to `ui_state.mjs`. After a left-root press refreshes candidates, `ui.js` consumes the ordered replacements and retriggers each existing DSP owner, updates the piano/chord display, and uses the existing Capture append path. No DSP change is required because replacing an owner already releases its previous notes and pending strums correctly.

**Tech Stack:** Schwung takeover JavaScript modules, Node.js built-in test runner, native C DSP regression suite, POSIX packaging scripts, Docker aarch64 cross-build.

## Global Constraints

- Right-pad sound remains immediate; do not add an input-delay window.
- Only a played left-root press revoices held chords; encoder, progression, and top-note refreshes do not.
- Replacements retain the same DSP owner `16 + rightPadIndex`.
- Capture appends the initial chord and every root-driven replacement in audible event order.
- Missing replacement candidates stop the old chord but retain physical held intent for a later root.
- Panic, routing changes, transport stop, suspend, and unload clear physical held intent.
- Preserve existing progression persistence and MIDI note cleanup contracts.

---

### Task 1: Pure Held-Pad Revoice State

**Files:**
- Modify: `src/ui_state.mjs`
- Test: `tests/ui_state.test.mjs`

**Interfaces:**
- Produces: `state.heldRight: boolean[16]`
- Produces: `revoiceHeldCandidates(state, candidates): Array<{ index, previous, next }>`
- Produces: `clearHeldCandidates(state): void`
- Changes: `pressCandidate` marks physical intent; `releaseCandidate` clears intent and snapshot.

- [ ] **Step 1: Write failing state tests**

Add tests that assert right-first replacement, ascending multi-pad order, missing-candidate intent retention, release cleanup, and full held-state cleanup:

```js
const state = createUiState();
pressCandidate(state, 5, { ...chord, notes: [60, 64, 67], label: 'C' });
pressCandidate(state, 2, { ...chord, notes: [62, 65, 69], label: 'Dm' });
const replacements = revoiceHeldCandidates(state, [
  null, null,
  { ...chord, tonicOffset: 7, notes: [67, 71, 74], label: 'G' },
  null, null,
  { ...chord, tonicOffset: 9, notes: [69, 72, 76], label: 'Am' },
]);
assert.deepEqual(replacements.map(({ index }) => index), [2, 5]);
assert.deepEqual(state.heldCandidates[2].notes, [67, 71, 74]);
assert.equal(state.heldRight[2], true);
```

For a held index whose new candidate is `null`, assert `next === null`, `heldCandidates[index] === null`, and `heldRight[index] === true`. After `releaseCandidate`, assert both snapshot and intent clear. After `clearHeldCandidates`, assert all 16 entries of both arrays are clear.

- [ ] **Step 2: Run the focused tests and verify RED**

Run: `node --test tests/ui_state.test.mjs`

Expected: FAIL because `revoiceHeldCandidates`, `clearHeldCandidates`, and `heldRight` do not exist.

- [ ] **Step 3: Implement snapshot cloning and ordered replacement**

Extract the cloning currently inside `pressCandidate` into a private `snapshotCandidate(chord)` helper. Add `heldRight` to `createUiState`, then implement:

```js
export function revoiceHeldCandidates(state, candidates) {
  const replacements = [];
  for (let index = 0; index < state.heldRight.length; index += 1) {
    if (!state.heldRight[index]) continue;
    const previous = state.heldCandidates[index];
    const next = candidates[index] ? snapshotCandidate(candidates[index]) : null;
    state.heldCandidates[index] = next;
    replacements.push({ index, previous, next });
  }
  return replacements;
}
```

Make `pressCandidate` set `heldRight[index] = true`; make `releaseCandidate` set it to `false`. Implement `clearHeldCandidates` with `.fill(false)` and `.fill(null)`.

- [ ] **Step 4: Run focused state tests and verify GREEN**

Run: `node --test tests/ui_state.test.mjs`

Expected: all UI-state tests pass.

- [ ] **Step 5: Commit the pure state behavior**

```bash
git add src/ui_state.mjs tests/ui_state.test.mjs
git commit -m "feat: track held chord pad intent"
```

---

### Task 2: Runtime Root-Driven Revoicing And Capture

**Files:**
- Modify: `src/ui.js`
- Test: `tests/ui_contract.test.mjs`

**Interfaces:**
- Consumes: `revoiceHeldCandidates(state, state.candidates)` from Task 1.
- Consumes: `clearHeldCandidates(state)` from Task 1.
- Produces: `revoiceHeldRightPads(): void`, called only after the left-root `refreshCandidates()`.
- Produces: `clearHeldPadIntent(): void` for suspend/unload cleanup.

- [ ] **Step 1: Write failing runtime contract tests**

Add source-contract assertions that require:

```js
assert.match(source, /function handleLeftPad[\s\S]*refreshCandidates\(\);\s*revoiceHeldRightPads\(\);/);
assert.match(source, /function revoiceHeldRightPads[\s\S]*revoiceHeldCandidates\(state, state\.candidates\)/);
assert.match(source, /playVoice\(16 \+ index, next\.notes, heldRightVelocity\[index\]\)/);
assert.match(source, /if \(captureArmed\) appendChord\(next\)/);
assert.match(source, /function clearHeldPadIntent[\s\S]*clearHeldCandidates\(state\)/);
```

Also assert that generic `updateCandidatesAndSlots` does not call `revoiceHeldRightPads`, preserving the root-press-only constraint.

- [ ] **Step 2: Run contract tests and verify RED**

Run: `node --test tests/ui_contract.test.mjs`

Expected: FAIL because the runtime revoice and cleanup functions do not exist.

- [ ] **Step 3: Add held velocity and cleanup state**

Import `revoiceHeldCandidates` and `clearHeldCandidates`. Add:

```js
let heldRightVelocity = Array(16).fill(100);

function clearHeldPadIntent() {
  clearHeldCandidates(state);
  heldRightVelocity.fill(100);
}
```

Initialize the array in `init`. On right press, store the clamped incoming velocity; on right release, restore that index to `100`. Replace direct `state.heldCandidates.fill(null)` panic cleanup with `clearHeldPadIntent()`.

- [ ] **Step 4: Implement ordered owner replacement**

Add:

```js
function revoiceHeldRightPads() {
  const replacements = revoiceHeldCandidates(state, state.candidates);
  let announced = false;
  for (const { index, next } of replacements) {
    const owner = 16 + index;
    if (!next) {
      stopVoice(owner);
      continue;
    }
    lastAuditioned = next;
    currentLabel = next.label;
    currentCategory = next.sourceClass;
    playVoice(owner, next.notes, heldRightVelocity[index]);
    showDisplayVoice(owner, {
      notes: next.notes,
      chord: semanticChord(next),
      rootPitchClass: wrap(state.settings.key + next.tonicOffset, 12),
      label: currentLabel,
      category: currentCategory,
    });
    if (captureArmed) appendChord(next);
    announced = true;
  }
  if (announced) announceCurrent();
  queueLedRefresh();
}
```

Call it immediately after `refreshCandidates()` in the pressed branch of `handleLeftPad`. Keep all other candidate refresh paths unchanged.

- [ ] **Step 5: Clear intent across lifecycle and panic paths**

Use `clearHeldPadIntent()` inside `clearVisualVoices`. On first parked tick, after stopping copied `liveOwners`, clear held intent and reset `heldLeft` so resume cannot revoice a physically stale pad. On unload, clear intent after live-owner cleanup. Right release must call `releaseCandidate` even when its current snapshot is null.

- [ ] **Step 6: Run runtime and full JS tests**

Run: `node --test tests/ui_contract.test.mjs tests/ui_state.test.mjs`

Expected: all focused tests pass.

Run: `npm run test:js`

Expected: all JavaScript tests pass with no failures.

- [ ] **Step 7: Commit runtime revoicing**

```bash
git add src/ui.js tests/ui_contract.test.mjs
git commit -m "feat: revoice held chords from played roots"
```

---

### Task 3: User Help, Version, And Release Package

**Files:**
- Modify: `README.md`
- Modify: `src/help.json`
- Modify: `src/module.json`
- Modify: `package.json`
- Modify: `release.json`
- Test: `tests/package/run.sh`

**Interfaces:**
- Consumes: completed runtime behavior from Task 2.
- Produces: synchronized version `0.4.0` and user-facing simultaneous-root instructions.

- [ ] **Step 1: Write a failing help/package assertion**

Extend the help phrase validation in `tests/package/run.sh` to require `held chord` and `new root`, then run:

Run: `npm run test:package`

Expected: FAIL because the current help does not describe root-driven revoicing.

- [ ] **Step 2: Document the gesture and Capture sequence**

Add concise help and README text stating that a player can hold a right chord and press a left note to revoice it, and that Capture appends each audible revoice to the next slot.

- [ ] **Step 3: Bump synchronized release metadata**

Set `package.json`, `src/module.json`, and `release.json` to `0.4.0`; update `release.download_url` to the `v0.4.0` asset URL.

- [ ] **Step 4: Repackage and run package metadata tests**

Run: `./scripts/package.sh`

Run: `npm run test:package`

Expected: archive and metadata/help assertions pass at version `0.4.0`.

- [ ] **Step 5: Commit help and release metadata**

```bash
git add README.md src/help.json src/module.json package.json release.json tests/package/run.sh
git commit -m "docs: explain root-driven chord capture"
```

---

### Task 4: Review, Build, Package, And Install

**Files:**
- Verify only: all files changed in Tasks 1-3
- Generated ignored artifacts: `dist/dsp.so`, `dist/install-swap`, `dist/chord-finder-module.tar.gz`

**Interfaces:**
- Consumes: source version `0.4.0` and package verifier.
- Produces: verified aarch64 Schwung archive installed at `/data/UserData/schwung/modules/tools/chord-finder`.

- [ ] **Step 1: Review the branch diff**

Run: `git diff cf0e2e7...HEAD --check`

Inspect `git diff cf0e2e7...HEAD` for event-order regressions, duplicate Capture writes, stale held intent, and unrelated changes.

- [ ] **Step 2: Run all tests**

Run: `npm test`

Expected: JavaScript, DSP, and package tests pass.

- [ ] **Step 3: Build fresh aarch64 artifacts and package**

Run: `docker run --rm -v "$PWD:/build" chord-finder-build ./scripts/build-dsp.sh`

Run: `./scripts/package.sh`

Expected: both native artifacts report `ARM aarch64`, and package verification reports version `0.4.0` with byte-for-byte source parity.

- [ ] **Step 4: Run final verification**

Run: `npm test`

Run: `./scripts/verify-package.sh`

Run: `file dist/dsp.so dist/install-swap`

Expected: all tests pass, archive verification passes, and both native files are ARM aarch64.

- [ ] **Step 5: Confirm commits and a clean tree**

Run: `git status --short`

Expected: no output. If plan tracking changed during execution, commit only the named plan file before continuing.

- [ ] **Step 6: Install atomically on Move**

Run: `./scripts/install.sh`

Expected: installer reports Chord Finder `0.4.0`. Compare SHA-256 values for the ten packaged runtime files against the remote module directory, confirm schema version 2 and eight progression slots remain, and confirm no `.chord-finder.install.*` directory remains.

- [ ] **Step 7: Reload and hardware-check**

Exit Chord Finder with Shift + Back, reopen it from Schwung Tools, and verify in the Schwung debug log that the new UI and DSP load without an exception. Test both event orders, repeated root changes while holding a chord, Capture slot advancement, release cleanup, and piano-display updates.
