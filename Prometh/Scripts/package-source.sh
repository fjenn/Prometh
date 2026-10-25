#!/bin/zsh
# Exports committed source only. Stage/review/commit explicitly before invoking.
set -euo pipefail
cd "${0:A:h}/../.."
OUTPUT="${1:-$PWD/Prometh/dist/Prometh-source.tar.gz}"
[[ "$OUTPUT" == /* ]] || OUTPUT="$PWD/$OUTPUT"
mkdir -p "${OUTPUT:h}"
if [[ -n "$(git status --porcelain --untracked-files=no)" ]]; then
    print -u2 'Commit reviewed changes first; the source archive contains committed files only.'
    exit 1
fi
# Export only the application and repository distribution policy, never editor
# state, unrelated handoff folders, runtime downloads or user work logs.
git archive --format=tar.gz --prefix=Prometh-source/ HEAD Prometh .gitignore .gitattributes -o "$OUTPUT"
shasum -a 256 "$OUTPUT"
