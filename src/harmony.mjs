const mod = (value, divisor) => ((value % divisor) + divisor) % divisor;

export const SCALES = Object.freeze([
  { id: 'major', name: 'Major', intervals: [0, 2, 4, 5, 7, 9, 11] },
  { id: 'natural_minor', name: 'Natural Minor', intervals: [0, 2, 3, 5, 7, 8, 10] },
  { id: 'harmonic_minor', name: 'Harmonic Minor', intervals: [0, 2, 3, 5, 7, 8, 11] },
  { id: 'melodic_minor', name: 'Melodic Minor', intervals: [0, 2, 3, 5, 7, 9, 11] },
  { id: 'dorian', name: 'Dorian', intervals: [0, 2, 3, 5, 7, 9, 10] },
  { id: 'phrygian', name: 'Phrygian', intervals: [0, 1, 3, 5, 7, 8, 10] },
  { id: 'lydian', name: 'Lydian', intervals: [0, 2, 4, 6, 7, 9, 11] },
  { id: 'mixolydian', name: 'Mixolydian', intervals: [0, 2, 4, 5, 7, 9, 10] },
  { id: 'aeolian', name: 'Aeolian', intervals: [0, 2, 3, 5, 7, 8, 10] },
  { id: 'locrian', name: 'Locrian', intervals: [0, 1, 3, 5, 6, 8, 10] },
  { id: 'major_pentatonic', name: 'Major Pent', intervals: [0, 2, 4, 7, 9] },
  { id: 'minor_pentatonic', name: 'Minor Pent', intervals: [0, 3, 5, 7, 10] },
]);

const QUALITY_INTERVALS = Object.freeze({
  major: [0, 4, 7],
  minor: [0, 3, 7],
  diminished: [0, 3, 6],
  augmented: [0, 4, 8],
  sus2: [0, 2, 7],
  sus4: [0, 5, 7],
  power: [0, 7],
  m7b5: [0, 3, 6, 10],
  half_diminished: [0, 3, 6, 10],
  dim7: [0, 3, 6, 9],
});

const FAMILY_DEFINITIONS = Object.freeze([
  { quality: 'major', extensions: [] },
  { quality: 'minor', extensions: [] },
  { quality: 'sus2', extensions: [] },
  { quality: 'sus4', extensions: [] },
  { quality: 'power', extensions: [] },
  { quality: 'major', extensions: ['maj7'] },
  { quality: 'minor', extensions: ['7'] },
  { quality: 'major', extensions: ['7'] },
  { quality: 'major', extensions: ['add9'] },
  { quality: 'minor', extensions: ['add9'] },
  { quality: 'major', extensions: ['6'] },
  { quality: 'minor', extensions: ['6'] },
  { quality: 'major', extensions: ['maj9'] },
  { quality: 'major', extensions: ['9'] },
  { quality: 'minor', extensions: ['9'] },
  { quality: 'm7b5', extensions: [] },
  { quality: 'dim7', extensions: [] },
  { quality: 'diminished', extensions: [] },
  { quality: 'augmented', extensions: [] },
]);

const SHARP_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const FLAT_NAMES = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];
const TONIC_NAMES = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];
const LETTERS = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];
const NATURAL_PCS = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
const INTERVAL_LABELS = ['', 'b2', '2', 'b3', '3', '4', 'b5', '5', '#5', '6', 'b7', '7'];

export function getScale(scaleId) {
  return SCALES.find((scale) => scale.id === scaleId) || SCALES[0];
}

export function getScalePitchClasses(key, scaleId) {
  return getScale(scaleId).intervals.map((interval) => mod(key + interval, 12));
}

export function leftPadNote({ key = 0, scaleId = 'major', octave = 0, index = 0 }) {
  const intervals = getScale(scaleId).intervals;
  const scaleOctave = Math.floor(index / intervals.length);
  const degree = mod(index, intervals.length);
  return Math.max(0, Math.min(127, 48 + mod(key, 12) + octave * 12 + scaleOctave * 12 + intervals[degree]));
}

function accidentalName(letter, pitchClass) {
  let difference = mod(pitchClass - NATURAL_PCS[letter] + 6, 12) - 6;
  if (difference > 2) difference -= 12;
  if (difference < -2) difference += 12;
  return letter + (difference > 0 ? '#'.repeat(difference) : 'b'.repeat(-difference));
}

function scaleSpellings(key, scaleId) {
  const scale = getScale(scaleId);
  const tonic = TONIC_NAMES[mod(key, 12)];
  const tonicLetter = LETTERS.indexOf(tonic[0]);
  const byPitchClass = new Map();
  let sharps = 0;
  let flats = 0;
  scale.intervals.forEach((interval, degree) => {
    const name = accidentalName(LETTERS[mod(tonicLetter + degree, 7)], mod(key + interval, 12));
    byPitchClass.set(mod(key + interval, 12), name);
    sharps += (name.match(/#/g) || []).length;
    flats += (name.match(/b/g) || []).length;
  });
  return { byPitchClass, preferFlats: flats >= sharps && flats > 0 };
}

export function spellPitchClass(pitchClass, { key = 0, scaleId = 'major' } = {}) {
  const spellings = scaleSpellings(key, scaleId);
  const pc = mod(pitchClass, 12);
  return spellings.byPitchClass.get(pc) || (spellings.preferFlats ? FLAT_NAMES[pc] : SHARP_NAMES[pc]);
}

function classifyTriad(intervals) {
  const signature = intervals.slice(0, 3).map((value) => mod(value - intervals[0], 12)).join(',');
  return ({ '0,4,7': 'major', '0,3,7': 'minor', '0,3,6': 'diminished', '0,4,8': 'augmented' })[signature] || 'custom';
}

function scaleStack(scale, degree, count) {
  const values = [];
  for (let index = 0; index < count; index += 1) {
    const rawDegree = degree + index * 2;
    values.push(scale.intervals[rawDegree % scale.intervals.length] + 12 * Math.floor(rawDegree / scale.intervals.length));
  }
  return values.map((value) => value - values[0]);
}

export function getChordIntervals(chord) {
  if (chord.intervals) return [...chord.intervals].sort((a, b) => a - b).slice(0, 6);
  const quality = QUALITY_INTERVALS[chord.quality] ? chord.quality : 'major';
  const base = [...QUALITY_INTERVALS[quality]];
  const add = (interval) => { if (!base.includes(interval)) base.push(interval); };
  for (const extension of chord.extensions || []) {
    if (extension === '6') add(9);
    if (extension === '7') add(quality === 'diminished' || quality === 'dim7' ? 9 : 10);
    if (extension === 'maj7') add(11);
    if (extension === 'add9') add(14);
    if (extension === '9' || extension === 'm9') { add(10); add(14); }
    if (extension === 'maj9') { add(11); add(14); }
    if (extension === '11') { add(10); add(14); add(17); }
  }
  return base.sort((a, b) => a - b).slice(0, 6);
}

export function buildChordNotes(chord, { key = 0, octave = 0 } = {}) {
  const registerShift = Number.isFinite(chord.registerShift) ? chord.registerShift : 0;
  const root = 48 + mod(key + chord.tonicOffset, 12) + (octave + registerShift) * 12;
  const intervals = getChordIntervals(chord);
  const inversion = Math.min(Math.max(chord.inversion || 0, 0), Math.max(intervals.length - 1, 0));
  const voiced = intervals.slice(inversion).concat(intervals.slice(0, inversion).map((value) => value + 12));

  if ((chord.spread || 0) >= 1 && voiced.length > 2) voiced[1] += 12;
  if ((chord.spread || 0) >= 2 && voiced.length > 3) voiced[3] += 12;
  voiced.sort((a, b) => a - b);

  while (voiced.length && root + voiced[voiced.length - 1] > 127) voiced.forEach((_, index) => { voiced[index] -= 12; });
  while (voiced.length && root + voiced[0] < 0) voiced.forEach((_, index) => { voiced[index] += 12; });
  return voiced.map((interval) => root + interval);
}

function spellChordTone(rootName, rootPc, pitchClass) {
  const interval = mod(pitchClass - rootPc, 12);
  const letterSteps = [0, 1, 1, 2, 2, 3, 4, 4, 4, 5, 6, 6][interval];
  const rootLetter = LETTERS.indexOf(rootName[0]);
  return accidentalName(LETTERS[mod(rootLetter + letterSteps, 7)], pitchClass);
}

export function nameChord(chord, key = 0, scaleId = 'major') {
  if (typeof key === 'object') {
    scaleId = key.scaleId || scaleId;
    key = key.key || 0;
  }
  const rootPc = mod(key + chord.tonicOffset, 12);
  const rootName = spellPitchClass(rootPc, { key, scaleId });
  const suffixes = {
    major: '', minor: 'm', diminished: 'dim', augmented: 'aug', sus2: 'sus2',
    sus4: 'sus4', power: '5', custom: '', dyad: '', add: '',
    m7b5: 'm7b5', half_diminished: 'm7b5', dim7: 'dim7',
  };
  const quality = Object.prototype.hasOwnProperty.call(suffixes, chord.quality) ? suffixes[chord.quality] : chord.quality;
  let extensions = (chord.extensions || []).map((extension) => extension === 'm9' ? '9' : extension).join('');
  if ((chord.quality === 'm7b5' || chord.quality === 'half_diminished' || chord.quality === 'dim7') && extensions === '7') extensions = '';
  let slash = '';
  if (chord.inversion) {
    const notes = chord.notes && chord.notes.length ? chord.notes : buildChordNotes(chord, { key, octave: 0 });
    const bassPc = mod(notes[0], 12);
    slash = `/${spellChordTone(rootName, rootPc, bassPc)}`;
  }
  return `${rootName}${quality}${extensions}${chord.shapeLabel || ''}${slash}`;
}

function chordPitchClasses(chord) {
  return new Set(getChordIntervals(chord).map((interval) => mod(chord.tonicOffset + interval, 12)));
}

function containedInScale(chord, scale) {
  const allowed = new Set(scale.intervals.map((interval) => mod(interval, 12)));
  return [...chordPitchClasses(chord)].every((pitch) => allowed.has(pitch));
}

function extensionLevel(chord) {
  const extensions = chord.extensions || [];
  if (extensions.some((extension) => ['9', 'm9', 'maj9', '11'].includes(extension))) return 2;
  return extensions.length || ['m7b5', 'dim7'].includes(chord.quality) ? 1 : 0;
}

function stackIdentity(scale, degree, count) {
  const intervals = scaleStack(scale, degree, count);
  const triad = classifyTriad(intervals);
  let quality = triad;
  let extensions = [];
  if (count >= 4) {
    if (triad === 'diminished' && intervals[3] === 9) quality = 'dim7';
    else if (triad === 'diminished' && intervals[3] === 10) quality = 'm7b5';
    else extensions = [intervals[3] === 11 ? 'maj7' : '7'];
  }
  if (count >= 5 && !['m7b5', 'dim7'].includes(quality)) extensions = [intervals[3] === 11 ? 'maj9' : '9'];
  return {
    tonicOffset: scale.intervals[degree], scaleDegree: degree, quality, extensions,
    intervals, inversion: 0, spread: 0, sourceClass: 'diatonic',
  };
}

function scaleShapeHarmonies(scale, tonicOffset, scaleDegree) {
  const relative = scale.intervals
    .map((interval) => mod(interval - tonicOffset, 12))
    .filter((interval) => interval !== 0)
    .sort((a, b) => a - b);
  const result = relative.map((interval) => ({
    tonicOffset,
    scaleDegree,
    quality: 'dyad',
    extensions: [],
    intervals: [0, interval],
    shapeLabel: `(${INTERVAL_LABELS[interval]})`,
    inversion: 0,
    spread: 0,
    sourceClass: 'diatonic',
  }));
  for (let left = 0; left < relative.length; left += 1) {
    for (let right = left + 1; right < relative.length; right += 1) {
      result.push({
        tonicOffset,
        scaleDegree,
        quality: 'add',
        extensions: [],
        intervals: [0, relative[left], relative[right]],
        shapeLabel: `(add${INTERVAL_LABELS[relative[left]]},add${INTERVAL_LABELS[relative[right]]})`,
        inversion: 0,
        spread: 0,
        sourceClass: 'diatonic',
      });
    }
  }
  return result;
}

function pentatonicHarmonies(scale) {
  const result = [];
  const definitions = FAMILY_DEFINITIONS.filter((definition) => (
    ['major', 'minor', 'sus2', 'sus4', 'power'].includes(definition.quality)
      && !definition.extensions.some((extension) => ['9', 'maj9'].includes(extension))
  ));
  scale.intervals.forEach((tonicOffset, scaleDegree) => {
    for (const definition of definitions) {
      const chord = { tonicOffset, scaleDegree, ...definition, inversion: 0, spread: 0, sourceClass: 'diatonic' };
      if (containedInScale(chord, scale)) result.push(chord);
    }
    result.push(...scaleShapeHarmonies(scale, tonicOffset, scaleDegree));
  });
  return result;
}

function diatonicHarmonies(scale) {
  if (scale.intervals.length === 5) return pentatonicHarmonies(scale);
  return scale.intervals.flatMap((_, degree) => [3, 4, 5].map((count) => stackIdentity(scale, degree, count)));
}

function parallelScaleFor(scale) {
  if (scale.intervals.length === 5) return getScale(scale.id === 'major_pentatonic' ? 'major' : 'natural_minor');
  return getScale(scale.intervals.includes(3) ? 'major' : 'natural_minor');
}

function colorHarmonies(scale) {
  const candidates = [];
  const parallel = parallelScaleFor(scale);
  const parallelChords = parallel.intervals.length === 5 ? pentatonicHarmonies(parallel) : diatonicHarmonies(parallel);
  for (const chord of parallelChords.filter((candidate) => candidate.extensions.length === 0)) {
    if (!containedInScale(chord, scale)) candidates.push({ ...chord, scaleDegree: -1, sourceClass: 'borrowed' });
  }
  scale.intervals.forEach((target, targetDegree) => {
    candidates.push({
      tonicOffset: mod(target + 7, 12), scaleDegree: -1, quality: 'major', extensions: ['7'],
      inversion: 0, spread: 0, sourceClass: 'secondary', targetDegree,
    });
  });
  return candidates;
}

function voicingVariants(chord, settings, maximum = 3) {
  const noteCount = getChordIntervals(chord).length;
  const preferredInversion = Math.min(settings.inversionBias || 0, Math.max(noteCount - 1, 0));
  const preferredSpread = Math.min(settings.spread || 0, 2);
  const pairs = [];
  for (let spread = 0; spread <= 2; spread += 1) {
    for (let inversion = 0; inversion < noteCount; inversion += 1) {
      pairs.push({ inversion, spread });
    }
  }
  pairs.sort((left, right) => (
    Math.abs(left.inversion - preferredInversion) + Math.abs(left.spread - preferredSpread)
      - Math.abs(right.inversion - preferredInversion) - Math.abs(right.spread - preferredSpread)
      || left.spread - right.spread || left.inversion - right.inversion
  ));
  return pairs.slice(0, maximum).map((pair) => ({ ...chord, ...pair }));
}

function midiDistance(destination, source) {
  if (!destination.length || !source.length) return 0;
  const directed = (from, to) => from.reduce((total, note) => (
    total + Math.min(...to.map((other) => Math.abs(note - other)))
  ), 0) / from.length;
  return (directed(destination, source) + directed(source, destination)) / 2;
}

function chooseRegister(chord, settings, currentNotes) {
  if (!currentNotes || !currentNotes.length) return { ...chord };
  let best = null;
  for (let registerShift = -3; registerShift <= 3; registerShift += 1) {
    const candidate = { ...chord, registerShift };
    const notes = buildChordNotes(candidate, settings);
    const distance = midiDistance(notes, currentNotes);
    if (!best || distance < best.distance) best = { chord: candidate, distance };
  }
  return best.chord;
}

function functionalBoost(chord, currentChord, degreeCount) {
  if (!chord || !currentChord || chord.scaleDegree < 0 || currentChord.scaleDegree < 0) return 0;
  if (currentChord.scaleDegree === 4 && chord.scaleDegree === 0) return 42;
  if (currentChord.scaleDegree === degreeCount - 1 && chord.scaleDegree === 0) return 20;
  if (currentChord.scaleDegree === 1 && chord.scaleDegree === 4) return 20;
  if (currentChord.scaleDegree === 0 && (chord.scaleDegree === 3 || chord.scaleDegree === 4)) return 14;
  return 0;
}

function sameHarmonicIdentity(left, right) {
  if (!left || !right) return false;
  return left.tonicOffset === right.tonicOffset
    && left.quality === right.quality
    && (left.extensions || []).join('.') === (right.extensions || []).join('.');
}

function scoreCandidate(chord, index, settings, currentNotes, scale) {
  let score = 100 - index / 10000;
  if (chord.sourceClass === 'diatonic') score += 18;
  if (chord.sourceClass === 'secondary') score += 14;
  if (chord.sourceClass === 'borrowed') score += 10;
  if (chord.scaleDegree === 4) score += 8;
  if (chord.scaleDegree === 0) score += 5;
  const previousChord = settings.previousChord || settings.currentChord;
  score += functionalBoost(chord, previousChord, scale.intervals.length);
  score += functionalBoost(settings.nextChord, chord, scale.intervals.length);
  score -= Math.abs(extensionLevel(chord) - (settings.extensionBias || 0)) * 7;
  score -= Math.abs((chord.inversion || 0) - (settings.inversionBias || 0)) * 3;
  score -= Math.abs((chord.spread || 0) - (settings.spread || 0)) * 3;
  if (currentNotes && currentNotes.length) score -= midiDistance(chord.notes, currentNotes) * 0.7;
  if (settings.nextChord) {
    const nextNotes = settings.nextChord.notes || buildChordNotes(settings.nextChord, settings);
    score -= midiDistance(chord.notes, nextNotes) * 0.35;
  }
  if (settings.currentChord && chord.tonicOffset === settings.currentChord.tonicOffset && chord.quality === settings.currentChord.quality) score -= 20;
  const recentChords = settings.recentChords || [];
  recentChords.forEach((recent, recentIndex) => {
    if (sameHarmonicIdentity(chord, recent)) score -= 32 / (recentChords.length - recentIndex);
  });
  return score;
}

function forceTopNote(notes, pitchClass) {
  const matching = notes.filter((note) => mod(note, 12) === pitchClass);
  if (!matching.length) return null;
  const result = [...notes];
  const chosen = result.lastIndexOf(matching[matching.length - 1]);
  let target = result[chosen];
  const otherMaximum = Math.max(...result.filter((_, index) => index !== chosen));
  while (target <= otherMaximum && target + 12 <= 127) target += 12;
  result[chosen] = target;
  return result.sort((a, b) => a - b);
}

function decorate(chord, settings, scale, currentNotes) {
  const copy = chooseRegister({
    ...chord,
    extensions: [...(chord.extensions || [])],
    intervals: chord.intervals ? [...chord.intervals] : undefined,
  }, settings, currentNotes);
  copy.notes = buildChordNotes(copy, settings);
  if (settings.topNotePc !== undefined && settings.topNotePc !== null) {
    const constrained = forceTopNote(copy.notes, mod(settings.topNotePc, 12));
    if (constrained) copy.notes = constrained;
  }
  const allowed = new Set(getScalePitchClasses(settings.key, scale.id));
  copy.outsidePitchClasses = [...new Set(copy.notes.map((note) => mod(note, 12)).filter((pc) => !allowed.has(pc)))];
  copy.label = nameChord(copy, settings.key, scale.id);
  return copy;
}

function voicingSignature(chord) {
  const pitchClasses = [...new Set(chord.notes.map((note) => mod(note, 12)))].sort((a, b) => a - b);
  return `${pitchClasses.join('.')}:${chord.notes.join('.')}`;
}

function uniqueRanked(candidates, settings, scale, currentNotes) {
  const seen = new Set();
  return candidates
    .map((chord, index) => {
      const decorated = decorate(chord, settings, scale, currentNotes);
      return { chord: decorated, index, score: scoreCandidate(decorated, index, settings, currentNotes, scale) };
    })
    .sort((left, right) => right.score - left.score || left.index - right.index)
    .filter((entry) => {
      const signature = voicingSignature(entry.chord);
      if (seen.has(signature)) return false;
      seen.add(signature);
      return true;
    });
}

function selectCandidates(ranked, settings, maximum = 16) {
  const topPc = settings.topNotePc;
  let entries = ranked;
  if (topPc !== undefined && topPc !== null) {
    const matching = ranked.filter(({ chord }) => mod(chord.notes[chord.notes.length - 1], 12) === mod(topPc, 12));
    entries = matching;
  }
  return entries.slice(0, maximum).map(({ chord, score }) => ({ ...chord, score }));
}

function diversifyHarmonicIdentities(ranked) {
  const identities = new Set();
  const firstOfEach = [];
  const remaining = [];
  for (const entry of ranked) {
    const chord = entry.chord;
    const identity = `${chord.quality}:${(chord.extensions || []).join('.')}:${chord.shapeLabel || ''}`;
    if (identities.has(identity)) remaining.push(entry);
    else {
      identities.add(identity);
      firstOfEach.push(entry);
    }
  }
  return firstOfEach.concat(remaining);
}

function rootCandidates(settings, scale, currentNotes) {
  const tonicOffset = mod(settings.focusPc - settings.key, 12);
  const scaleDegree = scale.intervals.indexOf(tonicOffset);
  const pool = [];
  FAMILY_DEFINITIONS.forEach((definition) => {
    const identity = { tonicOffset, scaleDegree, ...definition, inversion: 0, spread: 0, sourceClass: 'color' };
    const inScale = containedInScale(identity, scale);
    if (settings.colorDepth === 0 && !inScale) return;
    identity.sourceClass = inScale ? 'diatonic' : 'color';
    pool.push(...voicingVariants(identity, settings, 9));
  });
  let ranked = uniqueRanked(pool, settings, scale, currentNotes);
  if (ranked.length < 16) {
    for (const shape of scaleShapeHarmonies(scale, tonicOffset, scaleDegree)) {
      pool.push(...voicingVariants(shape, settings, 9));
    }
    ranked = uniqueRanked(pool, settings, scale, currentNotes);
  }
  return selectCandidates(diversifyHarmonicIdentities(ranked), settings);
}

function nextCandidates(settings, scale, currentNotes) {
  const strict = diatonicHarmonies(scale).flatMap((chord) => voicingVariants(chord, settings, 3));
  let pool = strict;
  if (settings.colorDepth > 0) {
    const variantCount = settings.colorDepth > 1 ? 3 : 2;
    pool = pool.concat(colorHarmonies(scale).flatMap((chord) => voicingVariants(chord, settings, variantCount)));
  }
  const ranked = uniqueRanked(pool, settings, scale, currentNotes);
  let selected = selectCandidates(ranked, settings);
  const requiredSources = settings.colorDepth > 1 ? ['secondary', 'borrowed'] : ['secondary'];
  for (const sourceClass of requiredSources) {
    if (selected.some((chord) => chord.sourceClass === sourceClass)) continue;
    const replacement = ranked.find(({ chord }) => (
      chord.sourceClass === sourceClass
        && (settings.topNotePc === undefined || settings.topNotePc === null
          || mod(chord.notes[chord.notes.length - 1], 12) === mod(settings.topNotePc, 12))
        && !selected.some((candidate) => voicingSignature(candidate) === voicingSignature(chord))
    ));
    if (replacement) {
      const replaceIndex = selected.map((chord) => chord.sourceClass).lastIndexOf('diatonic');
      selected[replaceIndex < 0 ? selected.length - 1 : replaceIndex] = { ...replacement.chord, score: replacement.score };
    }
  }
  return selected;
}

function voiceCandidates(settings, scale, currentNotes) {
  if (!settings.selectedChord) return [];
  const selected = {
    ...settings.selectedChord,
    extensions: [...(settings.selectedChord.extensions || [])],
    intervals: settings.selectedChord.intervals ? [...settings.selectedChord.intervals] : undefined,
  };
  const pool = voicingVariants(selected, settings, 16);
  return selectCandidates(uniqueRanked(pool, settings, scale, currentNotes), settings);
}

export function generateCandidates(input = {}) {
  const settings = {
    ...input,
    key: mod(input.key || 0, 12),
    scaleId: input.scaleId || 'major',
    octave: input.octave || 0,
    colorDepth: input.colorDepth || 0,
  };
  const scale = getScale(settings.scaleId);
  const mode = settings.mode || (settings.focusPc !== undefined && settings.focusPc !== null ? 'root' : 'next');
  let currentNotes = settings.currentNotes;
  if ((!currentNotes || !currentNotes.length) && settings.currentChord) {
    currentNotes = settings.currentChord.notes || buildChordNotes(settings.currentChord, settings);
  }
  if ((!currentNotes || !currentNotes.length) && settings.previousChord) {
    currentNotes = settings.previousChord.notes || buildChordNotes(settings.previousChord, settings);
  }
  if ((!currentNotes || !currentNotes.length) && settings.nextChord) {
    currentNotes = settings.nextChord.notes || buildChordNotes(settings.nextChord, settings);
  }
  if (mode === 'voice') return voiceCandidates(settings, scale, currentNotes);
  if (mode === 'root' && settings.focusPc !== undefined && settings.focusPc !== null) return rootCandidates(settings, scale, currentNotes);
  return nextCandidates(settings, scale, currentNotes);
}
