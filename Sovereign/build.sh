#!/bin/zsh
set -euo pipefail
cd "${0:A:h}"
rm -rf dist/Sovereign.app
mkdir -p .build/module-cache dist/Prometh.app/Contents/MacOS dist/Prometh.app/Contents/Resources
swiftc -disable-sandbox -swift-version 5 -O -module-cache-path .build/module-cache -target arm64-apple-macosx26.0 Sources/*.swift -o dist/Prometh.app/Contents/MacOS/Prometh
cp Resources/* dist/Prometh.app/Contents/Resources/
cat > dist/Prometh.app/Contents/Info.plist <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>CFBundleExecutable</key><string>Prometh</string>
<key>CFBundleIdentifier</key><string>studio.prometh.prototype</string>
<key>CFBundleName</key><string>Prometh</string>
<key>CFBundleDisplayName</key><string>Prometh</string>
<key>CFBundlePackageType</key><string>APPL</string>
<key>CFBundleShortVersionString</key><string>0.1.0</string>
<key>CFBundleVersion</key><string>1</string>
<key>CFBundleIconFile</key><string>AppIcon</string>
<key>LSMinimumSystemVersion</key><string>26.0</string>
<key>NSHighResolutionCapable</key><true/>
</dict></plist>
PLIST
codesign --force --deep --sign - dist/Prometh.app
printf 'Built %s/dist/Prometh.app\n' "$PWD"
