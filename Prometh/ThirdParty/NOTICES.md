# Third-party software and model notices

Prometh adapts Nativ's MIT-licensed PythonDistribution packaging, native launcher,
server overlay, and capability manifest generator from commit
`55493b75315e53ea446eb22afe5df05d56fc1c9a`.
Changes: owned runtime locations, exact hashed wheel dependencies, verified source
archives, independent media prefix, explicit provider gates and release metadata.
The existing `Nativ-LICENSE.txt` accompanies the source and application.

The standalone build downloads only the following pinned archives, with SHA-256
values recorded in `Scripts/provision-runtime.py` and the built application's
`runtime-provenance.json`:

| Component | Source | License/notices retained |
| --- | --- | --- |
| CPython 3.12.13, PBS 20260508 | https://github.com/astral-sh/python-build-standalone/releases/tag/20260508 | CPython and bundled library licenses remain inside each Python prefix |
| llama.cpp b11669, commit 620d2225c | https://github.com/ggml-org/llama.cpp/releases/tag/b11669 | MIT; archive LICENSE retained in `llama/` |
| FastVideo commit 8db2d71ef217e84bec7dbb6e4ab65c92b144df4f | https://github.com/hao-ai-lab/FastVideo | Apache-2.0; LICENSE and original Python source retained in `FastVideo/` |
| Python wheels | https://pypi.org/ | Exact versions and wheel hashes in `Scripts/requirements/`; `.dist-info` licenses retained; generated `Runtime/DEPENDENCIES.json` and `MediaRuntime/DEPENDENCIES.json` inventory installed metadata |

Notable runtime packages: MLX, MLX-VLM, MLX-Audio and MFLUX are MIT licensed;
FastVideo is Apache-2.0. PyTorch includes Apache, BSD, MIT, BSL and LLVM exception
components; consult its bundled licenses. Pocket TTS's package includes its own
LICENSE. Package metadata is an inventory, not a substitute for the full license
texts shipped with each package.

**Binary redistribution requirement:** imageio-ffmpeg's Python wrapper is BSD,
but its bundled arm64 FFmpeg 7.1 executable reports `--enable-gpl`, including
x264/x265 and other libraries. Its source and license obligations differ from
the wrapper. Preserve FFmpeg's license, all dependency notices and provide
complete corresponding source for the exact distributed executable before a
public binary release; see https://ffmpeg.org/legal.html. The current source repository and local ad-hoc builds do
not certify that this complete source distribution has been assembled. Do not
label this application's entire dependency stack “MIT” or “Apache”. PyAV also
bundles FFmpeg libraries with their own notices. No locallyuncensored AGPL code
is included by this build.

Model weights are separate downloads; the source and app bundle contain no
weights. Model cards, individual terms and license text must be checked for the
exact catalog revision before redistributing weights. Gemma's terms are separate
from permissive runtime code. Enabling Evil mode does not change weight licenses.
The catalog records pinned Hugging Face repositories/revisions/checksums; it is
not a blanket permission to redistribute their models. No weights from the
installed Nativ application or user model directory are copied by packaging.

UI image/logo attribution is recorded in `Documentation/PROVIDER_ASSETS.md`,
`Documentation/REUSE.md` and the accompanying license files. Preserve these
notices with a source release.
