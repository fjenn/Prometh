#!/bin/zsh
set -euo pipefail
cd "${0:A:h:h}"
BENCH_APP="/tmp/prometh-speech-benchmark/SpeechPerformance.app"
mkdir -p "$BENCH_APP/Contents/MacOS" "$BENCH_APP/Contents/Resources" .build/module-cache
for item in Runtime MediaRuntime; do ln -sfn "$PWD/.build/$item" "$BENCH_APP/Contents/Resources/$item"; done
for item in model-catalog.json voice-demo.wav; do ln -sfn "$PWD/Resources/$item" "$BENCH_APP/Contents/Resources/$item"; done
for item in media_worker.py llama_supervisor.py; do ln -sfn "$PWD/Runtime/$item" "$BENCH_APP/Contents/Resources/$item"; done
swiftc -disable-sandbox -swift-version 5 -O -module-cache-path .build/module-cache $(rg --files Sources -g '*.swift' | rg -v '/(PromethApp|Onboarding|Workspace|Settings|MediaViews|Design|ComposerEditor)\.swift$' | sort) Tests/SpeechPerformance.swift -o "$BENCH_APP/Contents/MacOS/SpeechPerformance"
"$BENCH_APP/Contents/MacOS/SpeechPerformance"
