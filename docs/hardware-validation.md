# Hardware validation

Record the Move firmware, Schwung version, DAW, computer OS, and interface path
for every run. The release target is Move 2.0.5 with Schwung 0.11.6; Move 1.8+
is the supported baseline.

## Three-note routing spike

1. Build and install the module, then load an instrument on a native Move track.
2. Set Chord Finder and the track MIDI input to channel 1.
3. Select preview route `MOVE/USB-C`, choose `TEST OUTPUT`, and click the jog.
4. Confirm all three notes sound on the native track and release cleanly.
5. Connect Move's USB-C Standalone Port to the DAW and enable MIDI input.
6. Set the native track MIDI output to channel 1 and repeat the triad.
7. Confirm the DAW records exactly three note-ons and three matching note-offs.
8. Repeat with `USB-A` and `BOTH`; verify `BOTH` produces one matching pair at
   each destination without doubled native monitoring.

Do not claim USB-C support if step 7 fails. Ship USB-A capture plus native Move
audition and leave the firmware path unchanged.

## Regression matrix

- Native Move audition on every channel
- USB-A recording and cable unplug/reconnect
- USB-C recording through native track forwarding
- Play and Record passthrough to Move transport
- ROOT/NEXT/VOICE mode cycling and stable right-pad assignments during audition
- Shift + left-pad top-note constraints and empty-step gap suggestions
- Piano display highlights for left notes, chord auditions, inversions, and loop steps
- Bass, root, and top markers on both white and black keys
- Candidate refresh while a chord remains held
- Rapid pad replacement and shared chord tones
- Strum replacement before delayed notes have fired
- Route and channel changes while notes are held
- Delete + Step and Capture wrap after slot 8
- Suspend/resume, full exit, unload, and stop cleanup
- Reboot persistence for all eight slots and settings
- Ten-minute loop with no stuck notes
- Pad-to-note latency under 15 ms in a MIDI timestamp capture

Acceptance requires a matching note-on/off lifecycle at every enabled
destination, no stuck notes after exit, and all eight semantic slots restored.
