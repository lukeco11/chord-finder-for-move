# Chord Finder MIDI Routing Repair

## Context

Chord Finder 0.4.2 sends native Move notes through the Schwung
`midi_inject_to_move` host callback. Schwung 0.12.0 changed the shared MIDI
injection queue so an active overtake consumes every queued packet as simulated
input. Chord Finder's generated notes therefore return to its own no-op MIDI
handler while the takeover is open, then reach Move only after the takeover is
suspended.

Chord Finder also builds USB-A packets with cable 0. Schwung reserves cable 0
for the Move control surface; musical USB-A output must use cable 2. The current
unit tests validate callback invocation but preserve this incorrect packet
header.

## Goals

- Restore native Move audition and progression playback while Chord Finder's
  takeover is visible.
- Send USB-A note traffic on the correct USB-MIDI cable.
- Add Schwung Chain as a live-preview destination without expanding the saved
  progression output matrix.
- Prevent generated native notes from accumulating for delayed playback on
  known-incompatible Schwung hosts.
- Preserve settings and progression compatibility with Chord Finder 0.4.2.

## Non-Goals

- Schwung Chain will not become a progression playback destination in this
  change.
- `Both` will continue to mean Move/USB-C plus USB-A.
- The host plugin ABI and the test-bus shared-memory ABI will not change.
- This work will not add per-slot routes or a general MIDI routing matrix.

## Chord Finder Changes

### Destination Model

The DSP will track three physical destinations: native Move, USB-A, and Schwung
Chain. Native Move continues to call `midi_inject_to_move`. USB-A calls
`midi_send_external` with cable 2. Schwung Chain calls `midi_send_internal`
with a standard four-byte USB-MIDI packet.

The destination reference-count and pending-note-off tables will expand from
two to three destinations. Voice replacement, route changes, panic, pending
note-off retries, and unload cleanup will apply identically to each
destination.

Saved progression output keeps the existing values:

- `move`: native Move and potential USB-C track forwarding
- `external`: USB-A
- `both`: native Move plus USB-A

Live preview adds one value:

- `schwung`: matching Schwung Chain slots through `midi_send_internal`

The settings menu will label this choice `SCHWUNG`. Its help text will state
that a sound-generator slot must listen on the selected MIDI channel. Existing
saved settings require no migration because the new value is additive.

### Host Compatibility

The corrected Schwung host will expose a JavaScript capability sentinel named
`shadow_overtake_move_inject_active`. Chord Finder will classify a host as the
known broken range when `shadow_inbound_pad_midi_active` exists but the new
sentinel does not. Schwung 0.11.6 predates both signals and retains its working
native injection behavior.

On a known-broken host, the UI will tell the DSP that native injection is
unavailable. The DSP will reject native sends instead of placing notes in the
shared queue, preventing a burst when the user suspends the takeover. USB-A and
Schwung preview remain usable. The display/help state will identify the native
route as unavailable rather than silently accepting notes.

## Schwung Host Changes

### Separate Producer Queues

The existing `/schwung-midi-inject` shared-memory queue remains the test-bus
and JavaScript injection path. During an active overtake, it continues to feed
simulated input to the takeover. Outside overtake mode, it continues to feed
Move firmware.

Overtake DSP `host_api.midi_inject_to_move` will no longer publish to that
shared queue. It will publish to a separate bounded in-process packet ring.
That ring is dedicated to DSP-generated output and is always consumed by
Move's MIDI input path, including while an overtake is active.

The new ring will use fixed storage, bounded push/drain loops, and no logging,
allocation, locks, or system calls on the audio thread. Queue-full returns zero
through the existing callback contract so Chord Finder's pending-note-off
retries remain effective.

### Safe Drain

The dedicated ring will be drained through the same MIDI_IN collision and
quiet-frame safeguards used by the existing injection path. Dedicated DSP
output has priority over test-bus-to-Move packets, while the shim's one-shot
transition-release packet retains highest priority. Packets that cannot fit in
the current frame remain queued; they are not overwritten.

The existing `midi_inject_to_move` plugin ABI remains unchanged. Only the
overtake host callback wiring changes. Chain modules and JavaScript callers
retain their current behavior.

Schwung will expose `shadow_overtake_move_inject_active()` as a capability
sentinel once the dedicated route is installed.

## Testing

Chord Finder DSP regression tests will prove:

- USB-A note-on and note-off packets use cable 2.
- Native packets use `midi_inject_to_move` and do not use the external callback.
- Schwung preview uses `midi_send_internal`.
- Reference counts, retries, route replacement, and panic work independently
  for all three destinations.
- Native output is suppressed when the UI marks the host incompatible.

UI and settings tests will prove:

- `schwung` is accepted only as a preview route.
- Existing 0.4.2 settings load unchanged.
- Known-broken-host detection is deterministic.
- The user receives an unavailable-route indication without changing their
  saved route behind their back.

Schwung host tests will reproduce the regression before the fix and prove that:

- Test-bus packets reach an active takeover and do not reach Move.
- Overtake DSP output reaches Move while the takeover remains active.
- Suspending the takeover does not release a delayed backlog.
- Queue-full and MIDI_IN-busy behavior retain packets or report failure without
  corrupting either queue.

On-device validation will cover one complete note-on/off pair on each route,
rapid chord replacement, panic, active-to-suspended transitions, and native,
USB-A, and Schwung Chain auditioning.

## Delivery

The Schwung host repair will be submitted upstream as a focused pull request.
Chord Finder will receive its module-side routing changes and tests in a
separate release. Until the repaired Schwung version is published, Chord
Finder's compatibility documentation will name Schwung 0.12.0 and 0.12.1 as
having unavailable native injection while takeover is active.
