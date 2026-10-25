# Working product integration

Execution: 2026-10-24, GPT-6.1 Sol (verified turn_context), existing Local_flow repository. ECC 2.2.3 enabled; configure-ecc inventory only, search-first, swiftui-patterns, verification-loop. No global configuration changes.

Host: Apple M5 Max, 128 GiB, macOS 26.6.2. Measurements on this host do not certify 16 GiB hardware. All application work stays in Prometh. Existing state-v1.json and attachments retained. Nativ.app and its data are independent.

## Execution order
1. Adapt Nativ standalone Python packaging, download preflight/capacity and streaming/tool schemas. Pin artifact manifests from HF metadata. Real resumable verified downloads; mandatory Safe chat load and smoke inference gate readiness.
2. Wire persistent chat streaming, cancellation, per-conversation Evil backend, skill instructions and attachment extraction with bounded context.
3. Real microphone → Whisper → shared streaming chat harness → Pocket speech; persistent speech workers with bounded residency and heavy-job eviction.
4. FLUX klein compressed MFLUX generation/editing, experimental Z-Image only after proof. FastMetal MLX video, AVFoundation trim/export.
5. Real tools and secure optional Composio broker/session configuration; cloud connection state follows real OAuth status. Require user confirmation for writes.
6. Reproducible standalone build, regression checks, real distinct outputs, UI review and launched app. Record exact evidence/limitations.

## Reuse
Nativ upstream vendor/nativ detached at 55493b75315e53ea446eb22afe5df05d56fc1c9a. MIT notice in ThirdParty. Adapted NativChatClient preserves SSE, structured schema parsing, tool fragment accumulator and cancellation; HuggingFaceDownloadPreflight/Capacity provide pinned metadata admission and per-volume locked reservations; ServerProcessEnvironment and PythonDistribution provide process isolation and relocatable standalone Python. Changes are identified in source/documents. Do not stage nested .git. No fixture runtime fallback.

## Provisional catalog
Weights and working memory are distinct. Safe: mlx-community/gemma-4-e4b-it-4bit (Gemma terms). Evil: filvyb/Qwen3.5-9B-heretic-v2-GGUF Q4_K_M, llama.cpp adapter (no GGUF-as-MLX). STT: mlx-community/whisper-large-v3-turbo. TTS: kyutai/pocket-tts-without-voice-cloning, English Alba configuration. Other TTS languages are not installed. Images: FLUX.2-klein-4B with MFLUX compressed path, Apache 2. Z-Image experimental, quantization/license verification pending. Video: FastVideo/FastMetal-1.3B-QAD MLX text-to-video, silent. Pinned artifact bytes, revisions and hashes are in Resources/model-catalog.json.

## Optional cloud prerequisites
Composio project secret never shipped in desktop bundle. Broker owns project credential and gives per-install scoped short-lived sessions. Without authorized broker/account, connections remain disconnected and local features continue. No real email or external writes during validation.

## Launch evidence, 2026-10-24

Checked on this M5 Max. These runs do not certify 16 GB hardware.

- Wiring checks were added first and failed on a normal image sentence. After the routing, Evil catalog, and real-app reset changes, `Prometh/test.sh` passed: 69 state checks and 18 bundled media checks.
- Evil chat used the existing llama.cpp flags (`--jinja --reasoning off`) on the verified Q4_K_M GGUF. One completion returned `Ready` and the server was stopped. The GGUF stayed 5,627,044,800 bytes with its original timestamp. In the app, Chat preparation included that model (progress total 10.81 GB with Safe) and rewrote `verified.json` without replacing the GGUF.
- FLUX.2 Klein 4-bit: the installed mflux CLI takes the local directory as `--model` and the family as `--base-model flux2-klein-4b`. It does not accept `--model-path`. One smoke PNG decoded at 512×512. The launched app then generated another PNG from “Show me an image of a glass house.”
- FastMetal 1.3B produced a playable silent MP4, 832×480, 5.063 seconds, both from the worker and from the launched app (“Can you create a video of the coast”). Instruction-based video edits stay refused; trim remains the edit path.
- The rebuilt app showed real capability sizes: Chat 5.18 GB, Voice 1.84 GB, Images 4.62 GB, Video 13.4 GB. With all four selected the total was 25.0 GB. The hardware line read Apple M5 Max, 128 GB memory, 1462 GB available. Safe chat streamed `Ready.` Evil chat then streamed `Ready.` Read-aloud wrote Pocket TTS audio, and dictation inserted a microphone transcript. The 18 existing chats were still present after onboarding; the walk added one conversation.
- `COMPOSIO_API_KEY` was not set, so the broker was not started. Connectors remain disconnected. That does not block local chat, voice, images, or video. Z-Image and the Evil vision projector stay disabled. No project secret was added to the app.

## Repair evidence, 2026-10-25

Checked again on this M5 Max with 128 GB of memory. These timings do not certify a 16 GB Mac. No model was swapped and the downloaded weights were not replaced.

Speech harness, persistent streaming, prompt “What is 17 times 19?”, answer “17 times 19 equals 323.”, Safe chat process reused after the cold turn, host physical memory 137,438,953,472 bytes:

- Cold turn: 12.15 seconds total, 3.90 seconds transcription, 11.96 seconds to first audio.
- Warm turns: 0.58, 0.90, 1.07, and 1.42 seconds total. First audio was 0.41, 0.66, 0.78, and 1.10 seconds.

The full spoken turn is the number to use. A component inside that turn is not a 0.03 second reply.

`Prometh/test.sh` passed after the interrupted edits, including the existing state, media, provision, model-cache, and public-web checks, plus 125 voice checks against a fixture worker and 2 offline broker fixture checks. A missing Composio key does not fail those broker checks. They never call the network.

The app was rebuilt with `./build.sh --setup` because `.build/FastVideo` and `provenance.json` were missing. Setup reused the cached FastVideo archive and did not download model weights. `dist/Prometh.app` contains the current `media_worker.py` serve mode.

Walk of that build, without deleting Models or existing chats:

- Quit and relaunch left Chat, Voice, Images, and Video Ready. The download logs did not change, and Prometh did not start a model server until a request.
- In a new Safe chat, “Explain video compression in one sentence.” streamed a text reply and created no media file. Only the Safe chat server was running.
- “Can you create a video of a red mug?” wrote `Generated/8371992104964ac6b15c51d344851de1.mp4`. The saved duration is 5.063 seconds. The file’s video stream is 5.0625 seconds and has no audio track. The card and preview showed 5.1 seconds, and the trim-end control read 5.063. Trimming to 2.49 seconds exported version 2 at 2.492 seconds, matching that file. The original clip remained.
- Voice then answered “What is 2 plus 2?” with “2 plus 2 equals 4.” From the start of the spoken prompt back to listening took 12.53 seconds, including about 2.0 seconds of the prompt and a cold Safe chat load after video had stopped the previous server. The next prompt, “What is 3 plus 3?”, was answered “3 plus 3 equals 6.” while the same two `media_worker.py --serve` processes and the same Safe chat server stayed up. A later turn on those resident workers reached Speaking about 1.4 seconds after Transcribing. Safe and Evil chat servers were not loaded together. Voice was closed at the end of the walk.

Connectors are still blocked. `COMPOSIO_API_KEY` is absent, so the broker was not started. Connecting Gmail, Drive, Outlook, or GitHub still needs that key on the broker and an interactive provider sign-in. Local chat, voice, images, and video do not.
