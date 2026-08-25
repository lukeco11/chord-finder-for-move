const mod = (value, divisor) => ((value % divisor) + divisor) % divisor;
const WHITE_PITCH_CLASSES = new Set([0, 2, 4, 5, 7, 9, 11]);
const NOTE_LABELS = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const DISPLAY_WIDTH = 128;
const DISPLAY_SEMITONES = 24;
const WHITE_KEY_COUNT = 14;
const BLACK_KEY_WIDTH = 5;

function validMidiNotes(notes) {
  return notes
    .filter((note) => Number.isInteger(note) && note >= 0 && note <= 127)
    .sort((left, right) => left - right);
}

function cAlignedStart(fallbackNote) {
  const safeNote = Number.isInteger(fallbackNote) && fallbackNote >= 0 && fallbackNote <= 127
    ? fallbackNote
    : 60;
  return Math.max(0, Math.min(96, Math.floor(safeNote / 12) * 12));
}

function whiteKeyGeometry(index) {
  const x = Math.floor(index * DISPLAY_WIDTH / WHITE_KEY_COUNT);
  const nextX = Math.floor((index + 1) * DISPLAY_WIDTH / WHITE_KEY_COUNT);
  return { x, width: nextX - x };
}

export function keyboardState(notes = [], rootPitchClass = null, fallbackNote = 60) {
  const validNotes = validMidiNotes(notes);
  const startNote = cAlignedStart(fallbackNote);
  const endNote = startNote + DISPLAY_SEMITONES - 1;
  const sounding = new Set(validNotes);
  const whiteKeys = [];
  const blackKeys = [];
  let whiteIndex = 0;

  for (let note = startNote; note <= endNote; note += 1) {
    const pitchClass = mod(note, 12);
    if (WHITE_PITCH_CLASSES.has(pitchClass)) {
      const geometry = whiteKeyGeometry(whiteIndex++);
      whiteKeys.push({
        note,
        pitchClass,
        label: NOTE_LABELS[pitchClass],
        octaveLabel: pitchClass === 0 ? `C${Math.floor(note / 12) - 1}` : '',
        black: false,
        sounding: sounding.has(note),
        ...geometry,
      });
      continue;
    }
    const precedingWhite = whiteKeys[whiteKeys.length - 1];
    const x = Math.min(DISPLAY_WIDTH - BLACK_KEY_WIDTH,
      precedingWhite.x + precedingWhite.width - Math.floor(BLACK_KEY_WIDTH / 2));
    blackKeys.push({
      note,
      pitchClass,
      label: NOTE_LABELS[pitchClass],
      octaveLabel: '',
      black: true,
      sounding: sounding.has(note),
      x,
      width: BLACK_KEY_WIDTH,
    });
  }

  const visibleNotes = validNotes.filter((note) => note >= startNote && note <= endNote);
  const keys = [...whiteKeys, ...blackKeys].sort((left, right) => left.note - right.note);
  return {
    startNote,
    endNote,
    keys,
    whiteKeys,
    blackKeys,
    visibleNotes,
    overflowBelow: validNotes.filter((note) => note < startNote).length,
    overflowAbove: validNotes.filter((note) => note > endNote).length,
    bassNote: validNotes.length ? validNotes[0] : null,
    topNote: validNotes.length ? validNotes[validNotes.length - 1] : null,
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
