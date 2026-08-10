# Chord Finder for Ableton Move

Chord Finder is an independent [Schwung](https://github.com/charlesvestal/schwung)
takeover tool for exploring scale-aware chords and recording the resulting MIDI.
The left half of Move's pad grid plays notes and chooses a root; the right half
offers 16 deterministic chord candidates. Eight semantic progression slots can
be auditioned or looped while the UI is suspended.

This is unofficial software for users already comfortable installing Schwung
and recovering their Move. It does not modify Move or XMOS firmware.

## Requirements

- Ableton Move 1.8 or newer
- Schwung 0.11.6 or newer
- A Move track with an instrument for native audition
- Docker for cross-compilation, or an `aarch64-linux-gnu-gcc` toolchain

## Build and install

```sh
./scripts/build.sh
./scripts/install.sh
```

`scripts/build.sh` creates `dist/chord-finder-module.tar.gz`. The installer uses
`MOVE_HOST` and `MOVE_USER` when set, defaulting to `move.local` and `ableton`.
It uploads the complete archive, preserves `settings.json`, and atomically
exchanges staged and live module directories with Linux `renameat2` so a failed
upgrade cannot expose a mixed UI/DSP version or remove the live module.

## Move setup

1. Load an instrument on a Move track.
2. Set that track's MIDI input channel to Chord Finder's configured channel.
3. Open **Tools > Chord Finder**.
4. Use the left 4x4 pads to focus roots and the right 4x4 pads to audition chords.
5. Audition a chord, then use Shift + Step 1-8 to store it. Delete + Step clears.
6. Press Capture for append mode and Play for equal-step loop playback.

For DAW recording over the USB-C Standalone Port, set the same Move track MIDI
output channel and select `MOVE/USB-C` or `BOTH`. This path relies on Move track
forwarding injected notes. It must be verified on the target firmware using
[docs/hardware-validation.md](docs/hardware-validation.md). Until that passes,
use `USB-A` for DAW capture and `MOVE/USB-C` only for native audition.

## Controls

| Control | Function |
| --- | --- |
| Encoders 1-8 | Key, Scale, Color, Extension, Inversion, Spread, Strum, Rate |
| Up / Down | Octave range |
| Main jog click | Cycle ROOT, NEXT, and VOICE exploration modes |
| Shift + left pad | Toggle that pitch as the required top note |
| Step 1-8 | Preview a stored chord; select an empty gap for contextual suggestions |
| Shift + Step | Store the held or last-auditioned chord |
| Delete + Step | Clear slot |
| Capture | Toggle append capture |
| Play | Start/stop progression and pass through to Move |
| Menu | MIDI channel, routes, gate, and a short output test |
| Back | Suspend Chord Finder while DSP playback continues |
| Shift + Back | Fully exit and panic all notes |

Saved slots contain chord meaning rather than absolute MIDI notes, so key and
octave changes transpose the entire progression.

In ROOT mode, pressing a left pad latches its root and produces 16 chord types
and voicings on the right. Auditioning a right pad does not remap the others.
NEXT mode ranks likely continuations with real MIDI-register voice leading;
selecting an empty Step slot also considers the nearest chord on both sides.
VOICE mode keeps the harmony fixed and changes inversion, spread, and register.
The display's `LOOP STOP` label means progression playback is idle.
Rate sets each slot's tempo-synchronized duration, from 1/16 note through one
bar; it does not change the auditioned chord itself.

## Development

```sh
npm test
```

The JavaScript suites test harmony, deterministic ranking, persistence, pad
mapping, snapshots, and LED batching. The native C harness tests routes, voice
release, route-change cleanup, strum scheduling, progression playback, and DSP
state. The rules and fixtures in this repository are original and do not copy
commercial chord databases or branding.
