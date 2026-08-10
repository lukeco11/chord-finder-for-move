#!/usr/bin/env sh
set -eu

mkdir -p build/tests
cc -std=c11 -Wall -Wextra -Werror -Isrc/vendor \
  tests/dsp/test_chord_finder.c src/dsp/chord_finder.c \
  -o build/tests/test_chord_finder
build/tests/test_chord_finder
