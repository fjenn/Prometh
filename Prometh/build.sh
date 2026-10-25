#!/bin/zsh
set -euo pipefail
cd "${0:A:h}"
# These paths permit isolated verification without replacing an app in use.
RUNTIME_ROOT="${PROMETH_RUNTIME_ROOT:-$PWD/.build}"
BUILD_ROOT="${PROMETH_BUILD_ROOT:-$PWD/.build}"
APP="${PROMETH_APP_OUTPUT:-$PWD/dist/Prometh.app}"
if [[ "${1:-}" == --setup ]]; then
    Scripts/setup-runtime.sh --output "$RUNTIME_ROOT"
elif [[ $# -gt 0 ]]; then
    print -u2 'Usage: ./build.sh [--setup]'
    exit 2
fi
# All catalog-enabled providers are mandatory build inputs. Never ship a bundle
# whose media or Evil capability silently depends on this developer machine.
Scripts/setup-runtime.sh --output "$RUNTIME_ROOT" --verify-only
mkdir -p "$BUILD_ROOT/module-cache" "${APP:h}"
STAGING=$(mktemp -d "${APP:h}/.prometh-build.XXXXXX")
trap 'rm -rf "$STAGING"' EXIT
BUNDLE="$STAGING/Prometh.app"
RESOURCES="$BUNDLE/Contents/Resources"
mkdir -p "$BUNDLE/Contents/MacOS" "$RESOURCES"
swiftc -disable-sandbox -swift-version 5 -O -module-cache-path "$BUILD_ROOT/module-cache" -target arm64-apple-macosx26.0 Sources/*.swift -o "$BUNDLE/Contents/MacOS/Prometh"
cp Resources/* "$RESOURCES/"
for component in Runtime MediaRuntime llama FastVideo; do
    rsync -a --exclude '__pycache__' --exclude '*.pyc' "$RUNTIME_ROOT/$component/" "$RESOURCES/$component/"
done
# Top-level worker modules evolve together; never bake a stale filename list.
cp Runtime/*.py "$RESOURCES/"
cp ThirdParty/* "$RESOURCES/"
cp "$RUNTIME_ROOT/provenance.json" "$RESOURCES/runtime-provenance.json"
cat > "$BUNDLE/Contents/Info.plist" <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>CFBundleExecutable</key><string>Prometh</string>
<key>CFBundleIdentifier</key><string>studio.prometh.prototype</string>
<key>CFBundleName</key><string>Prometh</string>
<key>CFBundleDisplayName</key><string>Prometh</string>
<key>CFBundlePackageType</key><string>APPL</string>
<key>NSMicrophoneUsageDescription</key><string>Record your voice for private on-device transcription and conversation.</string>
<key>CFBundleShortVersionString</key><string>0.2.0</string>
<key>CFBundleVersion</key><string>1</string>
<key>CFBundleIconFile</key><string>AppIcon</string>
<key>LSMinimumSystemVersion</key><string>26.0</string>
<key>NSHighResolutionCapable</key><true/>
</dict></plist>
PLIST
codesign --force --deep --sign - "$BUNDLE"
codesign --verify --deep --strict "$BUNDLE"
# Only replace the requested output after every compile/copy/sign step passes.
if [[ -e "$APP" ]]; then
    [[ -d "$APP/Contents" && "${APP:t}" == *.app ]] || { print -u2 'Refusing to replace a non-app output path'; exit 1; }
    rm -rf "$APP"
fi
mv "$BUNDLE" "$APP"
printf 'Built %s\n' "$APP"
