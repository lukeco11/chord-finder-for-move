const mod = (value, divisor) => ((value % divisor) + divisor) % divisor;

export const WHITE_KEYS = Object.freeze([
  { pitchClass: 0, label: 'C', x: 0, width: 18, black: false },
  { pitchClass: 2, label: 'D', x: 18, width: 18, black: false },
  { pitchClass: 4, label: 'E', x: 36, width: 19, black: false },
  { pitchClass: 5, label: 'F', x: 55, width: 18, black: false },
  { pitchClass: 7, label: 'G', x: 73, width: 18, black: false },
  { pitchClass: 9, label: 'A', x: 91, width: 18, black: false },
  { pitchClass: 11, label: 'B', x: 109, width: 19, black: false },
]);

export const BLACK_KEYS = Object.freeze([
  { pitchClass: 1, label: 'C#', x: 13, width: 10, black: true },
  { pitchClass: 3, label: 'D#', x: 31, width: 10, black: true },
  { pitchClass: 6, label: 'F#', x: 68, width: 10, black: true },
  { pitchClass: 8, label: 'G#', x: 86, width: 10, black: true },
  { pitchClass: 10, label: 'A#', x: 104, width: 10, black: true },
]);

const KEYS_BY_PITCH_CLASS = new Map(
  [...WHITE_KEYS, ...BLACK_KEYS].map((key) => [key.pitchClass, key]),
);

export function keyboardKeyForPitchClass(pitchClass) {
  if (!Number.isInteger(pitchClass)) return null;
  return KEYS_BY_PITCH_CLASS.get(mod(pitchClass, 12)) || null;
}

export function keyboardState(notes = [], rootPitchClass = null) {
  const validNotes = notes
    .filter((note) => Number.isInteger(note) && note >= 0 && note <= 127)
    .sort((left, right) => left - right);
  const counts = Array(12).fill(0);
  for (const note of validNotes) counts[note % 12] += 1;
  return {
    counts,
    soundingPitchClasses: counts.flatMap((count, pitchClass) => count > 0 ? [pitchClass] : []),
    bassPitchClass: validNotes.length ? validNotes[0] % 12 : null,
    topPitchClass: validNotes.length ? validNotes[validNotes.length - 1] % 12 : null,
    rootPitchClass: Number.isInteger(rootPitchClass) ? mod(rootPitchClass, 12) : null,
  };
}

export function createDisplayVoiceState() {
  return { sequence: 0, voices: new Map() };
}

function displayVoiceSnapshot(state) {
  let latest = null;
  const notes = new Set();
  for (const voice of state.voices.values()) {
    for (const note of voice.notes) notes.add(note);
    if (!latest || voice.order > latest.order) latest = voice;
  }
  return {
    active: latest !== null,
    notes: [...notes].sort((left, right) => left - right),
    chord: latest ? latest.chord : null,
    rootPitchClass: latest ? latest.rootPitchClass : null,
    label: latest ? latest.label : '',
    category: latest ? latest.category : '',
  };
}

export function startDisplayVoice(state, owner, voice) {
  state.voices.set(owner, {
    notes: [...(voice.notes || [])],
    chord: voice.chord || null,
    rootPitchClass: Number.isInteger(voice.rootPitchClass) ? mod(voice.rootPitchClass, 12) : null,
    label: voice.label || '',
    category: voice.category || '',
    order: ++state.sequence,
  });
  return displayVoiceSnapshot(state);
}

export function stopDisplayVoice(state, owner) {
  state.voices.delete(owner);
  return displayVoiceSnapshot(state);
}

export function clearDisplayVoices(state) {
  state.voices.clear();
  return displayVoiceSnapshot(state);
}
