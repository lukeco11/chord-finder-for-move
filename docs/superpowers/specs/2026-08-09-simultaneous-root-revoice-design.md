# Simultaneous Root Revoice Design

## Goal

Let a player strike a left root pad and a right chord pad as one gesture without
depending on which MIDI event Move delivers first. A held right chord must
immediately follow later left-root changes so the player can audition root and
chord movement fluidly.

## Interaction

- A right pad always plays immediately using its current candidate assignment.
- A left-pad press plays its scale note, focuses that pitch class as the root,
  and refreshes the right-pad candidates.
- After refresh, every physically held right pad is replaced with the candidate
  at the same right-pad index for the new root.
- Replacement uses the existing DSP owner. The DSP releases the prior owner's
  notes before starting the replacement, including shared pitches and pending
  strums.
- The left root note continues sounding alongside the revoiced chord.
- The held snapshot, chord label, category, and piano visualization all change
  to the replacement chord. Releasing the right pad stops that latest snapshot.
- Repeated left-root presses while a right pad remains held produce successive
  immediate revoices.

Move serializes simultaneous pad input. If the right event arrives first, the
old-root chord can sound briefly before the left event revoices it. If the left
event arrives first, the right pad starts directly on the new-root chord. No
artificial input delay is introduced.

## Capture

Capture records the audible sequence rather than rewriting history:

- The initial right-pad chord appends to the next progression slot.
- Every root-driven revoice appends the replacement chord to the following
  available slot.
- Repeated root changes append repeated progression steps in event order.
- If several right pads are held, replacements append in ascending physical-pad
  order for deterministic results.
- Existing full-progression behavior remains unchanged: Capture turns off when
  no empty slot remains, while live revoicing continues.
- Consequently, a right-first simultaneous gesture records both audible chord
  states; a left-first gesture records only the already-resolved chord.

## State And Data Flow

The UI keeps physical right-pad intent separate from candidate contents. A pure
UI-state helper receives the refreshed candidate list, replaces snapshots only
for held right indexes, and returns ordered replacement records containing the
index, previous snapshot, and new snapshot.

For each replacement, `src/ui.js`:

1. Sends `voice_on` with the same owner (`16 + rightPadIndex`) and new notes.
2. Updates the display voice using the new semantic chord and press-time root.
3. Makes the replacement the latest auditioned chord.
4. Appends it through the existing Capture path when Capture is armed.

Candidate generation and DSP note ownership do not change.

## Edge Cases

- If a held pad has no replacement candidate, its old voice is stopped and its
  physical held intent remains available for a later root that has a candidate.
- A right-pad release clears both its physical intent and current snapshot,
  whether or not a replacement was available.
- Panic, route changes, transport stop, suspend, and unload clear held intent as
  they do other live voice state.
- Candidate refreshes caused by encoders, progression context, or top-note
  settings do not revoice held chords. Only a played left-root press does so.

## Tests

- Right-first then left-root replaces the held snapshot at the same pad index.
- Left-first then right starts from the refreshed root without an extra revoice.
- Repeated roots replace the same DSP owner and preserve release correctness.
- Multiple held right pads replace and capture in ascending pad order.
- Missing replacement candidates stop the old snapshot but retain held intent.
- Capture appends the immediate chord and every subsequent revoice to successive
  slots, without overwriting earlier steps.
- A full progression disables Capture but does not interrupt live revoicing.
- UI contract tests verify revoicing happens only after the root refresh and
  before LED/display completion.
