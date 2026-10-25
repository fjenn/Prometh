#!/bin/zsh
set -euo pipefail
cd "${0:A:h}"
BUILD_ROOT="${PROMETH_BUILD_ROOT:-$PWD/.build}"
RESOURCES="${PROMETH_TEST_RESOURCES:-$PWD/dist/Prometh.app/Contents/Resources}"
mkdir -p "$BUILD_ROOT/module-cache"
SOURCES=()
for source in Sources/*.swift; do
    case "${source:t}" in
        PromethApp.swift|Onboarding.swift|Workspace.swift|Settings.swift|MediaViews.swift|Design.swift|ComposerEditor.swift) ;;
        *) SOURCES+=("$source") ;;
    esac
done
swiftc -disable-sandbox -swift-version 5 -module-cache-path "$BUILD_ROOT/module-cache" "${SOURCES[@]}" Tests/StateTests.swift -o "$BUILD_ROOT/StateTests"
"$BUILD_ROOT/StateTests"
swiftc -disable-sandbox -swift-version 5 -parse-as-library -module-cache-path "$BUILD_ROOT/module-cache" Tests/MediaTests.swift -o "$BUILD_ROOT/MediaTests"
"$BUILD_ROOT/MediaTests" "$RESOURCES"
/usr/bin/python3 Scripts/test-provision-runtime.py

/usr/bin/python3 Scripts/test-model-cache.py

swiftc -disable-sandbox -swift-version 5 -parse-as-library -module-cache-path "$BUILD_ROOT/module-cache" Sources/PublicWeb.swift Tests/PublicWebTests.swift -o "$BUILD_ROOT/PublicWebTests"
"$BUILD_ROOT/PublicWebTests"
Scripts/test-speech.sh
BROKER_PY="${PROMETH_BROKER_PYTHON:-$PWD/.build/Runtime/python/bin/python3}"
BROKER_DEPS="$BUILD_ROOT/broker-deps"
if [[ ! -x "$BROKER_PY" ]]; then
    print -u2 'Broker fixture tests need the packaged runtime Python. Run ./build.sh --setup first.'
    exit 1
fi
if ! PYTHONPATH="$BROKER_DEPS" "$BROKER_PY" -c 'import jsonschema' 2>/dev/null; then
    "$BROKER_PY" -m pip install --target "$BROKER_DEPS" 'jsonschema==4.26.0'
fi
PYTHONPATH="$BROKER_DEPS" "$BROKER_PY" Tests/Broker/test_broker.py
