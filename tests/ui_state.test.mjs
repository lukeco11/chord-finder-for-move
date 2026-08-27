import test from 'node:test';
import assert from 'node:assert/strict';

import {
  appendProgressionChord,
  assignProgressionSlot,
  clearHeldCandidates,
  createUiState,
  encoderDetent,
  ENCODER_DETENT_GEAR,
  formatImpressiveChordsFile,
  formatImpressiveChordsJson,
  formatMidiFile,
  latestHeldCandidate,
  leftPadIndex,
  midiWriteCommand,
  migrateSettings,
  nextExplorationMode,
  packedProgressionChords,
  pressCandidate,
  progressionLength,
  progressionNeighbors,
  PREVIEW_ROUTES,
  ROUTES,
  resolveStepPress,
  revoiceHeldCandidates,
  releaseCandidate,
  rightPadIndex,
  takeLedBatch,
  hostSupportsActiveMoveInject,
} from '../src/ui_state_v8.mjs';

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
  assert.deepEqual(state.heldRightOrder, []);
});

test('prefers the most recently pressed held right pad as the store snapshot', () => {
  const state = createUiState();
  const older = { ...chord, notes: [60, 64, 67], label: 'C', quality: 'major' };
  const newer = { ...chord, tonicOffset: 7, notes: [67, 71, 74], label: 'G', quality: 'major' };
  pressCandidate(state, 2, older);
  pressCandidate(state, 5, newer);

  assert.equal(latestHeldCandidate(state).label, 'G');
  assert.deepEqual(latestHeldCandidate(state).notes, [67, 71, 74]);

  releaseCandidate(state, 5);
  assert.equal(latestHeldCandidate(state).label, 'C');
});

test('stores the press-time snapshot even after live candidates refresh', () => {
  const state = createUiState();
  const played = { ...chord, notes: [60, 64, 67], label: 'C', score: 9 };
  pressCandidate(state, 4, played);
  state.candidates[4] = { ...chord, tonicOffset: 9, notes: [69, 72, 76], label: 'Am' };

  const decision = resolveStepPress(state, { slotIndex: 0 });

  assert.equal(decision.action, 'store');
  assert.deepEqual(decision.chord.notes, [60, 64, 67]);
  assert.equal(decision.chord.label, 'C');
  assert.notEqual(decision.chord, state.candidates[4]);
});

test('hold-right then step stores into empty and populated slots like Shift+Step', () => {
  const state = createUiState();
  const held = { ...chord, notes: [60, 64, 67], label: 'C' };
  const last = { ...chord, tonicOffset: 2, notes: [62, 65, 69], label: 'Dm' };
  pressCandidate(state, 1, held);
  assignProgressionSlot(state, 3, { ...chord, tonicOffset: 7, quality: 'major' });

  assert.equal(resolveStepPress(state, { slotIndex: 0 }).action, 'store');
  assert.equal(resolveStepPress(state, { slotIndex: 0 }).chord.label, 'C');
  assert.equal(resolveStepPress(state, { slotIndex: 3 }).action, 'store');
  assert.equal(resolveStepPress(state, { slotIndex: 3 }).chord.label, 'C');

  const shiftEmpty = resolveStepPress(state, { slotIndex: 0, shiftHeld: true, lastAuditioned: last });
  const shiftPopulated = resolveStepPress(state, { slotIndex: 3, shiftHeld: true, lastAuditioned: last });
  assert.equal(shiftEmpty.action, 'store');
  assert.equal(shiftEmpty.chord.label, 'C');
  assert.equal(shiftPopulated.action, 'store');
  assert.equal(shiftPopulated.chord.label, 'C');
});

test('Shift+Step stores the last auditioned chord when no right pad is held', () => {
  const state = createUiState();
  const last = { ...chord, notes: [65, 69, 72], label: 'F' };

  const stored = resolveStepPress(state, { slotIndex: 2, shiftHeld: true, lastAuditioned: last });
  assert.equal(stored.action, 'store');
  assert.equal(stored.chord, last);

  const missing = resolveStepPress(state, { slotIndex: 2, shiftHeld: true });
  assert.equal(missing.action, 'need-audition');
});

test('step without a held right pad still previews or gap-fills', () => {
  const state = createUiState();
  assignProgressionSlot(state, 1, chord);

  const preview = resolveStepPress(state, { slotIndex: 1, lastAuditioned: { ...chord, label: 'ignored' } });
  assert.equal(preview.action, 'preview');
  assert.equal(preview.chord.tonicOffset, 0);
  assert.equal('notes' in preview.chord, false);

  const gap = resolveStepPress(state, { slotIndex: 2 });
  assert.equal(gap.action, 'gap-fill');
});

test('Delete+Step clears even while a right pad is held', () => {
  const state = createUiState();
  pressCandidate(state, 0, { ...chord, notes: [60, 64, 67], label: 'C' });
  assignProgressionSlot(state, 4, chord);

  const held = resolveStepPress(state, { slotIndex: 4, deleteHeld: true });
  const empty = resolveStepPress(state, { slotIndex: 0, deleteHeld: true, shiftHeld: true });
  assert.equal(held.action, 'clear');
  assert.equal(empty.action, 'clear');
});

test('left-pad revoice updates the held snapshot without storing a slot', () => {
  const state = createUiState();
  pressCandidate(state, 2, { ...chord, notes: [60, 64, 67], label: 'C' });
  const candidates = Array(16).fill(null);
  candidates[2] = { ...chord, tonicOffset: 7, notes: [67, 71, 74], label: 'G' };

  revoiceHeldCandidates(state, candidates);
  const decision = resolveStepPress(state, { slotIndex: 0 });

  assert.deepEqual(state.progression, Array(8).fill(null));
  assert.equal(decision.action, 'store');
  assert.deepEqual(decision.chord.notes, [67, 71, 74]);
  assert.equal(decision.chord.label, 'G');
});

test('a silent held pad does not store and falls back to an earlier sounding chord', () => {
  const state = createUiState();
  pressCandidate(state, 2, { ...chord, notes: [60, 64, 67], label: 'C' });
  pressCandidate(state, 5, { ...chord, tonicOffset: 7, notes: [67, 71, 74], label: 'G' });
  const candidates = Array(16).fill(null);
  candidates[2] = { ...chord, notes: [60, 64, 67], label: 'C' };

  revoiceHeldCandidates(state, candidates);

  assert.equal(state.heldRight[5], true);
  assert.equal(state.heldCandidates[5], null);
  assert.equal(latestHeldCandidate(state).label, 'C');
  assert.equal(resolveStepPress(state, { slotIndex: 0 }).chord.label, 'C');

  revoiceHeldCandidates(state, Array(16).fill(null));
  assert.equal(latestHeldCandidate(state), null);
  assert.equal(resolveStepPress(state, { slotIndex: 0 }).action, 'ignore');
  assert.equal(resolveStepPress(state, { slotIndex: 1, lastAuditioned: chord }).action, 'ignore');
});

test('stored slots keep semantic chord data rather than frozen MIDI notes', () => {
  const state = createUiState();
  const snapshot = pressCandidate(state, 3, {
    ...chord,
    notes: [60, 64, 67],
    label: 'C',
    score: 12,
    registerShift: 1,
  });
  const decision = resolveStepPress(state, { slotIndex: 6 });
  assignProgressionSlot(state, 6, decision.chord);

  assert.equal(decision.chord, snapshot);
  assert.deepEqual(state.progression[6], {
    tonicOffset: 0,
    scaleDegree: 0,
    quality: 'major',
    extensions: [],
    inversion: 0,
    spread: 0,
    sourceClass: 'diatonic',
    registerShift: 1,
  });
  assert.equal('notes' in state.progression[6], false);
  assert.equal('label' in state.progression[6], false);
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

test('allows Schwung as both a progression and live preview route', () => {
  assert.deepEqual(ROUTES, ['move', 'external', 'both', 'schwung']);
  assert.deepEqual(PREVIEW_ROUTES, ['move', 'external', 'both', 'schwung']);
  assert.equal(migrateSettings({ route: 'schwung' }).route, 'schwung');
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

test('encoder detents require two ticks before a parameter steps', () => {
  assert.equal(ENCODER_DETENT_GEAR, 2);
  assert.deepEqual(encoderDetent(0, 1), { accumulator: 1, step: 0 });
  assert.deepEqual(encoderDetent(1, 1), { accumulator: 0, step: 1 });
  assert.deepEqual(encoderDetent(0, -1), { accumulator: -1, step: 0 });
  assert.deepEqual(encoderDetent(-1, -1), { accumulator: 0, step: -1 });
  assert.deepEqual(encoderDetent(0, 0), { accumulator: 0, step: 0 });
});

test('packs populated progression slots into an Impressive Chords preset file', () => {
  const progression = Array(8).fill(null);
  progression[1] = { ...chord, tonicOffset: 0 };
  progression[4] = { ...chord, tonicOffset: 7 };
  const packed = packedProgressionChords(progression, (item) => (
    item.tonicOffset === 0 ? [60, 64, 67] : [67, 71, 74]
  ));

  assert.deepEqual(packed, [
    { index: 0, notes: [60, 64, 67] },
    { index: 1, notes: [67, 71, 74] },
  ]);
  assert.equal(
    formatImpressiveChordsFile('Chord Finder C Major', packed),
    'Name: Chord Finder C Major\n0: 60,64,67\n1: 67,71,74\n',
  );
  assert.equal(
    JSON.parse(formatImpressiveChordsJson(packed))['0'].join(','),
    '60,64,67',
  );
});

test('MIDI export writes a type 0 file with one event block per packed chord', () => {
  const packed = [
    { index: 0, notes: [60, 64, 67] },
    { index: 1, notes: [65, 69, 72] },
  ];
  const bytes = formatMidiFile(packed, { ticksPerBeat: 96, beatsPerChord: 1, gate: 50 });
  const ascii = (start, end) => String.fromCharCode(...bytes.slice(start, end));

  assert.equal(ascii(0, 4), 'MThd');
  assert.equal(ascii(14, 18), 'MTrk');
  assert.equal(bytes[8], 0x00);
  assert.equal(bytes[9], 0x00);
  assert.equal(bytes.includes(0x90), true);
  assert.equal(bytes.includes(60), true);
  assert.equal(bytes.includes(65), true);
  assert.equal(bytes[bytes.length - 3], 0xff);
  assert.equal(bytes[bytes.length - 2], 0x2f);
  assert.equal(bytes[bytes.length - 1], 0x00);
});

test('MIDI write command carries exact bytes through allowlisted sh printf', () => {
  const bytes = Uint8Array.from([0x4d, 0x54, 0x68, 0x64, 0x00, 0x01, 0x90, 0x3c, 0xff]);
  const command = midiWriteCommand('/data/UserData/schwung/modules/tools/chord-finder/exports/chord_finder.mid', bytes);

  assert.equal(command.startsWith('sh -c "printf \''), true);
  assert.equal(
    command.endsWith(' > /data/UserData/schwung/modules/tools/chord-finder/exports/chord_finder.mid"'),
    true,
  );

  const format = command.match(/printf '((?:\\[0-7]{3})+)'/)?.[1];
  assert.ok(format, 'printf format must be made only of 3-digit octal escapes');
  const decoded = format.match(/\\[0-7]{3}/g).map((escape) => parseInt(escape.slice(1), 8));
  assert.deepEqual(decoded, [...bytes]);
});
