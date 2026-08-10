import {
  Black, White, BrightGreen, ForestGreen, DullGreen,
  VividYellow, Ochre, BurntOrange, RoyalBlue, Cyan, Purple,
  MidiNoteOn, MidiNoteOff, MidiCC,
  MoveCapture, MoveDelete, MoveDown, MoveUp, MoveMenu,
  MoveMainButton, MoveMainKnob, MoveKnob1, MoveKnob8,
  MovePlay, MoveShift, WhiteLedDim, WhiteLedBright,
} from '/data/UserData/schwung/shared/constants.mjs';
import {
  decodeDelta, setButtonLED, setLED, shouldFilterMessage,
} from '/data/UserData/schwung/shared/input_filter.mjs';
import { announce, announceMenuItem } from '/data/UserData/schwung/shared/screen_reader.mjs';

import {
  SCALES, buildChordNotes, generateCandidates, getScale, leftPadNote, nameChord,
} from './harmony.mjs';
import {
  appendProgressionChord, assignProgressionSlot, createUiState,
  leftPadIndex, migrateSettings, nextExplorationMode, pressCandidate,
  progressionLength, progressionNeighbors, releaseCandidate, rightPadIndex, ROUTES, takeLedBatch,
} from './ui_state.mjs';

const SETTINGS_PATH = '/data/UserData/schwung/modules/tools/chord-finder/settings.json';
const ROUTE_LABELS = { move: 'MOVE/USB-C', external: 'USB-A', both: 'BOTH' };
const ROUTE_SHORT = { move: 'M', external: 'A', both: 'B' };
const ROUTE_VALUES = { move: 0, external: 1, both: 2 };
const RATE_LABELS = ['1/16', '1/8', '1/4', '1/2', '1 BAR'];
const DIATONIC_COLORS = [BrightGreen, ForestGreen, DullGreen];
const COLOR_COLORS = [VividYellow, Ochre, BurntOrange];
const MENU_ITEMS = ['MIDI CHANNEL', 'OUTPUT ROUTE', 'PREVIEW ROUTE', 'GLOBAL GATE', 'TEST OUTPUT'];
const KEY_NAMES = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];
const MODE_LABELS = { root: 'ROOT', next: 'NEXT', voice: 'VOICE' };
const PARAMETER_LABELS = ['KEY', 'SCALE', 'COLOR', 'EXT', 'INV', 'SPREAD', 'STRUM', 'STEP'];

let state = createUiState();
let focusPc = null;
let currentChord = null;
let currentNotes = [];
let recentChords = [];
let lastAuditioned = null;
let displayChord = null;
let topNotePc = null;
let currentLabel = 'Choose a note';
let currentCategory = 'SCALE ROOT';
let running = false;
let loopStep = -1;
let selectedSlot = -1;
let deleteHeld = false;
let shiftHeld = false;
let captureArmed = false;
let menuOpen = false;
let menuCursor = 0;
let menuEditing = false;
let saveCountdown = -1;
let pollCountdown = 1;
let dirty = true;
let heldLeft = Array(16).fill(false);
let commandSequence = 0;
let commandQueue = [];
let liveOwners = new Set();
let parkedLastTick = false;
let forceLedPaint = false;
let overlayText = '';
let overlayCountdown = 0;

function clamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, value));
}

function wrap(value, length) {
  return ((value % length) + length) % length;
}

function clonePersistedSettings() {
  return { ...state.settings, progression: state.progression };
}

function deliverCommand(payload, reliable) {
  if (reliable && typeof host_module_set_param_blocking === 'function') {
    return host_module_set_param_blocking('command', payload, 50) === true;
  }
  if (typeof host_module_set_param === 'function') {
    host_module_set_param('command', payload);
    return true;
  }
  return false;
}

function flushCommandQueue() {
  while (commandQueue.length) {
    if (!deliverCommand(commandQueue[0], true)) return false;
    commandQueue.shift();
  }
  return true;
}

function sendCommand(command, reliable = true) {
  const payload = JSON.stringify({ v: 1, seq: ++commandSequence, ...command });
  if (!reliable) return deliverCommand(payload, false);
  commandQueue.push(payload);
  return flushCommandQueue();
}

function configureDsp() {
  const settings = state.settings;
  sendCommand({
    op: 'config',
    route: ROUTE_VALUES[settings.route],
    channel: settings.channel,
    strum_ms: settings.strumMs,
    gate: settings.gate,
    rate: settings.rate,
  }, true);
}

function liveRoute() {
  return ROUTE_VALUES[state.settings.previewRoute];
}

function semanticChord(chord) {
  if (!chord) return null;
  const copy = {
    tonicOffset: chord.tonicOffset,
    scaleDegree: chord.scaleDegree,
    quality: chord.quality,
    extensions: [...(chord.extensions || [])],
    inversion: chord.inversion || 0,
    spread: chord.spread || 0,
    sourceClass: chord.sourceClass,
  };
  if (chord.intervals) copy.intervals = [...chord.intervals];
  if (Number.isFinite(chord.registerShift)) copy.registerShift = chord.registerShift;
  if (chord.shapeLabel) copy.shapeLabel = chord.shapeLabel;
  if (Number.isFinite(chord.targetDegree)) copy.targetDegree = chord.targetDegree;
  return copy;
}

function slotNotes(chord) {
  return buildChordNotes(chord, { key: state.settings.key, octave: state.settings.octave });
}

function syncSlot(index) {
  const chord = state.progression[index];
  if (chord) sendCommand({ op: 'slot_set', slot: index, velocity: 100, notes: slotNotes(chord) }, true);
  else sendCommand({ op: 'slot_clear', slot: index }, true);
}

function syncAllSlots() {
  for (let index = 0; index < 8; index += 1) syncSlot(index);
}

function scheduleSave() {
  saveCountdown = 45;
}

function saveSettings() {
  if (typeof host_write_file !== 'function') return;
  if (host_write_file(SETTINGS_PATH, JSON.stringify(clonePersistedSettings())) === true) {
    saveCountdown = -1;
  } else {
    saveCountdown = 90;
  }
}

function loadSettings() {
  if (typeof host_read_file !== 'function') return migrateSettings();
  try {
    const raw = host_read_file(SETTINGS_PATH);
    return raw ? migrateSettings(JSON.parse(raw)) : migrateSettings();
  } catch (_error) {
    return migrateSettings();
  }
}

function candidateSettings() {
  const fillingGap = selectedSlot >= 0 && !state.progression[selectedSlot];
  const neighbors = fillingGap
    ? progressionNeighbors(state.progression, selectedSlot)
    : { previousChord: currentChord, nextChord: null };
  const previousChord = fillingGap ? neighbors.previousChord : currentChord;
  return {
    key: state.settings.key,
    scaleId: state.settings.scaleId,
    octave: state.settings.octave,
    colorDepth: state.settings.colorDepth,
    extensionBias: state.settings.extensionBias,
    inversionBias: state.settings.inversionBias,
    spread: state.settings.spread,
    mode: state.settings.mode,
    focusPc,
    currentChord: previousChord,
    currentNotes: previousChord && previousChord !== currentChord ? slotNotes(previousChord) : currentNotes,
    previousChord,
    nextChord: neighbors.nextChord,
    recentChords,
    selectedChord: lastAuditioned || currentChord,
    topNotePc,
  };
}

function showOverlay(text, ticks = 75) {
  overlayText = text;
  overlayCountdown = ticks;
  dirty = true;
}

function refreshCandidates() {
  state.candidates = generateCandidates(candidateSettings());
  queueLedRefresh();
  dirty = true;
}

function queueLed(note, color, button) {
  state.ledQueue.push({ note, color, button: Boolean(button), force: forceLedPaint });
}

function queueLedRefresh() {
  state.ledQueue.length = 0;
  for (let index = 0; index < 16; index += 1) {
    const row = Math.floor(index / 4);
    const column = index % 4;
    const note = 68 + row * 8 + column;
    const midiNote = leftPadNote({ ...state.settings, index });
    const pitchClass = wrap(midiNote, 12);
    let color = pitchClass === state.settings.key ? White : RoyalBlue;
    if (focusPc === pitchClass) color = VividYellow;
    if (topNotePc === pitchClass) color = Purple;
    if (heldLeft[index]) color = BrightGreen;
    queueLed(note, color);
  }
  for (let index = 0; index < 16; index += 1) {
    const row = Math.floor(index / 4);
    const column = index % 4;
    const note = 72 + row * 8 + column;
    const chord = state.candidates[index];
    if (!chord) {
      queueLed(note, Black);
      continue;
    }
    const palette = chord && chord.sourceClass === 'diatonic' ? DIATONIC_COLORS : COLOR_COLORS;
    const rankBand = index < 5 ? 0 : (index < 11 ? 1 : 2);
    queueLed(note, state.heldCandidates[index] ? White : palette[rankBand]);
  }
  for (let index = 0; index < 8; index += 1) {
    const color = running && loopStep === index
      ? White
      : (selectedSlot === index || (captureArmed && state.captureIndex === index)
        ? VividYellow
        : (state.progression[index] ? RoyalBlue : Black));
    queueLed(16 + index, color);
  }
  queueLed(MoveCapture, captureArmed ? WhiteLedBright : WhiteLedDim, true);
  queueLed(MovePlay, running ? BrightGreen : Black, true);
  forceLedPaint = false;
}

function drainLedQueue() {
  const updates = takeLedBatch(state.ledQueue);
  for (const update of updates) {
    if (update.button) setButtonLED(update.note, update.color, update.force);
    else setLED(update.note, update.color, update.force);
  }
}

function truncate(text, maximum) {
  const value = String(text);
  return value.length > maximum ? value.substring(0, maximum - 1) + '.' : value;
}

function menuValue(index) {
  const settings = state.settings;
  if (index === 0) return String(settings.channel + 1);
  if (index === 1) return ROUTE_LABELS[settings.route];
  if (index === 2) return ROUTE_LABELS[settings.previewRoute];
  if (index === 3) return String(settings.gate) + '%';
  return 'PRESS';
}

function drawMenu() {
  clear_screen();
  print(0, 0, 'Chord Finder', 1);
  print(80, 0, 'SETTINGS', 1);
  for (let index = 0; index < MENU_ITEMS.length; index += 1) {
    const y = 13 + index * 9;
    if (index === menuCursor) fill_rect(0, y - 1, 128, 9, 1);
    print(2, y, truncate(MENU_ITEMS[index], 14), index === menuCursor ? 0 : 1);
    print(91, y, truncate(menuValue(index), 6), index === menuCursor ? 0 : 1);
  }
  print(0, 58, menuEditing ? 'Turn jog  Click done' : 'Jog + click', 1);
}

function romanNumeral(chord) {
  if (!chord || chord.scaleDegree < 0) return '';
  const numerals = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII'];
  let numeral = numerals[chord.scaleDegree] || '';
  if (chord.quality === 'minor' || chord.quality === 'm7b5') numeral = numeral.toLowerCase();
  if (chord.quality === 'diminished' || chord.quality === 'dim7' || chord.quality === 'm7b5') numeral += 'o';
  return numeral;
}

function modeContext() {
  if (state.settings.mode === 'root') return focusPc === null ? 'ROOT: CHOOSE' : `ROOT ${KEY_NAMES[focusPc]}`;
  if (state.settings.mode === 'voice') return `VOICE ${lastAuditioned ? nameChord(lastAuditioned, { key: state.settings.key, scaleId: state.settings.scaleId }) : 'CHOOSE'}`;
  return `NEXT ${currentChord ? nameChord(currentChord, { key: state.settings.key, scaleId: state.settings.scaleId }) : 'START'}`;
}

function drawMain() {
  const scale = getScale(state.settings.scaleId);
  const keyName = KEY_NAMES[state.settings.key];
  clear_screen();
  print(0, 0, truncate(keyName + ' ' + scale.name, 15), 1);
  print(94, 0, truncate(ROUTE_SHORT[state.settings.previewRoute] + ' C' + (state.settings.channel + 1), 5), 1);
  print(0, 14, truncate(overlayText || currentLabel, 21), 1);
  const top = topNotePc === null ? '' : `  TOP ${KEY_NAMES[topNotePc]}`;
  print(0, 31, truncate(modeContext() + top, 21), 1);
  const category = displayChord && romanNumeral(displayChord)
    ? `${currentCategory} ${romanNumeral(displayChord)}`
    : currentCategory;
  print(0, 43, truncate(category.toUpperCase(), 20), 1);
  print(0, 52, 'OCT ' + String(state.settings.octave), 1);
  print(45, 52, RATE_LABELS[state.settings.rate], 1);
  print(78, 52, running ? `PLAY ${loopStep + 1}/${progressionLength(state.progression)}` : 'LOOP STOP', 1);
}

function draw() {
  if (menuOpen) drawMenu();
  else drawMain();
  dirty = false;
}

function announceCurrent() {
  announce(currentLabel + ', ' + currentCategory);
}

function playVoice(owner, notes, velocity) {
  liveOwners.add(owner);
  sendCommand({
    op: 'voice_on', owner, velocity: clamp(velocity || 100, 1, 127),
    route: liveRoute(), channel: state.settings.channel, notes,
  }, true);
}

function stopVoice(owner) {
  sendCommand({ op: 'voice_off', owner }, true);
  liveOwners.delete(owner);
}

function handleLeftPad(index, pressed, velocity) {
  if (pressed) {
    const note = leftPadNote({ ...state.settings, index });
    heldLeft[index] = true;
    focusPc = note % 12;
    state.settings.mode = 'root';
    displayChord = null;
    currentLabel = 'Root ' + KEY_NAMES[focusPc];
    currentCategory = 'ROOT VOICINGS';
    playVoice(index, [note], velocity);
    refreshCandidates();
    scheduleSave();
  } else {
    heldLeft[index] = false;
    stopVoice(index);
    queueLedRefresh();
  }
}

function toggleTopNote(index) {
  const note = leftPadNote({ ...state.settings, index });
  const pitchClass = note % 12;
  topNotePc = topNotePc === pitchClass ? null : pitchClass;
  refreshCandidates();
  showOverlay(topNotePc === null
    ? 'TOP NOTE OFF'
    : (state.candidates.length ? `TOP NOTE ${KEY_NAMES[topNotePc]}` : `NO CHORDS: TOP ${KEY_NAMES[topNotePc]}`));
  announce(topNotePc === null ? 'Top note constraint off' : `Top note ${KEY_NAMES[topNotePc]}`);
}

function commitContext(chord) {
  if (!chord) return;
  currentChord = semanticChord(chord);
  currentNotes = [...(chord.notes || slotNotes(chord))];
  recentChords.push(semanticChord(chord));
  if (recentChords.length > 4) recentChords.shift();
  if (state.settings.mode === 'next') refreshCandidates();
}

function storeChordAt(index, chord) {
  assignProgressionSlot(state, index, chord);
  syncSlot(index);
  selectedSlot = index;
  if (chord) {
    commitContext(chord);
    showOverlay(`SAVED ${index + 1}: ${chord.label || nameChord(chord, { key: state.settings.key, scaleId: state.settings.scaleId })}`);
  } else {
    state.settings.mode = 'next';
    const neighbors = progressionNeighbors(state.progression, index);
    currentChord = neighbors.previousChord ? semanticChord(neighbors.previousChord) : null;
    currentNotes = currentChord ? slotNotes(currentChord) : [];
    displayChord = null;
    currentLabel = `Fill step ${index + 1}`;
    currentCategory = neighbors.nextChord ? 'BETWEEN CHORDS' : 'NEXT CHORD';
    refreshCandidates();
    showOverlay(`CLEARED STEP ${index + 1}`);
  }
  scheduleSave();
  queueLedRefresh();
}

function appendChord(chord) {
  const index = appendProgressionChord(state, chord);
  if (index < 0) {
    captureArmed = false;
    showOverlay('PROGRESSION FULL');
    announce('Progression full, capture off');
    queueLedRefresh();
    return -1;
  }
  syncSlot(index);
  selectedSlot = index;
  commitContext(chord);
  showOverlay(`CAPTURED ${index + 1}: ${chord.label}`);
  scheduleSave();
  queueLedRefresh();
  return index;
}

function handleRightPad(index, pressed, velocity) {
  if (pressed) {
    const chord = state.candidates[index];
    if (!chord) return;
    const snapshot = pressCandidate(state, index, chord);
    lastAuditioned = snapshot;
    displayChord = semanticChord(snapshot);
    currentLabel = snapshot.label;
    currentCategory = snapshot.sourceClass;
    playVoice(16 + index, snapshot.notes, velocity);
    if (captureArmed) appendChord(snapshot);
    dirty = true;
    announceCurrent();
  } else {
    releaseCandidate(state, index);
    stopVoice(16 + index);
    queueLedRefresh();
  }
}

function heldChord() {
  for (let index = 0; index < state.heldCandidates.length; index += 1) {
    if (state.heldCandidates[index]) return state.heldCandidates[index];
  }
  return null;
}

function handleStep(index, pressed, velocity) {
  if (index < 0 || index >= 8) return;
  if (pressed) {
    if (deleteHeld) {
      storeChordAt(index, null);
      announce('Slot ' + (index + 1) + ' cleared');
      return;
    }
    const chord = heldChord();
    const selected = chord || lastAuditioned;
    if (shiftHeld && selected) {
      storeChordAt(index, selected);
      announce('Stored ' + selected.label + ' in slot ' + (index + 1));
      return;
    }
    if (shiftHeld) {
      showOverlay('AUDITION A CHORD FIRST');
      announce('Audition a chord first');
      return;
    }
    const stored = state.progression[index];
    if (stored) {
      const notes = slotNotes(stored);
      playVoice(40 + index, notes, velocity);
      lastAuditioned = { ...stored, notes, label: nameChord(stored, { key: state.settings.key, scaleId: state.settings.scaleId }) };
      displayChord = semanticChord(lastAuditioned);
      currentLabel = lastAuditioned.label;
      currentCategory = 'PROGRESSION ' + (index + 1);
      selectedSlot = index;
      commitContext(lastAuditioned);
      dirty = true;
    } else {
      selectedSlot = index;
      state.settings.mode = 'next';
      const neighbors = progressionNeighbors(state.progression, index);
      currentChord = neighbors.previousChord ? semanticChord(neighbors.previousChord) : null;
      currentNotes = currentChord ? slotNotes(currentChord) : [];
      displayChord = null;
      currentLabel = `Fill step ${index + 1}`;
      currentCategory = neighbors.nextChord ? 'BETWEEN CHORDS' : 'NEXT CHORD';
      refreshCandidates();
      scheduleSave();
      showOverlay(`FILL STEP ${index + 1}`);
      announce(`Choose a chord for slot ${index + 1}`);
    }
  } else {
    stopVoice(40 + index);
  }
}

function updateCandidatesAndSlots(transposeSlots) {
  if (transposeSlots && currentChord) currentNotes = slotNotes(currentChord);
  refreshCandidates();
  if (transposeSlots) syncAllSlots();
  scheduleSave();
}

function updateEncoder(index, rawValue) {
  const delta = decodeDelta(rawValue);
  if (!delta) return;
  const settings = state.settings;
  const before = [settings.key, settings.scaleId, settings.colorDepth,
    settings.extensionBias, settings.inversionBias, settings.spread,
    settings.strumMs, settings.rate][index];
  if (index === 0) {
    settings.key = wrap(settings.key + delta, 12);
    if (settings.mode === 'root') focusPc = settings.key;
  }
  if (index === 1) {
    const scaleIndex = SCALES.findIndex((scale) => scale.id === settings.scaleId);
    settings.scaleId = SCALES[wrap(scaleIndex + delta, SCALES.length)].id;
  }
  if (index === 2) settings.colorDepth = clamp(settings.colorDepth + delta, 0, 2);
  if (index === 3) settings.extensionBias = clamp(settings.extensionBias + delta, 0, 2);
  if (index === 4) settings.inversionBias = clamp(settings.inversionBias + delta, 0, 3);
  if (index === 5) settings.spread = clamp(settings.spread + delta, 0, 2);
  if (index === 6) settings.strumMs = clamp(settings.strumMs + delta * 5, 0, 100);
  if (index === 7) settings.rate = clamp(settings.rate + delta, 0, 4);
  const after = [settings.key, settings.scaleId, settings.colorDepth,
    settings.extensionBias, settings.inversionBias, settings.spread,
    settings.strumMs, settings.rate][index];
  if (after === before) return;
  if (index === 6 || index === 7) configureDsp();
  updateCandidatesAndSlots(index === 0);
  const values = [KEY_NAMES[settings.key], getScale(settings.scaleId).name,
    ['STRICT', 'BLEND', 'WIDE'][settings.colorDepth], settings.extensionBias,
    settings.inversionBias, settings.spread, `${settings.strumMs}ms`, RATE_LABELS[settings.rate]];
  showOverlay(`${PARAMETER_LABELS[index]}: ${values[index]}`);
  announce(`${PARAMETER_LABELS[index]} ${values[index]}`);
}

function editMenu(delta) {
  if (!delta) return;
  if (!menuEditing) {
    menuCursor = wrap(menuCursor + delta, MENU_ITEMS.length);
    announceMenuItem(MENU_ITEMS[menuCursor], menuValue(menuCursor));
    dirty = true;
    return;
  }
  const settings = state.settings;
  const before = menuValue(menuCursor);
  if (menuCursor === 0) settings.channel = clamp(settings.channel + delta, 0, 15);
  if (menuCursor === 1) settings.route = ROUTES[wrap(ROUTES.indexOf(settings.route) + delta, ROUTES.length)];
  if (menuCursor === 2) settings.previewRoute = ROUTES[wrap(ROUTES.indexOf(settings.previewRoute) + delta, ROUTES.length)];
  if (menuCursor === 3) settings.gate = clamp(settings.gate + delta * 5, 10, 100);
  if (menuValue(menuCursor) === before) return;
  if (menuCursor === 0 || menuCursor === 1 || menuCursor === 3) configureDsp();
  else sendCommand({ op: 'panic' }, true);
  scheduleSave();
  announceMenuItem(MENU_ITEMS[menuCursor], menuValue(menuCursor));
  queueLedRefresh();
  dirty = true;
}

function pollDsp() {
  if (typeof host_module_get_param !== 'function') return;
  let next;
  try { next = JSON.parse(host_module_get_param('state') || 'null'); } catch (_error) { return; }
  if (!next || next.v !== 1) return;
  const nextRunning = Boolean(next.running);
  const parsedStep = Number(next.step);
  const nextStep = Number.isFinite(parsedStep) ? parsedStep : -1;
  if (nextRunning !== running || nextStep !== loopStep) {
    running = nextRunning;
    loopStep = nextStep;
    if (running && loopStep >= 0 && state.progression[loopStep]) {
      const chord = state.progression[loopStep];
      displayChord = semanticChord(chord);
      currentLabel = nameChord(chord, { key: state.settings.key, scaleId: state.settings.scaleId });
      currentCategory = `STEP ${loopStep + 1}/${progressionLength(state.progression)}`;
    }
    queueLedRefresh();
    dirty = true;
  }
}

function cycleExplorationMode() {
  state.settings.mode = nextExplorationMode(state.settings.mode);
  refreshCandidates();
  scheduleSave();
  const label = MODE_LABELS[state.settings.mode];
  showOverlay(`MODE: ${label}`);
  announce(`${label} mode`);
}

function primeCaptureIndex() {
  for (let offset = 0; offset < 8; offset += 1) {
    const index = (state.captureIndex + offset) % 8;
    if (!state.progression[index]) {
      state.captureIndex = index;
      return true;
    }
  }
  return false;
}

globalThis.init = function init() {
  state = createUiState(loadSettings());
  focusPc = null;
  currentChord = null;
  currentNotes = [];
  recentChords = [];
  lastAuditioned = null;
  displayChord = null;
  topNotePc = null;
  if (state.settings.mode === 'root') {
    focusPc = state.settings.key;
    currentLabel = 'Root ' + KEY_NAMES[focusPc];
    currentCategory = 'ROOT VOICINGS';
  } else {
    focusPc = null;
    currentLabel = 'Choose a chord';
    currentCategory = 'CHORD FINDER';
  }
  running = false;
  loopStep = -1;
  selectedSlot = -1;
  deleteHeld = false;
  shiftHeld = false;
  captureArmed = false;
  menuOpen = false;
  menuCursor = 0;
  menuEditing = false;
  saveCountdown = -1;
  heldLeft = Array(16).fill(false);
  commandSequence = 0;
  commandQueue = [];
  liveOwners = new Set();
  parkedLastTick = false;
  overlayText = '';
  overlayCountdown = 0;
  pollCountdown = 1;
  forceLedPaint = true;
  configureDsp();
  syncAllSlots();
  refreshCandidates();
  announceMenuItem('Chord Finder', getScale(state.settings.scaleId).name);
  draw();
};

globalThis.tick = function tick() {
  flushCommandQueue();
  if (globalThis.overtakeParked) {
    if (!parkedLastTick) {
      for (const owner of [...liveOwners]) stopVoice(owner);
      parkedLastTick = true;
    }
    if (saveCountdown >= 0 && --saveCountdown === 0) saveSettings();
    return;
  }
  if (parkedLastTick) {
    parkedLastTick = false;
    forceLedPaint = true;
    queueLedRefresh();
  }
  if (--pollCountdown <= 0) {
    pollCountdown = 6;
    pollDsp();
  }
  if (saveCountdown >= 0 && --saveCountdown === 0) saveSettings();
  if (overlayCountdown > 0 && --overlayCountdown === 0) {
    overlayText = '';
    dirty = true;
  }
  drainLedQueue();
  if (dirty) draw();
};

globalThis.onMidiMessageInternal = function onMidiMessageInternal(data) {
  if (!data) return;
  const type = data[0] & 0xF0;
  const d1 = data[1] | 0;
  const d2 = data[2] | 0;
  if (type === MidiCC && d1 === MoveShift) {
    shiftHeld = d2 > 0;
    return;
  }
  if (shouldFilterMessage(data)) return;
  const pressed = type === MidiNoteOn && d2 > 0;
  const released = type === MidiNoteOff || (type === MidiNoteOn && d2 === 0);

  if (pressed || released) {
    const left = leftPadIndex(d1);
    const right = rightPadIndex(d1);
    if (left >= 0) {
      if (pressed && shiftHeld) toggleTopNote(left);
      else handleLeftPad(left, pressed, d2);
      return;
    }
    if (right >= 0) { handleRightPad(right, pressed, d2); return; }
    if (d1 >= 16 && d1 <= 23) { handleStep(d1 - 16, pressed, d2); return; }
  }
  if (type !== MidiCC) return;

  if (d1 === MoveDelete) { deleteHeld = d2 > 0; return; }
  if (d2 <= 0 && d1 !== MoveMainKnob) return;
  if (d1 === MoveCapture && d2 > 0) {
    if (!captureArmed && !primeCaptureIndex()) {
      showOverlay('PROGRESSION FULL');
      announce('Progression full');
      return;
    }
    captureArmed = !captureArmed;
    queueLedRefresh();
    announce(captureArmed ? 'Capture append on' : 'Capture append off');
    return;
  }
  if (d1 === MovePlay && d2 > 0) {
    if (!running && progressionLength(state.progression) === 0) {
      showOverlay('NO CHORDS TO LOOP');
      announce('No chords to loop');
      return;
    }
    running = !running;
    sendCommand({ op: 'transport', running: running ? 1 : 0 }, true);
    queueLedRefresh();
    announce(running ? 'Progression playing' : 'Progression stopped');
    return;
  }
  if (d1 === MoveMenu && d2 > 0) {
    menuOpen = !menuOpen;
    menuEditing = false;
    dirty = true;
    announce(menuOpen ? 'Chord Finder settings' : 'Chord Finder');
    return;
  }
  if (d1 === MoveMainButton && d2 > 0) {
    if (!menuOpen) {
      cycleExplorationMode();
      return;
    }
    if (menuCursor === 4) {
      sendCommand({ op: 'output_test', route: liveRoute(), channel: state.settings.channel }, true);
      announce(`Testing ${ROUTE_LABELS[state.settings.previewRoute]} channel ${state.settings.channel + 1}`);
      return;
    }
    menuEditing = !menuEditing;
    dirty = true;
    announce(menuEditing ? 'Editing ' + MENU_ITEMS[menuCursor] : 'Selection mode');
    return;
  }
  if (d1 === MoveMainKnob && menuOpen) { editMenu(decodeDelta(d2)); return; }
  if (d1 === MoveUp && d2 > 0) {
    const next = clamp(state.settings.octave + 1, -3, 3);
    if (next === state.settings.octave) return;
    state.settings.octave = next;
    updateCandidatesAndSlots(true);
    announce('Octave ' + state.settings.octave);
    return;
  }
  if (d1 === MoveDown && d2 > 0) {
    const next = clamp(state.settings.octave - 1, -3, 3);
    if (next === state.settings.octave) return;
    state.settings.octave = next;
    updateCandidatesAndSlots(true);
    announce('Octave ' + state.settings.octave);
    return;
  }
  if (d1 >= MoveKnob1 && d1 <= MoveKnob8) updateEncoder(d1 - MoveKnob1, d2);
};

globalThis.onMidiMessageExternal = function onMidiMessageExternal(_data) {};

globalThis.onResume = function onResume() {
  configureDsp();
  syncAllSlots();
  if (running) sendCommand({ op: 'transport', running: 1 }, true);
  forceLedPaint = true;
  queueLedRefresh();
  dirty = true;
};

globalThis.onUnload = function onUnload() {
  for (const owner of [...liveOwners]) stopVoice(owner);
  sendCommand({ op: 'panic' }, true);
  flushCommandQueue();
  saveSettings();
  for (let attempt = 1; attempt < 3 && saveCountdown !== -1; attempt += 1) saveSettings();
};
