import test from 'node:test';
import assert from 'node:assert/strict';

import {
  BLACK_KEYS,
  WHITE_KEYS,
  clearDisplayVoices,
  createDisplayVoiceState,
  keyboardKeyForPitchClass,
  keyboardState,
  startDisplayVoice,
  stopDisplayVoice,
} from '../src/keyboard.mjs';

test('maps all twelve pitch classes onto a complete one-octave piano', () => {
  assert.deepEqual(WHITE_KEYS.map((key) => key.pitchClass), [0, 2, 4, 5, 7, 9, 11]);
  assert.deepEqual(BLACK_KEYS.map((key) => key.pitchClass), [1, 3, 6, 8, 10]);

  for (let pitchClass = 0; pitchClass < 12; pitchClass += 1) {
    const key = keyboardKeyForPitchClass(pitchClass);
    assert.equal(key.pitchClass, pitchClass);
    assert.ok(key.x >= 0 && key.x + key.width <= 128);
  }
});

test('derives sounding tones, duplicates, bass, top, and root from MIDI notes', () => {
  const state = keyboardState([72, 55, 60, 64, 67, 76], 12);

  assert.deepEqual(state.counts, [2, 0, 0, 0, 2, 0, 0, 2, 0, 0, 0, 0]);
  assert.equal(state.bassPitchClass, 7);
  assert.equal(state.topPitchClass, 4);
  assert.equal(state.rootPitchClass, 0);
  assert.deepEqual(state.soundingPitchClasses, [0, 4, 7]);
});

test('ignores invalid notes and returns an empty visual state safely', () => {
  assert.deepEqual(keyboardState([-1, 128, NaN], null), {
    counts: Array(12).fill(0),
    soundingPitchClasses: [],
    bassPitchClass: null,
    topPitchClass: null,
    rootPitchClass: null,
  });
  assert.equal(keyboardKeyForPitchClass(null), null);
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
