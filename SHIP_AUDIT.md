# Prometh ship audit

Investigation only. No product code was changed. Date: 2026-10-26.

Both apps already have a real chat path and a real media path. The gap versus ChatGPT is the agent layer: tools, search, and connectors. The Mac app has that layer in code and has never been shown using it. The browser app does not have it, and the pinned WebLLM build cannot grow it by passing an OpenAI `tools` array.

## What ran on this machine

Linux VM, no Xcode, no Swift. The Mac app was read and its Python checks were run. It was not built.

| Check | Result |
|---|---|
| `web/`: `npm ci` (patch-package applied the WebLLM shape-cache patch) | ok |
| `npm test` | 16/16 passed (prompt gate + turn-taking) |
| `npm run build` (`tsc -b && vite build`) | ok, ~2s |
| Headless Chrome, built app at `127.0.0.1:4173` | Welcome screen renders: “AI that you own.”, “Get started”, “1 / 4” |
| Headless Chrome, SwiftShader WebGPU (`--enable-unsafe-webgpu --use-webgpu-adapter=swiftshader`) | Adapter `google` / `swiftshader`. `shader-f16` is **false**. `subgroups` is true |
| Chat, Whisper, Kokoro, or image inference | not run. The in-app memory probe tries a 7.6 GB allocation first. This VM reported about 5 GB available. No model weights were downloaded |
| `Prometh/Scripts/check-release-inputs.py` | passed |
| `test-provision-runtime.py` | 6 tests passed |
| `test-model-cache.py` | 3 tests passed |
| `provision-runtime.py --dry-run` | wrote a plan (`archives`, `dependencies`) |
| `py_compile` of `Prometh/Scripts` and `Prometh/Runtime` | passed |
| `Prometh/Tests/Broker/test_broker.py` | 2 fixture checks passed, with FastAPI/jsonschema installed aside. They never call Composio |
| `Prometh/test.sh` (Swift state, media, speech) | not run. `swiftc` is absent |
| https://prometh.leyten.dev | `302` to `/login`. `/models/checks/silero_vad.onnx` also redirects to login, so hosted weights were not confirmed |
| Wikipedia API | `200`, `access-control-allow-origin: *` |

Live site CSP (`connect-src`) allows only `'self'`, Hugging Face, and `raw.githubusercontent.com`. A browser call to Wikipedia, DuckDuckGo, or a SearXNG host is blocked until that header or a same-origin proxy changes.

## Capability matrix

Status is the product as it will behave in a demo, not “the file exists”.

| Capability | Browser (`web/`) | Mac app (`Prometh/`) |
|---|---|---|
| Chat | **Partially works.** WebLLM 0.2.84 streams in `web/src/engine/llm.ts`. Safe picks Qwen3.5 9B/4B/2B or Llama 3.2 1B; without shader-f16 it uses the q4f32 twins (`web/src/engine/catalog.ts`). This VM has no f16, so Evil Mode and images are unavailable here. No token was generated in this audit. | **Works, on Finn’s Mac only.** Safe is MLX Gemma 4 E4B via `mlx-vlm-server`. Evil is Qwen3.5 9B Heretic Q4_K_M via `llama-server` (`Prometh/Sources/LocalRuntime.swift`). `Documentation/INTEGRATION.md` records real replies on an M5 Max, 25 Oct 2026, including “17 times 19 equals 323.” Not rebuilt here. |
| Multi-turn harness | **Partially works.** `buildMessages` in `web/src/state/actions.ts` replays history inside a **4096**-token window (same cap is baked into the Qwen3.5 MLC records: `context_window_size: 4096`). One completion per turn. No tool-result round trip. | **Partially works.** `runChatLoop` in `Prometh/Sources/Execution.swift` does up to six tool rounds, then a final answer. `Tests/StateTests.swift` covers that with a fake stream. A real model was not shown taking a second turn through a tool. Safe mode refuses prompts over 6500 tokens. Evil mode skips that check. |
| Tool calling | **Missing.** Nothing passes `tools`. Image requests are a regex plus a `[[image: …]]` line the model is told to write. WebLLM 0.2.84’s OpenAI tool path is commented out (`getConversationFromChatCompletionRequest` in `node_modules/@mlc-ai/web-llm/lib/index.js`: “TODO: either remove these or support gorilla-like function calling”). The TypeScript types exist. They do not run. Do not upgrade WebLLM to chase this: `web/README.md` says 0.2.86 emitted garbage on the same prompt where 0.2.84 answered. | **Partially works.** OpenAI-style tools are defined and executed in `Prometh/Sources/Tools.swift`, parsed by `NativChatClient.swift`, and looped in `runChatLoop`. The unit test calls a tool named `disabled_test_tool` and checks that “unavailable” comes back. It does not call Wikipedia. Launch notes never show a live tool call. |
| Web search | **Stubbed.** Customize → Tools renders a disabled switch and “Coming soon” (`web/src/ui/Settings.tsx`). | **Partially works.** Off by default (`webSearch = false` in `Domain.swift`). When on, `web_search` hits the English Wikipedia API and `fetch_url` reads a public HTTPS page with private-IP checks (`PublicWeb.swift`). No other index. Not in the 25 Oct walk. |
| Connectors | **Stubbed.** Gmail, Outlook, Drive, and GitHub render “Coming soon”. | **Partially works, blocked on a secret.** Broker (`Prometh/Runtime/connector_broker.py`) plus the Mac client (Keychain install token, approve-before-execute) are real. `COMPOSIO_API_KEY` was absent on 25 Oct, so the broker was not started. Preview mode marks a provider connected with no OAuth (`AppStore.connect`). Do not demo the preview. |
| Image generation | **Partially works, and only where the files and the GPU exist.** ONNX Realistic Vision + Hyper-SD, optional Z-Image, prompt gate, NSFW and age checks (`sd.ts`, `zimage.ts`, `image-check.ts`, `prompt-gate.ts`). Weights and YuNet are **not in git** (`web/public/` has no `models/`). A fresh `npm run dev` fails image prep with HTTP 404 on `/models/rv-hyper-v1/manifest.json`. Needs shader-f16. This VM does not have it. Prompt-gate tests passed. | **Works on Finn’s Mac.** FLUX.2 Klein 4B through mflux, 4 steps, 512 px (`media_worker.py`). Integration log: a real 512×512 PNG. Z-Image is in the catalog with `"enabled": false`. Instruction edits of an existing image are implemented. Not run here. |
| Video | **Stubbed.** Any video-shaped request gets a fixed sentence pointing at the Mac app (`actions.ts` `respond`). | **Works on Finn’s Mac for silent text-to-video.** FastMetal 1.3B, 832×480, about 5.1 s, no audio track. Trim/export uses AVFoundation. Instruction-based video edit is refused on purpose. Not run here. |
| Voice in | **Partially works.** Whisper base or large-v3-turbo via Transformers.js (`stt.worker.ts`). Turn-taking is Silero, and the ONNX file is fetched from `/models/checks/silero_vad.onnx`, which is not in the repo (`vad.worker.ts`). Synthetic VAD tests passed. No microphone on this VM. | **Works on Finn’s Mac.** Whisper large-v3-turbo via mlx-audio. Integration log has real dictation and spoken turns. `Voice.swift` records, then transcribes. Not run here. |
| Voice out | **Partially works.** Kokoro 82M, English voices (`tts.worker.ts`). Needs a WebGPU download from Hugging Face. Not run here. Barge-in while she is speaking is implemented (`actions.ts` `openMic`). | **Works on Finn’s Mac, English only.** Kyutai Pocket TTS, Alba voice. Voice-cloning weights are disabled. No barge-in during playback; the user finishes a recording, then hears the reply. Warm turns in the 25 Oct log were about 0.6–1.4 s. |
| Model download / onboarding | **Partially works.** Resumable Cache Storage prefetch from Hugging Face (`llm.ts`, `prep.ts`). Live CSP allows those hosts. Image, VAD, and face files are same-origin and were behind login when probed. Onboarding does not start a download until preparation; this audit stayed on the welcome step. | **Works in code; download not run here.** Pinned files, sizes, and hashes in `Resources/model-catalog.json`. `model_download.py` plus preflight/capacity. Mandatory Safe chat must pass a real “Ready” smoke before other capabilities finish (`Execution.prepareReal`). Python cache and provision tests passed. The Swift download path needs a Mac. |
| Model management | **Partially works.** Pause, resume, cancel, upgrade-to-a-bigger-chat-model, switch fast/best image model, delete downloads. Logic is in `prep.ts` and `actions.ts`. Not clicked through here. | **Partially works.** Receipts in `verified.json`, relaunch revalidation, pause/resume. Covered by `StateTests.swift` (not executed here) and by `test-model-cache.py` (passed). |

## Where the two apps diverge

- **Safe chat model.** Mac: Gemma 4 E4B (MLX, vision-capable). Web: Qwen3.5, or Llama 3.2 1B on a small GPU. Same product name, different brain.
- **Evil chat.** Both use a Heretic-style Qwen3.5. Mac loads a GGUF in llama.cpp and can run without shader-f16. Web needs shader-f16 and will not offer Evil on SwiftShader or on a GPU without it.
- **Images.** Mac: FLUX.2 Klein. Web: Realistic Vision 6 at 512, Z-Image Turbo at 1024 as an opt-in. Mac’s Z-Image entry is disabled.
- **Video.** Mac generates a silent clip. Web always declines.
- **Search and connectors.** Mac can search Wikipedia and can talk to a Composio broker. Web shows both and does neither.
- **Seeing pictures.** Mac Safe chat sends image pixels, PDF text, and four video frames (`Execution.context`). Evil chat refuses images because the vision projector is disabled. Web stores an image attachment and tells the model it cannot see it.
- **Voice.** Mac: multilingual Whisper, English Pocket, push-to-finish. Web: Whisper size picked from the memory budget, Kokoro, barge-in. Different voice, different turn-taking.
- **Context.** Web completions are 4096 tokens. Mac servers start with `--ctx-size 8192` / `--max-kv-size 8192`.
- **What the user sees while downloading.** Mac progress text includes the Hugging Face repo id (`Execution.swift` sets `modelDetails` to `\(model.repo) · bytes`). That is the screen that teaches the user what Hugging Face is.

## Demo risks

1. A “search the web” or “check my email” prompt fails in the browser by design, and on the Mac it fails unless someone turns search on and a broker is running.
2. “Make a video” in the browser is a canned apology.
3. “Show me an image of …” matches the Mac router (`show me` is in `mediaKind`) and does **not** match the web regex (draw / paint / sketch / generate / create / make / render / design). The web then hopes the model prints `[[image: …]]`.
4. Connectors in an Xcode preview flip to connected with no account. The real app errors until a broker URL and a Composio key exist.
5. Evil Mode’s system prompt says never refuse (`SYSTEM_EVIL` in `catalog.ts`). The only hard stop in chat is a CSAM phrase list. A public demo of Evil Mode will produce something the room does not want.
6. The live site is behind `/login`. This audit could not open it. Settings → Sign out links to `/logout`, which is the proxy, not a route in `web/`.
7. A 16 GB Mac is explicitly uncertified. Video’s gate is 16 GB of memory (`AppStore.available`). The catalog’s video weights are about 13.4 GB.
8. The Mac build is ad-hoc signed, needs Xcode 26, and is not a notarized download. There is no `.app` in the repo.

## Punch list

Ordered for a demo that feels like ChatGPT. The UI stays. Prefer a library that already works over a new loop.

Finn’s preference is right, with one hard limit: **WebLLM 0.2.84 will not run OpenAI tool calls.** The call site is commented out in the pinned package. A newer WebLLM is how 0.2.86 broke answers. Do not spend the day on LangChain, the Vercel AI SDK, or Open WebUI. Those replace the UI or assume an HTTP model server. The Mac chat servers already speak the OpenAI tool protocol. That is the harness to finish.

### 1. General web search on the Mac, then prove one live tool round

**What’s wrong.** Search is Wikipedia-only, default off, and no launch log shows the model actually calling it. A news or “latest” question will be a hallucination or a wiki snippet full of HTML (`<span class="searchmatch">`).

**Adopt.** [`ddgs`](https://pypi.org/project/ddgs/) (MIT, Python ≥3.10, current 9.x). It is a metasearch library: DuckDuckGo, Mojeek, Brave, Bing, Wikipedia, and others, no API key. Open-source local UIs use this pattern. It also ships `ddgs[mcp]` if you want the same engine as an MCP server later.

**Why it fits.** Runs inside the Python runtime the Mac app already owns. No key in the app. No AGPL code in the binary. Wikipedia stays as the fallback when a scrape fails.

**Slot.** `executeTool` → `web_search` in `Prometh/Sources/Tools.swift` calls the Wikipedia URL directly. Move that call behind a few lines in `Prometh/Runtime/` that import `DDGS` and return title, url, and snippet. Keep the tool name so `runChatLoop` does not change. Default `webSearch` to on for the demo. Add `ddgs` to the pinned wheel set in `Prometh/Scripts` (the runtime refuses unpinned packages).

**Caveat, not a decision.** `ddgs` is an unofficial client of public search pages. It breaks when a site changes HTML, and the upstream README says it is not affiliated with those engines. See the search recommendation below for the self-hosted alternative.

**Needs.** Finn’s Mac, network during the demo, no API key. Does not touch `web/`.

**Effort.** One tool body plus a pinned dependency. Then one real chat: ask for a current fact, confirm a `web_search` round, confirm the reply cites a returned URL.

### 2. Turn the existing Mac tool loop on, in front of a person

**What’s wrong.** The loop, the SSE tool-call parser, and the approval sheet are written. The automated test never uses a real tool. Gemma (MLX) and Qwen (llama.cpp `--jinja`) can both emit tool calls; nobody has checked that these two servers do it with this client.

**Adopt.** No new agent framework. llama.cpp’s OpenAI server and mlx-vlm’s OpenAI server are the components. `NativChatClient.swift` already speaks them.

**Slot.** Leave `runChatLoop` in `Execution.swift`. After item 1, run the same prompt on Safe and on Evil. If a model narrates a search instead of emitting `tool_calls`, fix the chat template / `--jinja` flags before writing a new parser.

**Needs.** Finn’s Mac. No secret. Does not touch `web/`.

**Effort.** A demo rehearsal plus log reading. Code change only if a server drops `tool_calls`.

### 3. Connectors: use the broker you have, or hide it

**What’s wrong.** The last integration note is still true. Without `COMPOSIO_API_KEY` on an operator machine, and without a provider sign-in, Gmail / Drive / Outlook / GitHub stay disconnected. The UI still offers “Continue in browser”.

**Adopt.** The broker in `Prometh/Runtime/connector_broker.py` is already the integration. Composio stays off the desktop app; the app holds a Keychain install token. Rewriting this as a from-scratch MCP client today is a second protocol in front of the same OAuth wall.

If the key is not coming: the no-key successor is the official [`@modelcontextprotocol/sdk`](https://github.com/modelcontextprotocol/typescript-sdk) (MIT) plus a local server such as `ddgs[mcp]`. That gives search and later files. It does not give Gmail. Skip it for this demo.

**Slot.** Run the broker beside the app, set `connectorBrokerURL`, complete one provider (GitHub is the least surprising). The Mac client already polls `/connections/status` and gates `/tools/execute` on the approval sheet. Fixture tests for that contract passed here.

**Needs.** A Composio key on the broker host, and Finn at the Mac for the OAuth window. Does not touch `web/` unless you also want the browser to grow past “Coming soon”, which still must not embed the key.

**Effort.** Configuration and one signed-in provider. No new connector code if the key exists.

### 4. Browser search that survives the live CSP

**What’s wrong.** The switch is disabled. Even a finished client fetch of Wikipedia would be rejected by `connect-src` on prometh.leyten.dev. WebLLM will not emit native tool calls (see the limit above).

**Adopt.** Same search engine as the Mac (`ddgs` or SearXNG), behind a **same-origin** URL so CSP already allows it. The site already has `/login` and `/logout` in front of the static app, so a small `/search` route fits the host that exists. Do not call Hugging Face for search. Do not put a search key in the static bundle.

**Slot.** A route on the Leyten host. In `web/src/state/actions.ts`, handle a single explicit line the model already knows how to emit (the same idea as `[[image: …]]`, for example `[[search: …]]`), fetch `/search`, append the snippets, and take one more `streamChat` turn. That is a two-line protocol in the system prompt, which is the only tool channel this WebLLM pin actually honors. Keep it to search and the existing image line. Do not build a general agent runtime in the browser today.

**Needs.** Leyten’s host (the proxy in front of `web/`), and a small edit under `web/src/state/actions.ts` and `catalog.ts`. No Composio key. A SearXNG or `ddgs` process next to the site.

**Effort.** One host route and one extra completion. This is the browser half of “as good as ChatGPT” for facts. It is the one web change worth doing before other web work.

### 5. Make image and voice prep succeed from a checkout

**What’s wrong.** Voice turn-taking and the image safety net download `/models/checks/silero_vad.onnx` and `/models/checks/yunet-2023mar.onnx`. Those files are not in git. Image weights (`/models/rv-hyper-v1/`, `/models/zimage/`, about 8 GB) are not in git either. A clone prepares chat from Hugging Face and then fails voice and images. The live paths redirected to login, so this audit could not prove the hosted copies.

**Adopt.** Keep the current engines. They are already the proven ones: Transformers.js Whisper, `kokoro-js`, Silero VAD (MIT), OpenCV YuNet, and the ONNX diffusion pipeline. `@ricky0123/vad-web` (ISC, bundles Silero) would replace a barge-in detector that already has tests. Use it only as a source of the ONNX file if you do not want to fetch Silero upstream yourself. Do not swap image generation to ComfyUI or Automatic1111; they are separate apps and they do not run as WebGPU inside this page.

**Slot.** Put the two small check models in `web/public/models/checks/` (or confirm the login-gated host actually serves them). Leave the multi-gigabyte diffusion weights on the host. `image-check.ts` fails closed when YuNet is missing, so a missing file looks like “images are broken”, not like a skipped safety check.

**Needs.** Leyten’s model files, or a copy of the two small ONNX files. Touches `web/` only if the files land in the repo. No Mac. No API key. Confirm on a GPU that has shader-f16. This VM cannot.

**Effort.** File placement and one prepare click. No sampler rewrite.

### 6. Stop showing Hugging Face repo ids while models download

**What’s wrong.** Mac preparation detail is `mlx-community/gemma-4-e4b-it-4bit · 1.2 GB / 5.2 GB`.

**Adopt.** Nothing. The download stack (pinned catalog, `model_download.py`, preflight) is the right one.

**Slot.** `modelDetails` in `Prometh/Sources/Execution.swift`. Show the catalog `name` (“Gemma 4 · Safe”) and the byte count.

**Needs.** Finn’s Mac to see the onboarding row. Does not touch `web/`.

**Effort.** A string change. Do it only with a Mac in front of you; this VM cannot compile Swift.

### 7. Leave these engines alone today

Replacing them would throw away the 25 Oct evidence.

| Piece | Keep | Do not swap in today |
|---|---|---|
| Mac chat | `mlx-vlm-server` + `llama-server` via `llama_supervisor.py` | Ollama. It has a nicer pull UX and OpenAI tools, and it does not run FLUX, FastMetal, or Pocket. A second downloader fights “the user never manages models”. |
| Mac images | mflux, FLUX.2 Klein (`media_worker.py`) | A new diffusers stack. Z-Image stays off until someone verifies it; the catalog already says so. |
| Mac video | FastVideo / FastMetal MLX | A browser video model. Nothing in WebGPU is a 5-second clip you can demo this afternoon. The web stub is the honest answer. |
| Mac voice | mlx-audio Whisper + Pocket TTS | A new TTS. Pocket is English-only; say that in the demo. |
| Web chat runtime | WebLLM 0.2.84 + the shape-cache patch | WebLLM 0.2.86+, wllama, or transformers.js-as-the-chat-model. You would re-test every answer. |
| Web voice | Whisper + Kokoro workers | A server-side speech API. It breaks the local promise. |

### 8. Demo script, so the unfinished rows are not the first click

- Browser, on a machine with shader-f16: chat, then “Draw a glass house at sunrise”, then voice if `/models/checks/silero_vad.onnx` returns 200 while logged in. Skip video, search, plugins, and Evil Mode.
- Browser on a GPU without f16 (this VM, and some Windows GPUs): Safe chat on the q4f32 model only. Images and Evil will refuse. Say so before the click.
- Mac: chat, image, silent video, voice, then one search question **after** item 1 is in. Skip Plugins until item 3 has a signed-in provider. Do not use the Xcode preview for any of this; it invents replies, media, and connector state (`Simulation.swift`, `AppStore.startResponse`).

## Web search recommendation

This is a recommendation, not a decision.

Use two layers:

1. **Default, no extra server, MIT, inside the Mac app:** `ddgs`, called from the existing `web_search` tool, with the current Wikipedia request kept as fallback. The browser cannot import that library. It reaches search through a same-origin `/search` on Leyten’s host (item 4), which can run the same library.
2. **The private, self-hostable index:** [SearXNG](https://github.com/searxng/searxng) (AGPL-3.0). Run it unmodified next to the product. Enable the JSON format and call `GET /search?q=&format=json`. Do not copy SearXNG into this repo. AGPL’s network clause matters if you ship a modified SearXNG as a service; an unmodified sidecar that the app calls over HTTP keeps that code out of Prometh. Public instances usually disable JSON, so do not point the demo at one.

Skip a hosted search API key (Brave, Tavily, Google) in the desktop binary. That repeats the Composio problem: a secret the app should not contain. Ollama’s cloud web search also needs `OLLAMA_API_KEY`, so it fails the same test.

Wikipedia alone is a good fallback and a bad demo of “search”. It is what the Mac does today.
