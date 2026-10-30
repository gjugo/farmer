#!/usr/bin/env bash
# `npm run art`: regenerate the farm art pack from tools/art/*.py into public/assets/farm/.
# Sets up tools/art/.venv on first run; prints setup steps when something it can't install is missing.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
VENV="$HERE/.venv"
MIN_PY="3.12" # the generator uses f-string syntax from Python 3.12 (PEP 701)

fail() {
  printf '\nnpm run art: %s\n\n%s\n\nSee tools/art/README.md.\n' "$1" "$2" >&2
  exit 1
}

py_ok() { "$1" -c 'import sys; sys.exit(sys.version_info < (3, 12))' 2>/dev/null; }

if [[ "$(uname)" == "Darwin" ]] && command -v brew >/dev/null 2>&1; then
  # cairocffi looks for libcairo with dlopen; Homebrew's lib folder is not on its default path.
  export DYLD_FALLBACK_LIBRARY_PATH="$(brew --prefix)/lib${DYLD_FALLBACK_LIBRARY_PATH:+:$DYLD_FALLBACK_LIBRARY_PATH}"
fi

if [[ -x "$VENV/bin/python" ]] && ! py_ok "$VENV/bin/python"; then
  fail "tools/art/.venv uses Python older than $MIN_PY." \
"Delete it and run again:
  rm -rf tools/art/.venv && npm run art"
fi

if [[ ! -x "$VENV/bin/python" ]]; then
  found=""
  # 3.13 first: the version the committed art was verified with.
  for candidate in python3.13 python3.12 python3.14 python3; do
    command -v "$candidate" >/dev/null 2>&1 && py_ok "$candidate" || continue
    found="$found $candidate"
    echo "Creating tools/art/.venv with $(command -v "$candidate")"
    if "$candidate" -m venv "$VENV"; then break; fi
    rm -rf "$VENV"
  done
  [[ -n "$found" ]] || fail "Python $MIN_PY or newer was not found." \
"Install it, then run npm run art again:
  macOS:          brew install python@3.13
  Debian/Ubuntu:  sudo apt install python3 python3-venv   (needs 3.12+, e.g. Ubuntu 24.04)"
  [[ -x "$VENV/bin/python" ]] || fail "Could not create a venv in tools/art/.venv (tried:$found)." \
"Check that the venv module works:  python3 -m venv /tmp/test-venv
  Debian/Ubuntu:  sudo apt install python3-venv"
fi

if ! "$VENV/bin/python" -c 'import cairosvg, PIL, numpy' >/dev/null 2>&1; then
  if ! "$VENV/bin/python" -c 'import PIL, numpy, cairocffi' >/dev/null 2>&1; then
    echo "Installing tools/art/requirements.txt into tools/art/.venv"
    "$VENV/bin/python" -m pip install --quiet --disable-pip-version-check -r "$HERE/requirements.txt" ||
      fail "pip could not install the Python packages." \
"Install them by hand and run again:
  tools/art/.venv/bin/python -m pip install -r tools/art/requirements.txt"
  fi
  # The packages are in; what's left is the cairo C library that cairocffi loads.
  "$VENV/bin/python" -c 'import cairosvg' >/dev/null 2>&1 || fail "The cairo library was not found (cairosvg needs it)." \
"Install it, then run npm run art again:
  macOS:          brew install cairo
  Debian/Ubuntu:  sudo apt install libcairo2"
fi

exec "$VENV/bin/python" "$HERE/regen.py"
