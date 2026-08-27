# Chord Finder for Ableton Move

Chord Finder turns Ableton Move into a hands-on chord exploration tool. The
left half of the pad grid plays notes and chooses a root. The right half gives
you 16 chords and voicings that fit that root and your selected scale.

You can try chords, hear them through a Move instrument or external MIDI
device, save up to eight chords, and play the result as a repeating
progression. The screen shows the chord name and a small piano keyboard with
the notes that are sounding.

Chord Finder is an independent module for
[Schwung](https://github.com/charlesvestal/schwung). It is not made or
supported by Ableton.

## Who it is for

Chord Finder is useful if you:

- know the key or scale of a song but are not sure which chord should come next;
- want to compare chord colors, extensions, inversions, and voicings by ear;
- want to sketch a progression directly on Move before recording MIDI in a DAW;
- want the pads and piano display to help connect chord names with notes.

It is not a replacement for Move's sequencer or a full music-theory course.
It is a fast way to audition and capture chord ideas.

## Requirements

- Ableton Move 1.8 or newer
- Schwung 0.11.6, or a host newer than 0.12.1 that includes the active
  overtake Move-injection fix
- Move and your computer connected to the same network for installation
- A Move track with an instrument, or a MIDI device connected to Move's USB-A
  port, so the generated MIDI has something to play

Schwung is unofficial software that modifies Move's software. Back up
important sets and samples and read Schwung's recovery guidance before
installing it.

Schwung 0.12.0 and 0.12.1 cannot send native Move-track MIDI while an
overtake screen is open. Chord Finder detects those hosts and disables its
`MOVE/USB-C` leg instead of queuing notes that would play later. `USB-A` and
`SCHWUNG` preview remain available. Upgrade Schwung when a release containing
`shadow_overtake_move_inject_active()` is available.

## Install with Schwung Manager

First [install Schwung](https://github.com/charlesvestal/schwung#installation)
if it is not already on your Move.

1. Turn on Move and make sure it is on the same network as your computer.
2. Open [http://move.local:7700](http://move.local:7700) in a web browser.
3. Open **Modules** in Schwung Manager.
4. Choose the option to install a custom module from a GitHub URL.
5. Enter `https://github.com/lukeco11/chord-finder-for-move`.
6. Confirm the installation and wait for Schwung Manager to finish.

You can also download `chord-finder-module.tar.gz` from the
[latest release](https://github.com/lukeco11/chord-finder-for-move/releases/latest)
and upload that tarball through the custom-module installer.

To update later, return to Schwung Manager's **Modules** page. It compares the
installed version with this repository's `release.json`.

## Open Chord Finder on Move

1. Open Schwung's Tools menu with **Shift + Volume touch + Step 13**.
2. Scroll below the divider to **Chord Finder**.
3. Press the jog wheel to load it.

Press **Back** to park Chord Finder and return to Move while leaving its
progression armed. Press **Shift + Back** to exit fully, disarm the progression,
and stop its notes.

## Make it play sound

Chord Finder generates MIDI; it does not contain its own instrument.

For a Move instrument:

1. Load an instrument on a Move track.
2. Set the track's MIDI input to the same channel used by Chord Finder. The
   default Chord Finder channel is 1.
3. In Chord Finder, open **Menu** and set **Preview Route** to `MOVE/USB-C`.
4. Press a left note pad or a right chord pad.

For an external instrument, connect it to Move's USB-A port, set **Preview
Route** to `USB-A`, and match the MIDI channels. Choose `BOTH` to send the same
notes to both destinations. The **Test Output** item in Menu plays a short test
chord and is useful when checking routing. **Export Chords** saves the stored
progression to two places:

- A new preset for
  [Impressive Chords](https://github.com/mestela/schwung-impressive-chords),
  named after the current key and scale (for example **Chord Finder A
  Lydian**, then **Chord Finder A Lydian 2** for a repeat), at
  `modules/midi_fx/impressive-chords/presets/chord_finder_<key>_<scale>.chords`.
  Every export appears as its own entry in the Impressive Chords preset list.
  Impressive Chords only reads presets when it starts or rescans, so turn its
  **Scan Presets** knob to `1` (or re-add the module to a chain) to load new
  exports.
- A standard MIDI file plus the same `.chords` text at
  `modules/tools/chord-finder/exports/chord_finder_<key>_<scale>.mid` and
  `.chords` (under `/data/UserData/schwung/` on the Move). Copy them off the
  device with `scp`, for example:
  `scp ableton@move.local:/data/UserData/schwung/modules/tools/chord-finder/exports/chord_finder_a_lydian.mid .`

To audition through a synth loaded in Schwung's signal chain, set **Preview
Route** to `SCHWUNG` and match the Chord Finder MIDI channel to the chain
slot's receive channel. Set **Output Route** to `SCHWUNG` to play the saved
progression through the same chain slot.

## Find chords

The 32 pads are divided into two halves:

- **Left 4x4:** notes from the selected scale. Pressing one plays the note and
  makes it the root for the chord choices.
- **Right 4x4:** 16 chord choices ranked for the current root or musical
  context. Brighter pads rank higher. Green shades are diatonic choices;
  yellow and orange shades are color chords such as borrowed chords.

You do not have to press and release the root before playing a chord. Hold a
right chord and press a different left note: the held chord immediately moves
to the new root. This makes it possible to play through root changes and
chords as one continuous gesture.

Press the main jog wheel to cycle through three views:

- **ROOT:** different chord types and voicings for the selected root.
- **NEXT:** suggestions for what could follow the chord you just played.
- **VOICE:** inversions, spreads, and registers of the same harmony.

Hold **Shift** and press a left pad to require that pitch as the top note of
the suggested chords. Press it the same way again to remove the constraint.

Hold **Shift** and click the main jog wheel to toggle the **Theory view**. It
replaces the piano with a theory card for the sounding chord: its spelled
tones (for example `A C# E G#`), its interval construction (`1 3 5 7`), its
harmonic function and where it tends to resolve (`DOM>I`, `SEC DOM>V`), and
your eight progression slots as roman numerals in two rows of four. During
playback the active step is highlighted, so you can watch the analysis move
through your progression. The chord name line also shows the roman numeral of
the current chord on both views.

## Build a progression

There are eight progression slots, shown on Step buttons 1-8.

- Hold a right-pad chord and press **Step 1-8** to store it in that slot. You
  can overwrite a populated slot this way.
- Hold a chord, then press **Shift + Step 1-8** to store it in that slot. You
  can also store the last chord you auditioned.
- Press a populated Step button to preview its chord.
- Press **Delete + Step** to clear a slot.
- Press **Capture** to turn on append recording. Each chord you audition is
  placed in the next empty slot. If you hold a chord and change its root, each
  audible revoicing is captured as the next step.
- Press **Play** once to arm the progression and control Move's transport. Once
  armed, Move's Play button starts and stops both Move and Chord Finder from any
  screen. Press **Back** to edit another track while the progression continues.

Chord Finder follows Move's absolute beat position, so the progression restarts
at slot 1 with Move and cannot gradually drift away from Move's sequences. The
display shows `LOOP OFF` when disarmed, `LOOP WAIT` when armed while Move is
stopped, and `LOOP PLAY` while following Move.

The **Rate** encoder changes how long each progression slot lasts, from a 1/16
note to one bar. **Gate** controls how much of that step the chord is held.
**Strum** delays the notes within each chord to create a played rather than
simultaneous attack.

Saved slots store the musical chord rather than fixed MIDI notes. Changing the
key or octave transposes the saved progression.

## Controls

| Control | What it does |
| --- | --- |
| Encoders 1-8 | Key, Scale, Color, Extension, Inversion, Spread, Strum, Rate |
| Up / Down | Move the playable range by octaves |
| Main jog click | Cycle ROOT, NEXT, and VOICE modes |
| Shift + jog click | Toggle the Theory view (chord tones, intervals, function, progression numerals) |
| Shift + left pad | Set or clear a required top note |
| Step 1-8 | Store a held right-pad chord, or preview / fill a gap |
| Shift + Step | Store the held or last-auditioned chord |
| Delete + Step | Clear a progression slot |
| Capture | Toggle append recording |
| Play | Arm the progression and start or stop Move transport |
| Back | Park Chord Finder while its armed progression follows Move |
| Shift + Back | Fully exit, disarm, and stop Chord Finder |
| Menu | MIDI channel, output routes, gate, output test, and Impressive Chords export |

## Record MIDI in a DAW

The most direct, predictable route is USB-A: connect a class-compliant USB MIDI
interface or device to Move's USB-A port, select `USB-A` or `BOTH`, and record
that MIDI in your DAW. Chord Finder sends musical USB MIDI on Schwung's cable
2 path so channel voice messages reach the external device correctly.

`MOVE/USB-C` injects notes into the configured native Move track. On Move
firmware that forwards that track through the USB-C Standalone Port, set the
track's MIDI input and output to the same Chord Finder channel, then record the
Move MIDI port in your DAW. USB-C forwarding depends on Move's track routing
and firmware; use USB-A if it does not work in your setup.

## Development

The release archive contains a JavaScript takeover UI and an aarch64 native C
DSP engine. Docker is the easiest way to cross-compile it:

```sh
git clone https://github.com/lukeco11/chord-finder-for-move.git
cd chord-finder-for-move
./scripts/build.sh
npm test
```

`./scripts/build.sh` creates `dist/chord-finder-module.tar.gz`. With SSH access
to a Move on `move.local`, `./scripts/install.sh` installs the archive while
preserving `settings.json`. Override `MOVE_HOST` and `MOVE_USER` when needed.

The harmony rules and test fixtures in this repository are original. They do
not copy commercial chord databases or branding.

## License

MIT. See [LICENSE](LICENSE).
