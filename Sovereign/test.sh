#!/bin/zsh
set -euo pipefail
cd "${0:A:h}"
mkdir -p .build/module-cache
swiftc -disable-sandbox -swift-version 5 -module-cache-path .build/module-cache Sources/Domain.swift Sources/Simulation.swift Sources/AppStore.swift Tests/StateTests.swift -o .build/StateTests
.build/StateTests
swiftc -disable-sandbox -swift-version 5 -parse-as-library -module-cache-path .build/module-cache Tests/MediaTests.swift -o .build/MediaTests
.build/MediaTests "$PWD/dist/Prometh.app/Contents/Resources"
