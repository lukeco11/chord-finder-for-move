import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../src/ui.js', import.meta.url), 'utf8');

test('imports upgraded UI state through a cache-safe module generation', () => {
  assert.match(source, /from '\.\/ui_state_v7\.mjs';/);
});

test('first DSP poll establishes a baseline without replacing the forced startup LED queue', () => {
  const initBody = source.match(/globalThis\.init = function init\(\) \{([\s\S]*?)\n\};/)?.[1] ?? '';

  assert.match(source, /let dspStateSeen = false;/);
  assert.match(source, /function pollDsp\(\)[\s\S]{0,700}if \(!dspStateSeen\) \{[\s\S]{0,260}dspStateSeen = true;[\s\S]{0,260}return;/);
  assert.match(initBody, /dspStateSeen = false;/);
  assert.match(initBody, /forceLedPaint = true;[\s\S]{0,180}refreshCandidates\(\);/);
});

test('key and octave changes rebuild current absolute notes before candidate ranking', () => {
  assert.match(source, /if \(transposeSlots && currentChord\) currentNotes = slotNotes\(currentChord\);[\s\S]{0,160}refreshCandidates\(\);/);
});

test('main display renders the live piano-key visualization', () => {
  assert.match(source, /import \{[^}]*createDisplayVoiceState[^}]*keyboardState[^}]*\} from '\.\/keyboard_v2\.mjs';/s);
  assert.match(source, /drawPianoKeyboard\(\);/);
});

test('voice releases and Move transport stop recompute only the relevant display voice', () => {
  assert.match(source, /function stopVoice\(owner\)[\s\S]{0,180}hideDisplayVoice\(owner\);/);
  assert.match(source, /if \(!running\)[\s\S]{0,160}hideDisplayVoice\(LOOP_DISPLAY_OWNER\);/);
  assert.doesNotMatch(source, /if \(!running\)[\s\S]{0,180}clearVisualVoices/);
});

test('Move Play arms the progression without independently toggling it off', () => {
  const playBody = source.match(/if \(d1 === MovePlay && d2 > 0\) \{([\s\S]*?)\n  \}/)?.[1] ?? '';

  assert.match(source, /let loopArmed = false;/);
  assert.match(playBody, /sendCommand\(\{ op: 'transport', running: 1 \}/);
  assert.doesNotMatch(playBody, /running\s*=\s*!running|running:\s*0/);
});

test('DSP polling distinguishes armed wait from active Move playback', () => {
  assert.match(source, /const nextArmed = Boolean\(next\.armed\);/);
  assert.match(source, /loopArmed = nextArmed;/);
  assert.match(source, /running \? 'PLAY' : \(loopArmed \? 'WAIT' : 'OFF'\)/);
  assert.match(source, /RATE_SHORT_LABELS = \['16', '8', '4', '2', '1B'\]/);
});

test('only full unload disarms transport before panic cleanup', () => {
  const unloadBody = source.match(/globalThis\.onUnload = function onUnload\(\) \{([\s\S]*?)\n\};/)?.[1] ?? '';
  const parkedBody = source.match(/if \(globalThis\.overtakeParked\) \{([\s\S]*?)\n  \}/)?.[1] ?? '';

  assert.match(unloadBody, /sendCommand\(\{ op: 'transport', running: 0 \}/);
  assert.ok(unloadBody.indexOf("op: 'transport'") < unloadBody.indexOf("op: 'panic'"));
  assert.doesNotMatch(parkedBody, /op: 'transport'/);
});

test('loop polling invalidates on each DSP cycle and handles an empty running loop', () => {
  assert.match(source, /nextCycle !== loopCycle/);
  assert.match(source, /running && loopStep < 0[\s\S]{0,220}hideDisplayVoice\(LOOP_DISPLAY_OWNER\);/);
});

test('every UI command that triggers DSP panic clears all display voices', () => {
  assert.match(source, /function clearVisualVoices\([\s\S]{0,260}clearDisplayVoices\(displayVoices\)/);
  assert.match(source, /menuCursor === 0 \|\| menuCursor === 1 \|\| menuCursor === 2[\s\S]{0,180}clearVisualVoices/);
});

test('key and octave edits do not transpose active display voices', () => {
  const updateBody = source.match(/function updateCandidatesAndSlots\(transposeSlots\) \{([\s\S]*?)\n\}/)?.[1] || '';
  assert.doesNotMatch(updateBody, /displayNotes\s*=|showDisplayVoice|startDisplayVoice/);
});

test('bass, root, and top markers use distinct key-relative positions', () => {
  assert.match(source, /marker\.position === 'center'[\s\S]{0,120}Math\.floor\(key\.width \/ 2\)[\s\S]{0,160}marker\.position === 'right'[\s\S]{0,120}key\.width/);
});

test('played roots refresh candidates before revoicing held right pads', () => {
  assert.match(source, /function handleLeftPad\(index, pressed, velocity\)[\s\S]{0,900}refreshCandidates\(\);\s*revoiceHeldRightPads\(\);/);
  const updateBody = source.match(/function updateCandidatesAndSlots\(transposeSlots\) \{([\s\S]*?)\n\}/)?.[1] || '';
  assert.doesNotMatch(updateBody, /revoiceHeldRightPads/);
});

test('held chord replacements reuse owners, update display, and append Capture steps', () => {
  assert.match(source, /function revoiceHeldRightPads\(\)[\s\S]{0,180}revoiceHeldCandidates\(state, state\.candidates\)/);
  assert.match(source, /playVoice\(16 \+ index, next\.notes, heldRightVelocity\[index\]\)/);
  assert.match(source, /showDisplayVoice\(16 \+ index,[\s\S]{0,420}if \(captureArmed\) appendChord\(next\);/);
});

test('right-pad velocity and held intent clear on release and lifecycle cleanup', () => {
  assert.match(source, /function clearHeldPadIntent\(\)[\s\S]{0,180}clearHeldCandidates\(state\)[\s\S]{0,120}heldRightVelocity\.fill\(100\)/);
  assert.match(source, /handleRightPad\(index, pressed, velocity\)[\s\S]{0,260}heldRightVelocity\[index\][\s\S]{0,900}releaseCandidate\(state, index\)[\s\S]{0,120}heldRightVelocity\[index\] = 100/);
  assert.match(source, /if \(!parkedLastTick\)[\s\S]{0,240}clearHeldPadIntent\(\)/);
});

test('preview and progression routing both expose Schwung', () => {
  assert.match(source, /rightPadIndex, PREVIEW_ROUTES, ROUTES, takeLedBatch/);
  assert.match(source, /menuCursor === 1[\s\S]{0,180}ROUTES[\s\S]{0,220}menuCursor === 2[\s\S]{0,180}PREVIEW_ROUTES/);
});

test('piano renders a register-aware two-octave viewport and overflow counts', () => {
  assert.match(source, /keyboardState\(displayNotes, displayRootPitchClass\(\),[\s\S]{0,100}state\.settings\.octave/);
  assert.match(source, /for \(const key of keyboard\.whiteKeys\)/);
  assert.match(source, /for \(const key of keyboard\.blackKeys\)/);
  assert.match(source, /key\.octaveLabel/);
  assert.match(source, /keyboard\.overflowBelow/);
  assert.match(source, /keyboard\.overflowAbove/);
});

test('all sounding piano keys fill solid while idle black keys remain outlined', () => {
  assert.match(source, /for \(const key of keyboard\.blackKeys\) \{[\s\S]{0,220}fill_rect\([^\n]*key\.sounding \? 1 : 0\);[\s\S]{0,120}draw_rect\(/);
  assert.match(source, /function markerColor\([^)]*\) \{[\s\S]{0,100}return sounding \? 0 : 1;/);
});

test('DSP configuration reports whether active native injection is supported', () => {
  assert.match(source, /hostSupportsActiveMoveInject\(globalThis\)/);
  assert.match(source, /function configureDsp\(\)[\s\S]{0,300}move_available: moveAvailable \? 1 : 0/);
});
