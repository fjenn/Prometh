# Prometh — native interactive prototype

Open `dist/Prometh.app`. Requires Apple Silicon and macOS 26 or newer. No dependencies, accounts, server, model downloads, credentials or microphone permissions are needed.

Build with `./build.sh` using the installed Xcode tools; run checks with `./test.sh`. The compiler flag `-disable-sandbox` avoids the compiler's nested macro-process sandbox, which cannot start inside this workspace sandbox. The application uses ordinary native APIs and does not alter system security settings. The build is locally ad-hoc signed.

The menu bar's **Preview → Restart onboarding** returns to welcome while retaining conversations. **Preview → Preview controls** offers hardware scenarios, deliberate failures, expired Gmail, restore samples and a confirmed reset. Use **Settings → Appearance** for Light, Dark or System. The initial review preference is Light.

Choose capabilities, see the dedicated Evil Mode reveal, and prepare. Chat becomes ready first; optional capabilities can finish later. Add a capability from Settings if an image/video/voice action needs it. Four providers offer fictional local consent with no OAuth. Conversations have independent modes and drafts; new chats start in Safe Mode. Toggle Evil Mode in the composer for that chat. Return sends, Shift-Return inserts a line. Conversation menus provide rename, export and delete. Assistant controls provide copy, regenerate/retry and sample read-aloud.

Media cards open full previews and native save panels. Edit image/video creates an associated new version; the original remains in history. Video preview provides native playback plus a labeled playhead, mute and trim in/out controls in Edit. Trim ranges are drafts; all edited artifacts reuse the source fixture rather than transforming/re-encoding it. Voice plays the supplied WAV through AVPlayer. Dictation inserts a sample without recording ambient sound.

All durable records live in `~/Library/Application Support/PromethPrototype/state-v1.json`, with copied user-selected attachments in `Attachments/`. Resource lookup uses the built app's `Contents/Resources`; the handoff and current directory are never runtime dependencies. No updater is installed. Nativ and its data remain independent.

`Sources/Domain.swift` centralizes product naming and persisted records. `Simulation.swift` contains replaceable deterministic timing, response and voice adapters; `AppStore.swift` owns presentation state, preparation and conversation tasks. SwiftUI views and small AppKit bridges handle presentation, text editing, panels and native AVPlayerView. No external package is required.

The complete original brief, aesthetic references, Nativ excerpts and asset provenance remain alongside this project in `../Local_AI_UI_Handoff`. The two cliff-house fixtures were recovered from the supplied original handoff ZIP because the initially copied directory lacked them. Only the selected dreamworld and demonstration fixtures are bundled; third-party aesthetic imagery is documentation only.

See `Documentation/REUSE.md` and `Documentation/VERIFICATION.md` for reuse and checks.

The latest review revision is documented in `Documentation/REVISION.md`. Extensions contains Connectors, Tools and Skills. Create or import a Markdown/text skill, edit its instructions, and enable it for new replies. The simulation demonstrates concise and bullet-point styles. Tools provides Web search and Read attachments switches.
