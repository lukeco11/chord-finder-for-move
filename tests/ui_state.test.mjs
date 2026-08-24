import test from 'node:test';
import assert from 'node:assert/strict';

import {
  appendProgressionChord,
  assignProgressionSlot,
  clearHeldCandidates,
  createUiState,
  leftPadIndex,
  migrateSettings,
  nextExplorationMode,
  pressCandidate,
  progressionLength,
  progressionNeighbors,
  PREVIEW_ROUTES,
  revoiceHeldCandidates,
  releaseCandidate,
  rightPadIndex,
  takeLedBatch,
  hostSupportsActiveMoveInject,
} from '../src/ui_state_v6.mjs';

const chord = Object.freeze({
  tonicOffset: 0,
  scaleDegree: 0,
  quality: 'major',
  extensions: [],
  inversion: 0,
  spread: 0,
  sourceClass: 'diatonic',
});

test('maps the physical grid into independent left and right 4x4 indexes', () => {
  assert.equal(leftPadIndex(68), 0);
  assert.equal(leftPadIndex(71), 3);
  assert.equal(leftPadIndex(76), 4);
  assert.equal(leftPadIndex(99), -1);
  assert.equal(rightPadIndex(72), 0);
  assert.equal(rightPadIndex(75), 3);
  assert.equal(rightPadIndex(99), 15);
  assert.equal(rightPadIndex(68), -1);
});

test('candidate release returns the press-time snapshot after candidates refresh', () => {
  const state = createUiState();
  const playable = { ...chord, notes: [60, 64, 67], label: 'C', score: 123 };
  const pressed = pressCandidate(state, 2, playable);
  state.candidates[2] = { ...chord, tonicOffset: 7, quality: 'minor' };
  const released = releaseCandidate(state, 2);

  assert.deepEqual(released, pressed);
  assert.deepEqual(released.notes, [60, 64, 67]);
  assert.equal(released.label, 'C');
  assert.notDeepEqual(released, state.candidates[2]);
});

test('revoices held candidates in physical pad order while preserving intent', () => {
  const state = createUiState();
  pressCandidate(state, 5, { ...chord, notes: [60, 64, 67], label: 'C' });
  pressCandidate(state, 2, { ...chord, notes: [62, 65, 69], label: 'Dm' });
  const candidates = Array(16).fill(null);
  candidates[2] = { ...chord, tonicOffset: 7, notes: [67, 71, 74], label: 'G' };
  candidates[5] = { ...chord, tonicOffset: 9, notes: [69, 72, 76], label: 'Am' };

  const replacements = revoiceHeldCandidates(state, candidates);

  assert.deepEqual(replacements.map(({ index }) => index), [2, 5]);
  assert.deepEqual(replacements[0].previous.notes, [62, 65, 69]);
  assert.deepEqual(replacements[0].next.notes, [67, 71, 74]);
  assert.deepEqual(state.heldCandidates[5].notes, [69, 72, 76]);
  assert.equal(state.heldRight[2], true);
  assert.equal(state.heldRight[5], true);
});

test('missing replacement stops the snapshot but keeps pad intent until release', () => {
  const state = createUiState();
  pressCandidate(state, 3, { ...chord, notes: [60, 64, 67], label: 'C' });

  const [replacement] = revoiceHeldCandidates(state, Array(16).fill(null));

  assert.equal(replacement.index, 3);
  assert.equal(replacement.next, null);
  assert.equal(state.heldCandidates[3], null);
  assert.equal(state.heldRight[3], true);
  assert.equal(releaseCandidate(state, 3), null);
  assert.equal(state.heldRight[3], false);
});

test('clears every held snapshot and physical pad intent after panic cleanup', () => {
  const state = createUiState();
  pressCandidate(state, 1, { ...chord, notes: [60, 64, 67] });
  pressCandidate(state, 8, { ...chord, notes: [62, 65, 69] });

  clearHeldCandidates(state);

  assert.deepEqual(state.heldCandidates, Array(16).fill(null));
  assert.deepEqual(state.heldRight, Array(16).fill(false));
});

test('assigns and appends without overwriting a full progression', () => {
  const state = createUiState();
  assignProgressionSlot(state, 7, chord);
  assert.deepEqual(state.progression[7], chord);

  for (let i = 0; i < 7; i += 1) {
    assert.equal(appendProgressionChord(state, { ...chord, tonicOffset: i % 12 }), i);
  }
  const before = structuredClone(state.progression);
  assert.equal(appendProgressionChord(state, { ...chord, tonicOffset: 11 }), -1);
  assert.deepEqual(state.progression, before);
  assert.equal(state.captureIndex, 7);
  assert.equal(progressionLength(state.progression), 8);

  assignProgressionSlot(state, 0, null);
  assert.equal(state.progression[0], null);
  assert.equal(appendProgressionChord(state, { ...chord, tonicOffset: 11 }), 0);
});

test('migrates incomplete settings into the versioned persisted shape', () => {
  const settings = migrateSettings({
    key: 14,
    route: 'invalid',
    mode: 'invalid',
    octave: 'not-a-number',
    progression: [chord],
  });
  assert.equal(settings.schemaVersion, 2);
  assert.equal(settings.key, 2);
  assert.equal(settings.route, 'move');
  assert.equal(settings.mode, 'root');
  assert.equal(settings.octave, 0);
  assert.equal(settings.progression.length, 8);
  assert.deepEqual(settings.progression[0], chord);
  assert.equal(settings.gate, 85);
});

test('allows Schwung only as a live preview route', () => {
  assert.deepEqual(PREVIEW_ROUTES, ['move', 'external', 'both', 'schwung']);
  assert.equal(migrateSettings({ route: 'schwung' }).route, 'move');
  assert.equal(migrateSettings({ previewRoute: 'schwung' }).previewRoute, 'schwung');
});

test('keeps Move output on 0.11.6 while gating unpatched 0.12 hosts', () => {
  const host = (version, dedicated = false) => ({
    shadow_inbound_pad_midi_active() {},
    host_read_file(path) {
      assert.equal(path, '/data/UserData/schwung/host/version.txt');
      return version;
    },
    ...(dedicated ? { shadow_overtake_move_inject_active() {} } : {}),
  });

  assert.equal(hostSupportsActiveMoveInject({}), true);
  assert.equal(hostSupportsActiveMoveInject(host('0.11.6\n')), true);
  assert.equal(hostSupportsActiveMoveInject(host('0.12.0')), false);
  assert.equal(hostSupportsActiveMoveInject(host('0.12.1\n')), false);
  assert.equal(hostSupportsActiveMoveInject(host('0.12.1', true)), true);
});

test('cycles explicit root, next, and voice exploration modes', () => {
  assert.equal(nextExplorationMode('root'), 'next');
  assert.equal(nextExplorationMode('next'), 'voice');
  assert.equal(nextExplorationMode('voice'), 'root');
  assert.equal(nextExplorationMode('unknown'), 'root');
});

test('finds the nearest populated chords around a selected progression slot', () => {
  const progression = Array(8).fill(null);
  progression[1] = { ...chord, tonicOffset: 2, scaleDegree: 1, quality: 'minor' };
  progression[5] = { ...chord, tonicOffset: 7, scaleDegree: 4 };

  assert.deepEqual(progressionNeighbors(progression, 3), {
    previousChord: progression[1],
    nextChord: progression[5],
  });
  assert.deepEqual(progressionNeighbors(progression, 0), {
    previousChord: null,
    nextChord: progression[1],
  });
  assert.deepEqual(progressionNeighbors(progression, -1), {
    previousChord: null,
    nextChord: null,
  });
});

test('drains no more than eight LED updates per tick', () => {
  const queue = Array.from({ length: 20 }, (_, id) => ({ id, color: 1 }));
  assert.equal(takeLedBatch(queue).length, 8);
  assert.equal(queue.length, 12);
  assert.equal(takeLedBatch(queue).length, 8);
  assert.equal(takeLedBatch(queue).length, 4);
});
