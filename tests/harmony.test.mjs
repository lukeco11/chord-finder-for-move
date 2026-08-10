import test from 'node:test';
import assert from 'node:assert/strict';

import {
  SCALES,
  buildChordNotes,
  generateCandidates,
  getScalePitchClasses,
  leftPadNote,
  nameChord,
} from '../src/harmony.mjs';

test('supports the agreed core tonal scale set', () => {
  const ids = new Set(SCALES.map((scale) => scale.id));
  for (const id of [
    'major', 'natural_minor', 'harmonic_minor', 'melodic_minor',
    'dorian', 'phrygian', 'lydian', 'mixolydian', 'aeolian',
    'locrian', 'major_pentatonic', 'minor_pentatonic',
  ]) {
    assert.ok(ids.has(id), `missing scale ${id}`);
  }
});

test('strict candidates stay inside every supported scale', () => {
  for (const scale of SCALES) {
    for (let key = 0; key < 12; key += 1) {
      const allowed = new Set(getScalePitchClasses(key, scale.id));
      for (const octave of [-3, 3]) {
        const candidates = generateCandidates({
          key,
          scaleId: scale.id,
          colorDepth: 0,
          octave,
        });

        assert.equal(candidates.length, 16, `${key}:${scale.id}:${octave} candidate count`);
        for (const candidate of candidates) {
          assert.equal(candidate.sourceClass, 'diatonic');
          for (const note of candidate.notes) {
            assert.ok(note >= 0 && note <= 127, `${key}:${scale.id} emitted out-of-range ${note}`);
            assert.ok(allowed.has(note % 12), `${key}:${scale.id} emitted ${note}`);
          }
        }
      }
    }
  }
});

test('blend mode includes marked color chords but keeps diatonic candidates first', () => {
  const candidates = generateCandidates({
    key: 0,
    scaleId: 'major',
    colorDepth: 1,
    currentChord: {
      tonicOffset: 0,
      scaleDegree: 0,
      quality: 'major',
      extensions: [],
      inversion: 0,
      spread: 0,
      sourceClass: 'diatonic',
    },
  });

  assert.equal(candidates.length, 16);
  assert.ok(candidates.slice(0, 8).some((chord) => chord.sourceClass === 'diatonic'));
  assert.ok(candidates.some((chord) => chord.sourceClass !== 'diatonic'));
});

test('both blend depths always fill the sixteen-pad candidate grid', () => {
  for (const colorDepth of [1, 2]) {
    const candidates = generateCandidates({
      key: 9,
      scaleId: 'harmonic_minor',
      colorDepth,
      extensionBias: 2,
      inversionBias: 2,
      spread: 1,
    });
    assert.equal(candidates.length, 16);
    assert.ok(candidates.some((chord) => chord.sourceClass !== 'diatonic'));
  }
});

test('focused root constrains all candidates while retaining varied chord types', () => {
  const candidates = generateCandidates({
    key: 2,
    scaleId: 'dorian',
    focusPc: 7,
    colorDepth: 1,
  });

  assert.equal(candidates.length, 16);
  assert.ok(candidates.every((chord) => (2 + chord.tonicOffset) % 12 === 7));
  assert.ok(new Set(candidates.map((chord) => `${chord.quality}:${chord.extensions.join('.')}:${chord.inversion}:${chord.spread}`)).size >= 10);
});

test('semantic chords transpose with the key and remain in MIDI range', () => {
  const chord = {
    tonicOffset: 7,
    scaleDegree: 4,
    quality: 'major',
    extensions: ['7'],
    inversion: 1,
    spread: 1,
    sourceClass: 'diatonic',
  };
  const cNotes = buildChordNotes(chord, { key: 0, octave: 0 });
  const dNotes = buildChordNotes(chord, { key: 2, octave: 0 });

  assert.deepEqual(dNotes, cNotes.map((note) => note + 2));
  assert.ok(cNotes.length <= 6);
  assert.ok(cNotes.every((note) => note >= 0 && note <= 127));
});

test('candidate ordering is deterministic and common dominant motion is represented', () => {
  const input = {
    key: 0,
    scaleId: 'major',
    colorDepth: 1,
    currentChord: {
      tonicOffset: 0,
      scaleDegree: 0,
      quality: 'major',
      extensions: [],
      inversion: 0,
      spread: 0,
      sourceClass: 'diatonic',
    },
  };
  const first = generateCandidates(input);
  const second = generateCandidates(input);

  assert.deepEqual(second, first);
  assert.ok(first.some((chord) => chord.scaleDegree === 4));
});

test('functional ranking resolves a dominant chord toward the tonic', () => {
  const candidates = generateCandidates({
    key: 0,
    scaleId: 'major',
    colorDepth: 1,
    currentChord: {
      tonicOffset: 7,
      scaleDegree: 4,
      quality: 'major',
      extensions: ['7'],
      inversion: 0,
      spread: 0,
      sourceClass: 'diatonic',
    },
  });
  assert.equal(candidates[0].scaleDegree, 0);
});

test('left pad notes walk through the selected scale and chord names respect flat keys', () => {
  const notes = Array.from({ length: 16 }, (_, index) => leftPadNote({
    key: 10,
    scaleId: 'major',
    octave: 0,
    index,
  }));
  assert.ok(notes.every((note, index) => index === 0 || note > notes[index - 1]));

  const label = nameChord({
    tonicOffset: 0,
    scaleDegree: 0,
    quality: 'major',
    extensions: ['7'],
    inversion: 0,
    spread: 0,
    sourceClass: 'diatonic',
  }, 10);
  assert.equal(label, 'Bb7');
  assert.equal(nameChord({
    tonicOffset: 0,
    scaleDegree: 0,
    quality: 'minor',
    extensions: [],
    inversion: 0,
    spread: 0,
    sourceClass: 'diatonic',
  }, 0), 'Cm');
});

test('ninth families retain their defining sevenths while add9 does not', () => {
  const notes = (quality, extensions) => buildChordNotes({
    tonicOffset: 0,
    scaleDegree: 0,
    quality,
    extensions,
    inversion: 0,
    spread: 0,
    sourceClass: 'diatonic',
  }, { key: 0 }).map((note) => note % 12);

  assert.deepEqual(notes('major', ['add9']), [0, 4, 7, 2]);
  assert.deepEqual(notes('major', ['9']), [0, 4, 7, 10, 2]);
  assert.deepEqual(notes('major', ['maj9']), [0, 4, 7, 11, 2]);
  assert.deepEqual(notes('minor', ['9']), [0, 3, 7, 10, 2]);
  assert.equal(nameChord({ tonicOffset: 0, quality: 'major', extensions: ['maj9'] }, 0), 'Cmaj9');
  assert.equal(nameChord({ tonicOffset: 0, quality: 'minor', extensions: ['9'] }, 0), 'Cm9');
});

test('half-diminished and fully diminished sevenths have distinct intervals and labels', () => {
  const halfDiminished = { tonicOffset: 0, quality: 'm7b5', extensions: [] };
  const diminished = { tonicOffset: 0, quality: 'dim7', extensions: [] };

  assert.deepEqual(buildChordNotes(halfDiminished, { key: 0 }).map((note) => note % 12), [0, 3, 6, 10]);
  assert.deepEqual(buildChordNotes(diminished, { key: 0 }).map((note) => note % 12), [0, 3, 6, 9]);
  assert.equal(nameChord(halfDiminished, 0), 'Cm7b5');
  assert.equal(nameChord(diminished, 0), 'Cdim7');
});

test('chord labels spell the actual inversion bass and respect minor scale spelling', () => {
  const inverted = {
    tonicOffset: 0,
    quality: 'minor',
    extensions: ['7'],
    inversion: 1,
    spread: 0,
  };
  assert.equal(nameChord(inverted, 0, 'natural_minor'), 'Cm7/Eb');
  assert.equal(nameChord({ tonicOffset: 3, quality: 'major', extensions: [] }, 0, 'natural_minor'), 'Eb');
});

test('explicit root mode stays on one root, honors strict color, and responds to material biases', () => {
  const base = {
    mode: 'root', key: 0, scaleId: 'major', focusPc: 0, colorDepth: 0,
  };
  const plain = generateCandidates({ ...base, extensionBias: 0, inversionBias: 0, spread: 0 });
  const colorful = generateCandidates({ ...base, extensionBias: 2, inversionBias: 2, spread: 2 });
  const allowed = new Set(getScalePitchClasses(0, 'major'));

  assert.equal(plain.length, 16);
  assert.equal(colorful.length, 16);
  assert.ok(plain.every((chord) => chord.tonicOffset === 0 && chord.sourceClass === 'diatonic'));
  assert.ok(plain.every((chord) => chord.notes.every((note) => allowed.has(note % 12))));
  assert.notDeepEqual(
    colorful.map((chord) => [chord.quality, chord.extensions, chord.inversion, chord.spread]),
    plain.map((chord) => [chord.quality, chord.extensions, chord.inversion, chord.spread]),
  );
  assert.ok(colorful.slice(0, 4).some((chord) => chord.extensions.length > 0));
  assert.ok(colorful.slice(0, 4).some((chord) => chord.inversion > 0 || chord.spread > 0));
});

test('next mode generates functional color chords and deduplicates pitch class plus voicing', () => {
  const candidates = generateCandidates({
    mode: 'next',
    key: 0,
    scaleId: 'dorian',
    colorDepth: 2,
    currentChord: { tonicOffset: 0, scaleDegree: 0, quality: 'minor', extensions: [], inversion: 0, spread: 0 },
  });
  const signatures = candidates.map((chord) => {
    const pitchClasses = [...new Set(chord.notes.map((note) => note % 12))].sort((a, b) => a - b);
    return `${pitchClasses.join('.')}:${chord.notes.join('.')}`;
  });

  assert.equal(candidates.length, 16);
  assert.equal(new Set(signatures).size, 16);
  assert.ok(candidates.some((chord) => chord.sourceClass === 'secondary'));
  assert.ok(candidates.some((chord) => chord.sourceClass === 'borrowed'));
});

test('secondary dominants are rooted a fifth above their target', () => {
  const candidates = generateCandidates({
    mode: 'next', key: 0, scaleId: 'major', colorDepth: 2,
  });
  const scaleIntervals = [0, 2, 4, 5, 7, 9, 11];
  const secondary = candidates.filter((chord) => chord.sourceClass === 'secondary');
  assert.ok(secondary.length > 0);
  for (const chord of secondary) {
    assert.equal(chord.tonicOffset, (scaleIntervals[chord.targetDegree] + 7) % 12);
  }
});

test('next mode uses actual current MIDI notes when choosing candidate register', () => {
  const settings = {
    mode: 'next', key: 0, scaleId: 'major', colorDepth: 0,
    currentChord: { tonicOffset: 7, scaleDegree: 4, quality: 'major', extensions: ['7'], inversion: 0, spread: 0 },
  };
  const low = generateCandidates({ ...settings, currentNotes: [36, 40, 43, 46] });
  const high = generateCandidates({ ...settings, currentNotes: [72, 76, 79, 82] });

  assert.ok(Math.max(...high[0].notes) > Math.max(...low[0].notes));
  assert.equal(high[0].scaleDegree, 0);
});

test('voice mode changes only voicing and inversion of the selected harmony', () => {
  const selectedChord = {
    tonicOffset: 2,
    scaleDegree: 1,
    quality: 'minor',
    extensions: ['9'],
    inversion: 0,
    spread: 0,
    sourceClass: 'diatonic',
  };
  const candidates = generateCandidates({
    mode: 'voice', key: 0, scaleId: 'major', selectedChord,
  });

  assert.ok(candidates.length > 1 && candidates.length <= 16);
  assert.ok(candidates.every((chord) => (
    chord.tonicOffset === selectedChord.tonicOffset
      && chord.quality === selectedChord.quality
      && chord.extensions.join('.') === selectedChord.extensions.join('.')
  )));
  assert.ok(new Set(candidates.map((chord) => chord.notes.join('.'))).size > 1);
});

test('top-note constraints produce a full deterministic grid with the requested pitch class', () => {
  const settings = {
    mode: 'next', key: 0, scaleId: 'major', colorDepth: 1, topNotePc: 7,
  };
  const first = generateCandidates(settings);
  const second = generateCandidates(settings);

  assert.equal(first.length, 16);
  assert.deepEqual(second, first);
  assert.ok(first.every((chord) => chord.notes.at(-1) % 12 === 7));
});

test('root-mode top-note constraints return only matching playable chords', () => {
  const candidates = generateCandidates({
    mode: 'root', key: 0, scaleId: 'major', colorDepth: 1, focusPc: 0, topNotePc: 2,
  });

  assert.ok(candidates.length > 0);
  assert.ok(candidates.every((chord) => chord.notes.at(-1) % 12 === 2));
  assert.equal(generateCandidates({
    mode: 'root', key: 0, scaleId: 'major', colorDepth: 1, focusPc: 0, topNotePc: 1,
  }).length, 0);
});

test('pentatonic strict emits named contained shapes and blend marks outside pitches', () => {
  const strict = generateCandidates({
    mode: 'next', key: 0, scaleId: 'minor_pentatonic', colorDepth: 0,
  });
  const blend = generateCandidates({
    mode: 'next', key: 0, scaleId: 'minor_pentatonic', colorDepth: 1,
  });
  const allowed = new Set(getScalePitchClasses(0, 'minor_pentatonic'));

  assert.equal(strict.length, 16);
  assert.ok(strict.every((chord) => chord.quality !== 'custom'));
  assert.ok(strict.every((chord) => chord.notes.every((note) => allowed.has(note % 12))));
  assert.ok(blend.some((chord) => chord.sourceClass !== 'diatonic' && chord.outsidePitchClasses.length > 0));
});

test('gap suggestions reward motion from the previous chord into the following chord', () => {
  const previousChord = {
    tonicOffset: 2, scaleDegree: 1, quality: 'minor', extensions: ['7'], inversion: 0, spread: 0,
  };
  const nextChord = {
    tonicOffset: 0, scaleDegree: 0, quality: 'major', extensions: [], inversion: 0, spread: 0,
  };
  const base = {
    mode: 'next', key: 0, scaleId: 'major', colorDepth: 1,
    currentChord: previousChord, previousChord,
  };
  const withoutFollowing = generateCandidates(base);
  const candidates = generateCandidates({ ...base, nextChord });
  const bestDominantScore = (list) => Math.max(
    ...list.filter((candidate) => candidate.scaleDegree === 4).map((candidate) => candidate.score),
  );

  assert.equal(candidates[0].scaleDegree, 4);
  assert.ok(bestDominantScore(candidates) > bestDominantScore(withoutFollowing) + 30);
});

test('recently committed harmonic identities receive a repetition penalty', () => {
  const settings = {
    mode: 'next', key: 0, scaleId: 'major', colorDepth: 1,
    currentChord: { tonicOffset: 0, scaleDegree: 0, quality: 'major', extensions: [], inversion: 0, spread: 0 },
  };
  const baseline = generateCandidates(settings);
  const repeated = baseline[0];
  const withHistory = generateCandidates({ ...settings, recentChords: [repeated] });
  const sameIdentity = (candidate) => (
    candidate.tonicOffset === repeated.tonicOffset
      && candidate.quality === repeated.quality
      && candidate.extensions.join('.') === repeated.extensions.join('.')
  );
  const previousScore = Math.max(...baseline.filter(sameIdentity).map((candidate) => candidate.score));
  const penalizedScore = Math.max(...withHistory.filter(sameIdentity).map((candidate) => candidate.score));

  assert.ok(penalizedScore < previousScore - 20);
});
