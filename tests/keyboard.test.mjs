import test from 'node:test';
import assert from 'node:assert/strict';

import {
  clearDisplayVoices,
  createDisplayVoiceState,
  keyboardState,
  startDisplayVoice,
  stopDisplayVoice,
} from '../src/keyboard_v2.mjs';

test('lays out a C-aligned two-octave keyboard using actual MIDI notes', () => {
  const state = keyboardState([60, 64, 67, 72, 76], 0, 60);

  assert.equal(state.startNote, 60);
  assert.equal(state.endNote, 83);
  assert.equal(state.whiteKeys.length, 14);
  assert.equal(state.blackKeys.length, 10);
  assert.deepEqual(
    state.keys.filter((key) => key.sounding).map((key) => key.note),
    [60, 64, 67, 72, 76],
  );
  assert.equal(state.keys.find((key) => key.note === 60).octaveLabel, 'C4');
  assert.equal(state.keys.find((key) => key.note === 72).octaveLabel, 'C5');
  for (const key of state.keys) assert.ok(key.x >= 0 && key.x + key.width <= 128);
});

test('counts sounding notes outside the two-octave window', () => {
  const state = keyboardState([36, 60, 64, 67, 84, 88], 0, 60);

  assert.equal(state.startNote, 60);
  assert.equal(state.overflowBelow, 1);
  assert.equal(state.overflowAbove, 2);
  assert.deepEqual(state.visibleNotes, [60, 64, 67]);
  assert.equal(state.bassNote, 36);
  assert.equal(state.topNote, 88);
  assert.equal(state.rootPitchClass, 0);
});

test('uses the fallback register and ignores invalid MIDI notes', () => {
  const state = keyboardState([-1, 128, NaN], null, 73);

  assert.equal(state.startNote, 72);
  assert.equal(state.endNote, 95);
  assert.deepEqual(state.visibleNotes, []);
  assert.equal(state.overflowBelow, 0);
  assert.equal(state.overflowAbove, 0);
  assert.equal(state.bassNote, null);
  assert.equal(state.topNote, null);
});

test('display voices combine sounding notes and fall back in press order', () => {
  const voices = createDisplayVoiceState();
  const first = startDisplayVoice(voices, 'left-0', {
    notes: [60], rootPitchClass: 0, label: 'Root C', category: 'ROOT VOICINGS',
  });
  assert.deepEqual(first.notes, [60]);
  assert.equal(first.rootPitchClass, 0);

  const second = startDisplayVoice(voices, 'chord-0', {
    notes: [62, 65, 69], rootPitchClass: 2, label: 'Dm', category: 'DIATONIC',
  });
  assert.deepEqual(second.notes, [60, 62, 65, 69]);
  assert.equal(second.label, 'Dm');
  assert.equal(second.rootPitchClass, 2);

  const fallback = stopDisplayVoice(voices, 'chord-0');
  assert.deepEqual(fallback.notes, [60]);
  assert.equal(fallback.label, 'Root C');
  assert.equal(fallback.rootPitchClass, 0);

  const empty = stopDisplayVoice(voices, 'left-0');
  assert.deepEqual(empty.notes, []);
  assert.equal(empty.active, false);
  assert.equal(empty.rootPitchClass, null);
});

test('display voice metadata stays at its press-time root until replacement', () => {
  const voices = createDisplayVoiceState();
  startDisplayVoice(voices, 16, {
    notes: [61, 65, 68], rootPitchClass: 1, label: 'Db', category: 'DIATONIC',
  });
  const latest = startDisplayVoice(voices, 17, {
    notes: [64], rootPitchClass: 4, label: 'Root E', category: 'ROOT VOICINGS',
  });
  assert.deepEqual(latest.notes, [61, 64, 65, 68]);
  assert.equal(latest.rootPitchClass, 4);

  const original = stopDisplayVoice(voices, 17);
  assert.deepEqual(original.notes, [61, 65, 68]);
  assert.equal(original.rootPitchClass, 1);
});

test('clearing display voices removes every sounding owner after a DSP panic', () => {
  const voices = createDisplayVoiceState();
  startDisplayVoice(voices, 0, { notes: [60], rootPitchClass: 0 });
  startDisplayVoice(voices, 16, { notes: [64, 67], rootPitchClass: 4 });

  const cleared = clearDisplayVoices(voices);
  assert.equal(cleared.active, false);
  assert.deepEqual(cleared.notes, []);
  assert.equal(voices.voices.size, 0);
});
