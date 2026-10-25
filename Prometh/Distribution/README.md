# Reproducible standalone distribution

`../build.sh --setup` is the fresh-checkout entry point. macOS 26+, Apple Silicon
and Xcode 26+ are the build toolchain. No global Python packages, Nativ installation,
user models, Homebrew or Composio credential are required.

## Isolation and cache reuse

All paths are absolute or resolved by the scripts. Example from `Prometh/`:

```sh
Scripts/setup-runtime.sh --output /tmp/prometh-check/runtime \
  --cache "$PWD/.build/downloads" --reuse-from "$PWD/.build"
PROMETH_RUNTIME_ROOT=/tmp/prometh-check/runtime \
PROMETH_BUILD_ROOT=/tmp/prometh-check/build \
PROMETH_APP_OUTPUT=/tmp/prometh-check/Prometh.app ./build.sh
PROMETH_BUILD_ROOT=/tmp/prometh-check/build \
PROMETH_TEST_RESOURCES=/tmp/prometh-check/Prometh.app/Contents/Resources ./test.sh
```

`--reuse-from` verifies exact installed versions, dependency consistency and
provider imports before creating independent APFS copies. It never modifies the
source runtime. Source archives still come from the verified cache or pinned URL.
Use a new output directory when changing pins; invalid existing components fail
rather than silently refreshing or mutating them. `--verify-only` performs the
same complete provider gate without building or downloading. `--dry-run` prints
pins without changing disk. `--offline` requires all source archives in the cache;
a fresh wheel install additionally requires compatible wheels in `cache/wheels`.
Cache reuse verification is not evidence of a clean offline wheel install.

Python dependency locks in `Scripts/requirements/` are normalized copies of the
working `Runtime/*-requirements.lock`, with every version pinned and SHA-256
hashes from PyPI release metadata. Regenerate wheel hashes after an intentional lock update with
`/usr/bin/python3 Scripts/lock-wheels.py`, then review the diff.
The original freeze's machine-local pip wheel
URL is replaced with `pip==26.1.1`. Installation accepts wheels only and uses
`--require-hashes --no-deps`; a final `pip check` detects inconsistent locks.
The bootstrap never invokes `Runtime/setup_media_runtime.py`, whose refresh mode
is a development helper rather than the release lock workflow.

The provisioner adapts Nativ's native relocatable launcher, overlay and capability
manifest. Archive SHA-256 checks precede extraction; traversal/external symlinks
are rejected on the older Xcode bootstrap Python as well. FastVideo's Python
source and MLX example are extracted from its pinned archive without CUDA binary
packages, weights, a nested Git checkout or installing its broad development
requirements. All top-level `Runtime/*.py` modules are bundled together.

## Release boundaries

Commit the application source, resources/catalog, scripts, hashed locks and
notices. Do not commit `dist/`, `.build/`, `vendor/`, models, caches, editor/agent
state or logs. FastVideo's locally generated source snapshot is ignored because
the checksum-pinned bootstrap recreates it. Preserve existing local files when
cleaning a stage; do not use blanket `git add .` on a workspace with private work.
`Scripts/package-source.sh` creates an archive from committed Git content only.

A local app build is ad-hoc signed and checked with strict codesign verification.
Public macOS distribution additionally needs an authorized Developer ID signing
and notarization workflow. The imageio-ffmpeg wheel ships a GPL-enabled FFmpeg
binary: complete corresponding source and notices for that exact binary and its
dependencies must accompany public binary redistribution. That source bundle
has not been assembled/certified here. Source publication can proceed without
bundled runtimes or weights; do not publish a runtime zip as license-cleared merely
because compilation and codesign succeeded. Read `../ThirdParty/NOTICES.md`.

The Composio broker is a separate operator service. Its API secret must stay out
of Git, source archives and the desktop bundle. Consult `../Documentation/INTEGRATION.md`
and the broker's own command-line help for configuration and live validation.
