#!/bin/zsh
# Only Xcode's command-line Python is used to bootstrap our owned Python.
set -euo pipefail
unset PYTHONHOME PYTHONPATH VIRTUAL_ENV
exec /usr/bin/python3 "${0:A:h}/provision-runtime.py" "$@"
