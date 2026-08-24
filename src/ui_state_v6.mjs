export const SETTINGS_SCHEMA_VERSION = 2;
export const ROUTES = Object.freeze(['move', 'external', 'both']);
export const PREVIEW_ROUTES = Object.freeze([...ROUTES, 'schwung']);
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

export function pressCandidate(state, index, chord) {
  const snapshot = snapshotCandidate(chord);
  state.heldCandidates[index] = snapshot;
  state.heldRight[index] = true;
  return snapshot;
}

export function releaseCandidate(state, index) {
  const snapshot = state.heldCandidates[index];
  state.heldCandidates[index] = null;
  state.heldRight[index] = false;
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
