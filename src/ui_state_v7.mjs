export const SETTINGS_SCHEMA_VERSION = 2;
export const ROUTES = Object.freeze(['move', 'external', 'both', 'schwung']);
export const PREVIEW_ROUTES = ROUTES;
export const EXPLORATION_MODES = Object.freeze(['root', 'next', 'voice']);
const HOST_VERSION_PATH = '/data/UserData/schwung/host/version.txt';

export const DEFAULT_SETTINGS = Object.freeze({
  schemaVersion: SETTINGS_SCHEMA_VERSION,
  mode: 'root',
  key: 0,
  scaleId: 'major',
  octave: 0,
  colorDepth: 1,
  extensionBias: 1,
  inversionBias: 0,
  spread: 0,
  strumMs: 0,
  rate: 2,
  gate: 85,
  channel: 0,
  route: 'move',
  previewRoute: 'move',
  progression: Object.freeze(Array(8).fill(null)),
});

const VALID_ROUTES = new Set(ROUTES);
const VALID_PREVIEW_ROUTES = new Set(PREVIEW_ROUTES);
const VALID_MODES = new Set(EXPLORATION_MODES);
const clamp = (value, minimum, maximum, fallback) => {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.max(minimum, Math.min(maximum, numeric)) : fallback;
};
const mod = (value, divisor) => ((value % divisor) + divisor) % divisor;

function cloneChord(chord) {
  if (!chord) return null;
  const copy = {
    ...chord,
    extensions: [...(chord.extensions || [])],
  };
  if (chord.intervals) copy.intervals = [...chord.intervals];
  delete copy.notes;
  delete copy.label;
  delete copy.score;
  return copy;
}

export function migrateSettings(input = {}) {
  const progression = Array.from({ length: 8 }, (_, index) => cloneChord((input.progression || [])[index]));
  return {
    schemaVersion: SETTINGS_SCHEMA_VERSION,
    mode: VALID_MODES.has(input.mode) ? input.mode : DEFAULT_SETTINGS.mode,
    key: mod(Number.isFinite(Number(input.key)) ? Number(input.key) : DEFAULT_SETTINGS.key, 12),
    scaleId: typeof input.scaleId === 'string' ? input.scaleId : DEFAULT_SETTINGS.scaleId,
    octave: clamp(input.octave ?? DEFAULT_SETTINGS.octave, -3, 3, DEFAULT_SETTINGS.octave),
    colorDepth: clamp(input.colorDepth ?? DEFAULT_SETTINGS.colorDepth, 0, 2, DEFAULT_SETTINGS.colorDepth),
    extensionBias: clamp(input.extensionBias ?? DEFAULT_SETTINGS.extensionBias, 0, 2, DEFAULT_SETTINGS.extensionBias),
    inversionBias: clamp(input.inversionBias ?? DEFAULT_SETTINGS.inversionBias, 0, 3, DEFAULT_SETTINGS.inversionBias),
    spread: clamp(input.spread ?? DEFAULT_SETTINGS.spread, 0, 2, DEFAULT_SETTINGS.spread),
    strumMs: clamp(input.strumMs ?? DEFAULT_SETTINGS.strumMs, 0, 100, DEFAULT_SETTINGS.strumMs),
    rate: clamp(input.rate ?? DEFAULT_SETTINGS.rate, 0, 4, DEFAULT_SETTINGS.rate),
    gate: clamp(input.gate ?? DEFAULT_SETTINGS.gate, 10, 100, DEFAULT_SETTINGS.gate),
    channel: clamp(input.channel ?? DEFAULT_SETTINGS.channel, 0, 15, DEFAULT_SETTINGS.channel),
    route: VALID_ROUTES.has(input.route) ? input.route : DEFAULT_SETTINGS.route,
    previewRoute: VALID_PREVIEW_ROUTES.has(input.previewRoute)
      ? input.previewRoute
      : DEFAULT_SETTINGS.previewRoute,
    progression,
  };
}

export function hostSupportsActiveMoveInject(globals = globalThis) {
  const hasDedicatedOutput = typeof globals.shadow_overtake_move_inject_active === 'function';
  if (hasDedicatedOutput) return true;

  const hasOvertakeInput = typeof globals.shadow_inbound_pad_midi_active === 'function';
  if (!hasOvertakeInput) return true;

  let version = '';
  try {
    if (typeof globals.host_read_file === 'function') {
      version = String(globals.host_read_file(HOST_VERSION_PATH) || '').trim();
    }
  } catch (_error) {
    return false;
  }
  const match = version.match(/^v?(\d+)\.(\d+)\.(\d+)/);
  if (!match) return false;
  const major = Number(match[1]);
  const minor = Number(match[2]);
  return major === 0 && minor < 12;
}

export function createUiState(settings = {}) {
  const persisted = migrateSettings(settings);
  return {
    settings: persisted,
    progression: persisted.progression,
    candidates: Array(16).fill(null),
    heldCandidates: Array(16).fill(null),
    heldRight: Array(16).fill(false),
    heldRightOrder: [],
    captureIndex: 0,
    ledQueue: [],
  };
}

function gridPosition(note) {
  if (note < 68 || note > 99) return null;
  const offset = note - 68;
  const row = Math.floor(offset / 8);
  const column = offset % 8;
  return row < 4 ? { row, column } : null;
}

export function leftPadIndex(note) {
  const position = gridPosition(note);
  return position && position.column < 4 ? position.row * 4 + position.column : -1;
}

export function rightPadIndex(note) {
  const position = gridPosition(note);
  return position && position.column >= 4 ? position.row * 4 + position.column - 4 : -1;
}

function snapshotCandidate(chord) {
  const snapshot = {
    ...chord,
    extensions: [...(chord.extensions || [])],
    notes: [...(chord.notes || [])],
  };
  if (chord.intervals) snapshot.intervals = [...chord.intervals];
  return snapshot;
}

function rememberHeldRight(state, index) {
  const order = state.heldRightOrder;
  const existing = order.indexOf(index);
  if (existing >= 0) order.splice(existing, 1);
  order.push(index);
}

function forgetHeldRight(state, index) {
  const order = state.heldRightOrder;
  const existing = order.indexOf(index);
  if (existing >= 0) order.splice(existing, 1);
}

export function pressCandidate(state, index, chord) {
  const snapshot = snapshotCandidate(chord);
  state.heldCandidates[index] = snapshot;
  state.heldRight[index] = true;
  rememberHeldRight(state, index);
  return snapshot;
}

export function releaseCandidate(state, index) {
  const snapshot = state.heldCandidates[index];
  state.heldCandidates[index] = null;
  state.heldRight[index] = false;
  forgetHeldRight(state, index);
  return snapshot;
}

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

export function clearHeldCandidates(state) {
  state.heldCandidates.fill(null);
  state.heldRight.fill(false);
  state.heldRightOrder.length = 0;
}

export function latestHeldCandidate(state) {
  const order = state.heldRightOrder || [];
  for (let index = order.length - 1; index >= 0; index -= 1) {
    const snapshot = state.heldCandidates[order[index]];
    if (snapshot) return snapshot;
  }
  return null;
}

export function resolveStepPress(state, options = {}) {
  if (options.deleteHeld) return { action: 'clear' };

  const held = latestHeldCandidate(state);
  if (options.shiftHeld) {
    const chord = held || options.lastAuditioned || null;
    if (chord) return { action: 'store', chord };
    return { action: 'need-audition' };
  }

  if (held) return { action: 'store', chord: held };
  if (state.heldRight.some(Boolean)) return { action: 'ignore' };

  const slotIndex = Number(options.slotIndex);
  if (!Number.isInteger(slotIndex) || slotIndex < 0 || slotIndex >= 8) {
    return { action: 'ignore' };
  }
  const stored = state.progression[slotIndex];
  if (stored) return { action: 'preview', chord: stored };
  return { action: 'gap-fill' };
}

export function assignProgressionSlot(state, index, chord) {
  if (index < 0 || index >= 8) return;
  state.progression[index] = cloneChord(chord);
}

export function appendProgressionChord(state, chord) {
  for (let offset = 0; offset < 8; offset += 1) {
    const index = (state.captureIndex + offset) % 8;
    if (state.progression[index]) continue;
    assignProgressionSlot(state, index, chord);
    state.captureIndex = (index + 1) % 8;
    return index;
  }
  return -1;
}

export function progressionLength(progression) {
  for (let index = 7; index >= 0; index -= 1) {
    if (progression[index]) return index + 1;
  }
  return 0;
}

export function progressionNeighbors(progression, selectedIndex) {
  if (!Array.isArray(progression) || selectedIndex < 0 || selectedIndex >= progression.length) {
    return { previousChord: null, nextChord: null };
  }
  let previousChord = null;
  let nextChord = null;
  for (let index = selectedIndex - 1; index >= 0; index -= 1) {
    if (progression[index]) {
      previousChord = progression[index];
      break;
    }
  }
  for (let index = selectedIndex + 1; index < progression.length; index += 1) {
    if (progression[index]) {
      nextChord = progression[index];
      break;
    }
  }
  return { previousChord, nextChord };
}

export function nextExplorationMode(mode) {
  const index = EXPLORATION_MODES.indexOf(mode);
  return EXPLORATION_MODES[index < 0 ? 0 : (index + 1) % EXPLORATION_MODES.length];
}

export function takeLedBatch(queue, maximum = 8) {
  return queue.splice(0, maximum);
}

export const ENCODER_DETENT_GEAR = 2;
export const OVERLAY_TICKS = 150;
export const IMPRESSIVE_CHORDS_DIR = '/data/UserData/schwung/modules/midi_fx/impressive-chords';
export const IMPRESSIVE_CHORDS_PRESETS_DIR = `${IMPRESSIVE_CHORDS_DIR}/presets`;
export const IMPRESSIVE_CHORDS_PRESETS_CHORDS_DIR = `${IMPRESSIVE_CHORDS_PRESETS_DIR}/chords`;
export const IMPRESSIVE_CHORDS_SOURCES_DIR = `${IMPRESSIVE_CHORDS_DIR}/sources`;
export const CHORD_FINDER_DIR = '/data/UserData/schwung/modules/tools/chord-finder';
export const CHORD_FINDER_EXPORTS_DIR = `${CHORD_FINDER_DIR}/exports`;

export function encoderDetent(accumulator, delta, gear = ENCODER_DETENT_GEAR) {
  if (!delta) return { accumulator, step: 0 };
  let next = accumulator + delta;
  if (Math.abs(next) < gear) return { accumulator: next, step: 0 };
  const step = next > 0 ? 1 : -1;
  next -= step * gear;
  return { accumulator: next, step };
}

export function packedProgressionChords(progression, notesFor) {
  const chords = [];
  if (!Array.isArray(progression) || typeof notesFor !== 'function') return chords;
  for (let slot = 0; slot < progression.length; slot += 1) {
    if (!progression[slot]) continue;
    const raw = notesFor(progression[slot], slot);
    const notes = (Array.isArray(raw) ? raw : [])
      .filter((note) => Number.isInteger(note) && note >= 0 && note <= 127);
    if (!notes.length) continue;
    chords.push({ index: chords.length, notes });
  }
  return chords;
}

export function formatImpressiveChordsFile(name, chords) {
  const lines = [`Name: ${name || 'Chord Finder'}`];
  for (const chord of chords || []) {
    lines.push(`${chord.index}: ${chord.notes.join(',')}`);
  }
  return `${lines.join('\n')}\n`;
}

export function formatImpressiveChordsJson(chords) {
  const data = {};
  for (const chord of chords || []) {
    data[String(chord.index)] = [...chord.notes];
  }
  return `${JSON.stringify(data)}\n`;
}

function variableLength(value) {
  const bytes = [value & 0x7f];
  let remaining = value >>> 7;
  while (remaining > 0) {
    bytes.unshift((remaining & 0x7f) | 0x80);
    remaining >>>= 7;
  }
  return bytes;
}

export function formatMidiFile(chords, options = {}) {
  const ticksPerBeat = Number.isFinite(options.ticksPerBeat) ? options.ticksPerBeat : 96;
  const beatsPerChord = Number.isFinite(options.beatsPerChord) ? options.beatsPerChord : 1;
  const gate = Number.isFinite(options.gate) ? Math.max(10, Math.min(100, options.gate)) : 85;
  const span = Math.max(1, ticksPerBeat * beatsPerChord);
  const noteLen = Math.max(1, Math.round(span * gate / 100));
  const rest = Math.max(0, span - noteLen);
  const track = [];
  const pushDelta = (delta) => {
    track.push(...variableLength(delta));
  };
  let pending = 0;
  for (const chord of chords || []) {
    if (!chord.notes || !chord.notes.length) continue;
    chord.notes.forEach((note, index) => {
      pushDelta(index === 0 ? pending : 0);
      track.push(0x90, note & 0x7f, 100);
      pending = 0;
    });
    chord.notes.forEach((note, index) => {
      pushDelta(index === 0 ? noteLen : 0);
      track.push(0x80, note & 0x7f, 0);
    });
    pending = rest;
  }
  pushDelta(pending);
  track.push(0xff, 0x2f, 0x00);
  return Uint8Array.from([
    0x4d, 0x54, 0x68, 0x64, 0x00, 0x00, 0x00, 0x06,
    0x00, 0x00, 0x00, 0x01, (ticksPerBeat >> 8) & 0xff, ticksPerBeat & 0xff,
    0x4d, 0x54, 0x72, 0x6b,
    (track.length >> 24) & 0xff, (track.length >> 16) & 0xff,
    (track.length >> 8) & 0xff, track.length & 0xff,
    ...track,
  ]);
}

export function bytesToHostString(bytes) {
  let text = '';
  for (let index = 0; index < bytes.length; index += 1) {
    text += String.fromCharCode(bytes[index]);
  }
  return text;
}
