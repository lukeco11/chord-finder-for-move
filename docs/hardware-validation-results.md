# Hardware validation results

## 2026-08-06 deployment (version 0.1.0)

- Host: `move.local`
- Architecture: `aarch64`
- Schwung: `0.11.6`
- AbletonOS: `abletonos-aarch64-rpi4-v3.18`
- Move application version: not exposed by the read-only probe
- Install path: `/data/UserData/schwung/modules/tools/chord-finder`
- Result: module, help, JavaScript dependencies, documentation, and `dsp.so`
  installed successfully
- Integrity: SHA-256 values for all runtime files match the local release build
- DSP artifact: ARM aarch64 ELF shared object exporting `move_plugin_init_v2`

## Automated evidence

- Harmony and UI-state tests: 14 passing
- Native DSP harness: passing with `-Wall -Wextra -Werror`
- Address/undefined behavior sanitizer harness: passing
- Route fan-out, shared-pitch references, rapid replacement, pending-strum
  cancellation, send failure, loop playback, and panic paths covered
- Release archive generated with the required top-level `chord-finder/` layout

## Physical checks still required

- Open Chord Finder from the Schwung Tools menu and verify display/LED mappings
- Confirm native Move-track audition and note cleanup
- Record the three-note spike through USB-A
- Record the three-note spike through native track forwarding and USB-C Standalone
- Confirm Play/Record passthrough, suspend/resume, and ten-minute loop behavior
- Measure pad-to-note latency and confirm the typical value is below 15 ms

USB-C DAW capture is not release-validated until the three-note forwarding test
passes. No Move or XMOS firmware modifications were made.

## Version 0.2.0 status

### 2026-08-09 deployment

- Installed version 0.2.0 on `move.local` using an atomic
  `renameat2(RENAME_EXCHANGE)` upgrade.
- Validated the exchange helper separately on the Move with two temporary
  directories before upgrading the live module.
- All nine installed runtime files match the local release build by SHA-256.
- The pre-upgrade `settings.json` SHA-256 remained unchanged after installation.
- No installer staging directory or uploaded archive remained on the device.
- The release DSP and installer helper are ARM aarch64 ELF artifacts.
- Thirty JavaScript tests, the native DSP harness, package checks, and the DSP
  AddressSanitizer/UndefinedBehaviorSanitizer run passed.

The module was physically reopened after installation. Schwung logged the new
UI and DSP loading successfully, followed by many pad auditions whose screen
reader labels included root, suspended, ninth, diminished, and color chords.
No Chord Finder load error appeared. The new UI migrated and saved the preserved
settings as schema version 2 with all eight progression slots intact.

Native audible output, USB-A capture, USB-C DAW forwarding, latency, and the
ten-minute loop still require direct listening/recording checks; log and display
evidence cannot satisfy those remaining hardware acceptance items.
