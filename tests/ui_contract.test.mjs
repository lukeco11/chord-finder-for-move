import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../src/ui.js', import.meta.url), 'utf8');

test('imports upgraded UI state through a cache-safe module generation', () => {
  assert.match(source, /from '\.\/ui_state_v4\.mjs';/);
});

test('first DSP poll establishes a baseline without replacing the forced startup LED queue', () => {
  assert.match(source, /let dspStateSeen = false;/);
  assert.match(source, /function pollDsp\(\)[\s\S]{0,700}if \(!dspStateSeen\) \{[\s\S]{0,260}dspStateSeen = true;[\s\S]{0,260}return;/);
  assert.match(source, /globalThis\.init = function init\(\)[\s\S]{0,1400}dspStateSeen = false;[\s\S]{0,500}forceLedPaint = true;[\s\S]{0,180}refreshCandidates\(\);/);
});

test('key and octave changes rebuild current absolute notes before candidate ranking', () => {
  assert.match(source, /if \(transposeSlots && currentChord\) currentNotes = slotNotes\(currentChord\);[\s\S]{0,160}refreshCandidates\(\);/);
});

test('main display renders the live piano-key visualization', () => {
  assert.match(source, /import \{[^}]*createDisplayVoiceState[^}]*keyboardState[^}]*\} from '\.\/keyboard\.mjs';/s);
  assert.match(source, /drawPianoKeyboard\(\);/);
});

test('voice releases and transport stop recompute the sounding-note display', () => {
  assert.match(source, /function stopVoice\(owner\)[\s\S]{0,180}hideDisplayVoice\(owner\);/);
  assert.match(source, /if \(!running\)[\s\S]{0,160}clearVisualVoices\('Progression stopped'/);
});

test('loop polling invalidates on each DSP cycle and handles an empty running loop', () => {
  assert.match(source, /nextCycle !== loopCycle/);
  assert.match(source, /running && loopStep < 0[\s\S]{0,220}hideDisplayVoice\(LOOP_DISPLAY_OWNER\);/);
});

test('every UI command that triggers DSP panic clears all display voices', () => {
  assert.match(source, /function clearVisualVoices\([\s\S]{0,260}clearDisplayVoices\(displayVoices\)/);
  assert.match(source, /if \(!running\)[\s\S]{0,180}clearVisualVoices\('Progression stopped'/);
  assert.match(source, /menuCursor === 0 \|\| menuCursor === 1 \|\| menuCursor === 2[\s\S]{0,180}clearVisualVoices/);
});

test('key and octave edits do not transpose active display voices', () => {
  const updateBody = source.match(/function updateCandidatesAndSlots\(transposeSlots\) \{([\s\S]*?)\n\}/)?.[1] || '';
  assert.doesNotMatch(updateBody, /displayNotes\s*=|showDisplayVoice|startDisplayVoice/);
});

test('black-key bass, root, and top markers use separated spans', () => {
  assert.match(source, /if \(key\.black\)[\s\S]{0,220}x = key\.x \+ 1;[\s\S]{0,120}x = key\.x \+ 4;[\s\S]{0,120}x = key\.x \+ 7;/);
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
