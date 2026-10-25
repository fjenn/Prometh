# Prometh

A native local AI workspace for Apple Silicon, macOS 26 or newer. Safe and Evil
chat, Whisper transcription, English Pocket speech, FLUX.2 Klein image generation
and image edits, and silent FastMetal video generation use owned bundled engines.
Video editing currently means trim/export. Z-Image is disabled. Models download
separately into `~/Library/Application Support/PromethPrototype/Models`; the app
verifies the pinned files and reuses valid downloads. See the measured capabilities
and remaining validation in [the integration notes](Documentation/INTEGRATION.md)
and [independent review](Documentation/QA-2026-10-24/REVIEW.md).

## Build and run

Install Xcode 26 or newer (including command-line tools), then from `Prometh/`:

```sh
./build.sh --setup
open dist/Prometh.app
./test.sh
```

The first build requires internet and several GB of free space for standalone
Python, exact wheel dependencies, source archives and llama.cpp. It does not use
Homebrew, an installed Nativ app, a global pip environment, or downloaded models.
Xcode's bundled Python bootstraps the owned Python 3.12.13 runtime. Source archives
and wheels are pinned and checksum verified. The finished app includes its
runtimes, is locally ad-hoc signed, and requires no developer tools. This is not a
Developer ID signed/notarized public installer.

`./build.sh` rebuilds using verified prepared engines. Missing or mismatched
chat/media/llama/video components fail the build before producing an app.
`Scripts/setup-runtime.sh --dry-run` prints every pin without downloading.
For an isolated build or to reuse verified existing Prometh runtimes, see
[distribution instructions](Distribution/README.md). Runtime caches, app bundles,
model weights and local work logs are excluded from Git.

## Use and privacy

Choose capabilities during onboarding or in Settings. New chats start in Safe
mode; each conversation keeps its own mode and draft. Return sends; Shift-Return
adds a line. Media edits create a new version and preserve the original. Skills
can be imported/edited and enabled for new replies. Local chats need no account.

Chats and settings live in
`~/Library/Application Support/PromethPrototype/state-v1.json`; selected attachments
are copied into `Attachments/`. Clear local data leaves downloaded models in
place. Nativ and its data remain independent. No updater is installed.

Connected Gmail/Drive/Outlook/GitHub require a separately operated Composio broker
and authorized account. They remain disconnected without one; no project secret
belongs in the desktop app. The current search tool uses Wikipedia search.
Live connector OAuth/execution has not been certified on this installation.

The automated state/media checks include simulation and bundled fixtures; they
do not certify every real engine, microphone journey, 16 GB machine or offline
cold launch. See the dated evidence above. Software/model licenses and the
FFmpeg binary redistribution requirement are in
[Third-party notices](ThirdParty/NOTICES.md).
