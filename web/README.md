# Prometh web

The browser half of Prometh: the Mac app's UI rebuilt as a web app, with real models running on the
visitor's own GPU through WebGPU. Live at https://prometh.leyten.dev (login required).

## What runs where

| Capability | Engine | Model | Size |
|---|---|---|---|
| Chat (Safe Mode) | WebLLM 0.2.84 | Qwen3.5 9B / 4B / 2B or Llama 3.2 1B, picked by a GPU-memory probe; q4f32 twins when the GPU lacks shader-f16 | 0.7 to 5 GB |
| Chat (Evil Mode) | WebLLM 0.2.84 | leyten's Heretic-decensored Qwen3.5 9B / 4B (same builds and libs as the c0mpute browser worker) | 2.4 or 5 GB |
| Voice | Transformers.js 4.3.1 + kokoro-js 1.2.1 | Whisper base or large-v3-turbo (listening), Kokoro 82M (speaking), Silero VAD v5 (turn-taking) | 0.5 to 1.1 GB |
| Images | ONNX Runtime Web (WebGPU) | Realistic Vision 6 + Hyper-SD 4-step at 512 px; opt-in Z-Image Turbo at 1024 px | 2.3 or 6.2 GB |
| Video | none | points to the Mac app | |

Model inference runs client-side. A small Node backend handles web search, page reading and Composio
connections/actions, and can also serve the static build. Chat, Whisper, Kokoro and the
image-check models come from Hugging Face (model libs from mlc-ai's GitHub), straight into the
browser's Cache Storage. Chats live in localStorage, images in IndexedDB.

The image models and two small helpers are self-hosted under `/models/` (about 8 GB, not in git):

- `/models/rv-hyper-v1/`: Realistic Vision 6 with Hyper-SD merged, converted to ONNX fp16
- `/models/zimage/`: Z-Image Turbo, q4f16 ONNX, with an fp32-inside VAE (the fp16 one gave NaN)
- `/models/checks/`: Silero VAD v5 and the OpenCV YuNet face detector

For local dev, copy them into `public/models/` (ask leyten for the files).

WebLLM is pinned to 0.2.84 with c0mpute's one-line shape-cache patch (`patches/`, applied by
patch-package on install). 0.2.86 produced garbage output in testing where 0.2.84 answered correctly
(same model, same prompt, SwiftShader), so don't upgrade without re-running that check.

## Safety

A CSAM blocklist (same list as c0mpute) applies to chat output in every mode. Image prompts go through
a stricter gate (`prompt-gate.ts`), and every generated image is checked before it is shown
(`image-check.ts`: NSFW classifier, face detector, age estimate with a per-model threshold).

## Layout

- `src/engine/`: device probe (`device.ts`), model catalog and prompts (`catalog.ts`), preparation queue
  with pause/resume (`prep.ts`), WebLLM wrapper with our own resumable weight prefetch (`llm.ts`),
  speech, VAD and image workers (`*.worker.ts`, `media.ts`, `sd.ts`, `zimage.ts`), mic capture and
  playback (`audio.ts`, `public/mic-worklet.js`), turn-taking (`vad.ts`), image safety checks.
- `server/`: host-neutral `handle(Request)` API, Node HTTP/static adapter, SearXNG proxy, DNS-pinned
  Readability reader and Composio v3.1 REST client. Credentials stay on the server.
- `src/engine/tools.ts`: native Qwen/Hermes tool protocol, bounded tool loop and context budget;
  `search.ts` selects fetched sources; `connector-policy.ts` is shared by client and server.
- `src/state/`: persisted store (`store.ts`) and all user actions (`actions.ts`).
- `src/ui/`: onboarding, workspace, settings (incl. the Turbo tensor-core tutorial), media, overlays.
- `test/`: prompt gate, turn-taking, connector policy, search, tool-loop and API/reader tests.

## Build

```sh
npm ci            # also copies the ONNX Runtime wasm into public/ort/
npm run server    # backend on :8787 (in a separate terminal)
npm run dev       # Vite; /api proxies to :8787
npm run build     # tsc + vite build -> dist/
npm run typecheck # browser + server, including Node erasable-syntax check
npm test
```

## Backend configuration

Use Node 26. Export the server variables documented in [`.env.example`](.env.example); Vite never
receives these credentials. The template is documentation, not an automatically loaded env file.
For local web search with a JSON-enabled SearXNG instance:

```sh
SEARXNG_URL=http://127.0.0.1:8888 npm run server
```

The backend reads `COMPOSIO_API_KEY` from its environment, or from the file named by
`PROMETH_COMPOSIO_ENV`. In development only it also falls back to
`~/.config/prometh/composio.env`. Never add the key to a `VITE_` variable or client code.
Without configuration, Customize explains that plugins or search are unavailable.

`COMPOSIO_USER_ID` optionally selects a fixed user for local/single-user use. Otherwise the backend
assigns each browser a random identity in the signed, httpOnly `prometh_uid` cookie. Production
requires a persistent `PROMETH_SESSION_SECRET` for this mode; development generates one per process.
The Node adapter honors `X-Forwarded-Proto: https` for TLS-terminating reverse proxies; a proxy must
set/overwrite this header. Host adapters passing HTTPS Request URLs also get Secure cookies.

```sh
npm run build
npm start         # NODE_ENV=production, serves dist/ and /api, default PORT=8787
```

Production must supply the key or an explicit private env-file path. Any other host can import
`server/app.ts` and mount `handle(request)` for `/api/*`; no framework or hosting configuration is
required. The Node adapter serves static files and uses the built index for SPA routes.
Any reverse proxy in front of the Node server must preserve the Host header for the same-origin check.

Web search defaults on in Customize → Tools. Current-events cues prefetch three distinct-domain
pages; only readable fetched pages receive numbered citations. Tool results and schemas share the
4096-token prompt budget. Models get at most four tool steps before a final answer without tools;
small models can ignore the native protocol. Large schemas are narrowed to complete schemas that
fit, and large results include omission notes. Skills that leave too little context produce a clear
error instead of cutting through tool JSON.

Composio write actions pause on an inline Allow once / Always allow / Don't allow card. Always-allow
is stored per exact `toolkit:ACTION`; each plugin row can reset its entries. Reloading cancels an
unfinished approval and never executes it. Read/write classification is also checked on the server
using upstream metadata. No write executes without the browser explicitly setting approval after
the policy/consent flow. Queries, page URLs and app action arguments go to the backend and their
providers; model inference, saved chats, voice and image generation remain in the browser.

## Testing without a GPU

Headless Chrome can run WebGPU on the CPU through SwiftShader
(`--enable-unsafe-webgpu --use-webgpu-adapter=swiftshader --enable-unsafe-swiftshader`). It has no
shader-f16, so it exercises the q4f32 path. Set `localStorage['prometh.maxBudgetMB'] = '1300'` to force
the 1B model.
