import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../src/ui.js', import.meta.url), 'utf8');

test('key and octave changes rebuild current absolute notes before candidate ranking', () => {
  assert.match(source, /if \(transposeSlots && currentChord\) currentNotes = slotNotes\(currentChord\);\s*refreshCandidates\(\);/);
});
