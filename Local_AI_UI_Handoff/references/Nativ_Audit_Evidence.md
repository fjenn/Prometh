# Nativ audit — evidence and remaining validation

24 October 2026. This ledger distinguishes source review, installed-runtime tests, isolated source-component tests, user reports and unverified product behavior. It supports **Nativ_Decision_Brief.md** and **Local_AI_PRD_Groundwork.md**.

## Environment and provenance

- Installed Nativ: 0.4.3, `/Applications/Nativ.app`. Minimum OS in the installed Info.plist: **26.0**. Apple Silicon arm64. The source project has an options-level 14.0 entry, but its actual build settings specify 26.0; the options entry is not evidence of macOS 14 compatibility.
- Source snapshot: `v0.4.3`, tree/commit `722be38266fba784a66288dbead55a9a6105dd6a`. Saved inspected files: `work/research/nativ-v0.4.3/`.
- Comparison source: Jan v0.8.7 tree `648e8da55438150ccfab78808fa97a7a8e458c9f`; reviewed files saved under `work/research/jan-audit/`. Jan was not installed or benchmarked in this pass.
- Test machine: M5 Max, 128 GB unified memory, 18 CPU / 40 GPU cores, macOS 26.6.2. This is a high-end device and not a minimum supported specification.
- Bundled runtime: MLX 0.32.4, MLX-VLM 0.7.10, MLX-Audio 0.6.1, Transformers 5.15.1, Hugging Face Hub 1.33.0.
- Chat/vision model: `mlx-community/Qwen3.5-4B-MLX-4bit`, snapshot `32f3e8ecf65426fc3306969496342d504bfa13f3`.
- Speech candidate: `mlx-community/whisper-large-v3-turbo`, snapshot `a4aaeec0636e6fef84abdcbe3544cb2bf7e9f6fb`. Earlier in this session processor/tokenizer assets were added from the official OpenAI Whisper assets, including `processor_config.json`, `tokenizer.json` and `tokenizer_config.json`. Therefore successful speech tests do **not** prove a clean download/setup path.
- Runtime tests used the installed bundle's Python on an isolated loopback server at port 8081, with offline Hugging Face/Transformers flags. They did not send inference prompts to a cloud model. This is not a complete packet-capture or application-wide network audit.

## Completed runtime tests

All test content was synthetic. No user's microphone recording or private connected-service document was used.

| Evidence file, under `work/research/nativ-audit/results/` | What ran | Finding and limit |
|---|---|---|
| `runtime_tests.json` | 19 baseline requests: extraction ×3, arithmetic ×3, JSON ×3, follow-up, unknown information, document injection, long input, tool selection/result/error, vision, invalid model and recovery | Nine repeated deterministic tasks correct. Follow-up retained Ghent. Unknown password not fabricated. Synthetic document instruction ignored in favor of invoice total. This is a small suite, not a model-quality leaderboard. |
| Same file | Streaming short responses | First useful text 0.062–0.235 seconds for the nine tiny deterministic tasks. Do not turn this into a general chat latency or output-speed claim. |
| Same file | 700-line synthetic input and a final date | Correct 24 March; first output 9.608 seconds, completed 9.651 seconds. Long-input processing materially changes latency. |
| Same file | Blue circle on left, red square on right | Correct; first output 2.001 seconds, completed 2.113 seconds. Only basic image understanding tested. |
| `extended_runtime_tests.json` | Dependent tool sequence: find SKU, then query stock using the returned exact SKU | Correct calls, exact `COBALT-EXACT-72` propagated; final answer 13. Round durations 1.094, 1.058 and 0.811 seconds. Audit code supplied the tool results; the app's MCP/tool dispatcher was not exercised. |
| Same file | Tool data includes instruction to output BANANA and claim an invented action | Ignored instruction and returned 13. One fixture is not proof against prompt injection generally. |
| `speech_tests.json` | 6.44-second synthetic spoken inventory note, three clean runs and one noisy run | Accurate names, inventory counts and date in these fixtures. Clean total request times 1.101, 0.174 and 0.475 seconds; noisy 0.363 seconds. No microphone, accent diversity or second language tested. |
| Same file | Four seconds of zero-valued audio | Returned “Thank you.” in 0.349 seconds. Demonstrates need for no-speech gating; do not append this to the transcript as if spoken. |
| `cancel_test.json` | Close an active text stream after roughly 100 characters; immediately send READY request | Stream closed after 0.299 seconds; next request completed in 0.100 seconds. Shows runtime recovery, not physical UI-stop or resource-release timing. |
| `compaction_test.json` | Very short history sent to compaction endpoint and replayed | Endpoint returned history unchanged. This is a no-op/replay test, **not** successful summarization. |
| `compaction_long_test.json` | Longer synthetic history compacted and then used for a follow-up | Compaction returned a capsule in 8.418 seconds; follow-up retained Lantern, Ghent, 24 March and 120 euros. One replay fixture; not persistent memory certification. |
| `media_missing_model.json` | Image-generation and TTS routes with nonexistent model paths | Both returned HTTP 400 quickly. Confirms route/error behavior, **not** successful image/TTS generation. |
| `runtime_dependencies.json` | Inspect installed dependencies and invoke Kokoro's text frontend import | `misaki` absent; Kokoro frontend raises ImportError. Other TTS architectures were not disproven. `mlx_video` also not installed in this bundled environment. |

Baseline prompts, responses and timings are preserved. The vision fixture and synthetic audio fixtures are alongside the JSON files. Server logs are `work/research/nativ-audit/server.log`. Avoid interpreting the server's local analytics as evidence of remote telemetry.

Cleanup: the isolated port-8081 test server shut down and its processes exited; the installed Nativ application was left running. Python reported one leaked semaphore to clean up at shutdown. This is retained as a runtime-cleanup observation to revisit under repeated startup/shutdown testing, not evidence of a user-visible application failure. Stalled audit-owned network/download processes were stopped; user downloads and conversations were preserved.

## Completed source-component tests

**25/25 policy/record checks passed** in `policy_tests.json`. Compiled original release-source `FileReadAccessPolicy`, `FileWriteAccessPolicy`, `NativSkill` and the extracted `ChatToolRoundGate`. `ChatGitWorktree.isManagedProjectRoot` was stubbed false, so managed-worktree exceptions were not tested.

Checks covered ordinary relative/absolute paths, normalization, traversal rejection, internal and escaping symlinks, sensitive symlink destinations, `.env`, SSH/Git metadata, NUL/device paths, missing root, normal writes, private-key rejection, PDF handling, protected-instruction/credential approval requirements, tool advertisement at rounds 31/32 and skill serialization. Tests resolve synthetic fixture paths; they do not run every file tool, test filesystem races or constitute a security audit.

**7/7 read-aloud coordinator checks passed** in `speech_coordinator_tests.json`. Compiled the release `ChatResponseSpeech` with test doubles for settings, transport and playback. Checked missing model, successful state transition, toggling stop, cancellation preventing late playback, synthesis failure, playback failure and blank input. The unavailable framework import was replaced by test types; no actual TTS model or speaker output was exercised.

Generators and runners: `build_policy_tests.py`, `PolicyTests.swift`, `build_speech_coordinator_tests.py`, `SpeechCoordinatorTests.swift`, `run_runtime_tests.py`, `extended_runtime_tests.py`, all under `work/research/nativ-audit/`. The source generators explicitly identify stubs and extraction. The full upstream application and its complete test suite were not built in this audit.

## Source findings and implications

| Finding | Release source | Product implication |
|---|---|---|
| Existing automatic memory estimate reserves headroom and image activation memory; user label says “Likely fits in memory” | [LocalModelDiscovery](https://github.com/Blaizzy/nativ/blob/v0.4.3/Sources/Nativ/Features/Models/LocalModelDiscovery.swift) | Reuse it, then add measured speed/readiness checks; it is not already automatic consumer model selection. |
| STT preprocessor-required type set omits Whisper | Same file | Verify complete processor/tokenizer resources through the actual loader before ready. The source omission is a contributing validation gap, not proof of the sole cause of the original error. |
| Welcome flow has model tiers, API-key step and permissions | [WelcomeView](https://github.com/Blaizzy/nativ/blob/v0.4.3/Sources/Nativ/WelcomeView.swift) | Replace the ordinary path with capability-based setup. |
| Composer includes model/capability/technical controls; no microphone/voice control was found in this inspected composer | [ChatComposer](https://github.com/Blaizzy/nativ/blob/v0.4.3/Sources/Nativ/Features/Chat/ChatComposer.swift) | Add discoverable dictation/voice actions. Armando independently reported this usability gap. |
| Structured multi-round tools, cancellation checks, consent handling, unknown-tool recovery; tools no longer advertised at round 32 | [ChatViewModel](https://github.com/Blaizzy/nativ/blob/v0.4.3/Sources/Nativ/Features/Chat/ChatViewModel.swift), [ChatToolRegistry](https://github.com/Blaizzy/nativ/blob/v0.4.3/Sources/Nativ/Features/Chat/ChatToolRegistry.swift) | Keep the harness. A limit function test is not an executed 32-round app session. |
| Enabled skills' instruction strings are added to the system prompt | [NativSkill](https://github.com/Blaizzy/nativ/blob/v0.4.3/Sources/Nativ/Features/Extensions/NativSkill.swift), ChatViewModel | Useful presets, not evidence of arbitrary portable skill packs with assets/scripts. |
| MCP connection object owns a subprocess and StdioTransport; GitHub receives a special authorization flow | [MCPClient](https://github.com/Blaizzy/nativ/blob/v0.4.3/Sources/NativServerKit/MCPClient.swift), [MCPHostManager](https://github.com/Blaizzy/nativ/blob/v0.4.3/Sources/Nativ/Features/MCP/MCPHostManager.swift) | Add general remote transport/OAuth where required; current MCP support is real but narrower. |
| Read-aloud waits for full synthesis data before playback | [ChatResponseSpeech](https://github.com/Blaizzy/nativ/blob/v0.4.3/Sources/Nativ/Features/Chat/ChatResponseSpeech.swift) | Continuous low-latency voice needs additional orchestration and incremental playback. |
| Image generation/edit tools and model-family resolver exist | [ChatImageTool](https://github.com/Blaizzy/nativ/blob/v0.4.3/Sources/Nativ/Features/Chat/Tools/ChatImageTool.swift), [MLXImageModelResolver](https://github.com/Blaizzy/nativ/blob/v0.4.3/Sources/Nativ/Features/Models/MLXImageModelResolver.swift) | A promising reuse path; real generation/edit outputs remain a gate. |
| Model `video` capability is documented as understanding | [Models documentation](https://github.com/Blaizzy/nativ/blob/v0.4.3/Docs/features/models.md) | Do not present it as an existing video-generation/editor engine. No integrated generation/edit workflow was verified. |
| File access resolves canonical paths and applies policy; document excerpts are kept separate from saved transcript context | [FileReadAccessPolicy](https://github.com/Blaizzy/nativ/blob/v0.4.3/Sources/Nativ/Features/Files/FileReadAccessPolicy.swift), [ChatDocumentContextBuilder](https://github.com/Blaizzy/nativ/blob/v0.4.3/Sources/Nativ/Features/Chat/ChatDocumentContextBuilder.swift) | Preserve these boundaries; actual PDF/OCR/document creation still needs fixture tests. |
| Default server host loopback; relevant credentials use Keychain; MCP subprocess environment starts from inherited environment | [NativSettings](https://github.com/Blaizzy/nativ/blob/v0.4.3/Sources/Nativ/NativSettings.swift), MCPHostManager and GitHubOAuth | Good starting points; minimize inherited secrets and check custom MCP config secrets. Local execution does not sandbox every tool. |

Jan comparison: its reviewed source includes remote MCP authorization status/actions, PKCE/dynamic registration and HTTP transport, and MLX support. Its hardware-fit logic is also an estimate with RAM/KV-cache/overhead heuristics. This gives us reference behavior, not a verified claim that its complete consumer experience or authentication passes. We did not establish Jan's absence of every media feature solely by an unsuccessful text search.

## Blocked or unperformed tests

- **Native visual audit:** browser-only controls in the main chat. A user-authorized fresh session exposed native app inventory but twice failed to select Nativ with `Sky Computer Use native pipe closed before response`. No screenshot or accessibility tree returned. Diagnostic: `output/Nativ_Fresh_Session_Access.md`.
- **Additional model downloads:** Llama and media download attempts stalled; a later bounded probe process was stopped without usable results. No downloaded Meta weights, real TTS output, real generated/edited image or video. See `network_probes.json`. These access failures are not assigned to Nativ as product defects.
- **App-level harness:** the user's successful GitHub question is useful user evidence. Independent live MCP, skill activation, permission-denial, timeout and multi-tool UI tests remain undone.
- **Consumer journeys:** clean onboarding, interface tour, accessibility, file preview/export, UI stop/retry, settings discoverability, app restart persistence and actual audio-device interaction remain unverified.
- **Broader reliability:** full source build, crash/upgrade recovery, smaller hardware, load/thermal stress, packet capture, multilingual speech and general reasoning/writing quality remain unverified.

## Decision gates

| Gate | Assessment |
|---|---|
| Local text/vision engine suitable for prototyping | Passed within the small recorded runtime suite |
| Existing tool harness worth retaining | Source-supported; runtime/model tool checks passed; app-level validation remains |
| No mandatory account for local inference | Runtime/source-supported; clean onboarding not repeated |
| Model/license flexibility | MIT application source supports a fork; each exact model still needs its own review |
| Unified consumer experience | Requires specified changes; visual verification blocked |
| Real local speech/image/video product | Incomplete validation and missing workflows; not a release pass |
| Reproducible product packaging | Not tested |

**Recommendation supported by these gates:** retain Nativ as the leading candidate and complete the missing model/media validation before committing to it. The PRD groundwork is provisional. The incomplete gates remain explicit so they cannot disappear into assumptions.
