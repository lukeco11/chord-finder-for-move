import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../src/ui.js', import.meta.url), 'utf8');

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
