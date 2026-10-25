#!/usr/bin/env python3
"""Refresh exact, immutable HF artifact manifests without downloading weights.

Python standard library only. The generated catalog intentionally distinguishes
artifact bytes from estimated resident memory and provisional runtime support.
"""
import argparse
import datetime
import json
import pathlib
import urllib.parse
import urllib.request

ROOT = pathlib.Path(__file__).resolve().parents[1]
SPECS = [
    dict(id="safe", name="Gemma 4 E4B · Safe", capability="Chat", repo="mlx-community/gemma-4-e4b-it-4bit", runtime="mlx-vlm", enabled=True, mandatory=True, workingMemoryGB=8.0, include=["*.json", "*.jinja", "model.safetensors"], notes="4-bit MLX conversion. Apply instruct chat template. Vision/audio require actual processor and smoke verification. Conversion metadata says gemma; current upstream declares Apache-2.0; preserve both until reconciled."),
    dict(id="stt", name="Whisper large v3 turbo", capability="Voice", repo="mlx-community/whisper-large-v3-turbo", runtime="mlx-audio", enabled=True, workingMemoryGB=2.5, include=["config.json", "weights.safetensors"], notes="Multilingual transcription only. Conversion omits license metadata; upstream openai/whisper MIT provenance must accompany distribution."),
    dict(id="stt-processor", name="Whisper tokenizer and audio processor", capability="Voice", repo="openai/whisper-large-v3-turbo", runtime="mlx-audio", enabled=True, workingMemoryGB=0.1, include=["added_tokens.json", "config.json", "generation_config.json", "merges.txt", "normalizer.json", "preprocessor_config.json", "special_tokens_map.json", "tokenizer.json", "tokenizer_config.json", "vocab.json"], notes="Official MIT processor assets required by mlx-audio0.6.1 for the selected weights-only MLX conversion. No additional weights."),
    dict(id="tts", name="Pocket TTS · built-in voices", capability="Voice", repo="kyutai/pocket-tts-without-voice-cloning", runtime="pocket-tts", enabled=True, workingMemoryGB=1.0, include=["languages/english_2026-09_2/model.safetensors", "languages/english_2026-09_2/tokenizer.json", "languages/english_2026-09_2/embeddings/alba.safetensors"], notes="Official ungated no-cloning checkpoint, CC-BY-4.0 weights, MIT code. Built-in voice only. Config must point to downloaded pinned local artifacts. Other languages are separate optional artifacts, not all downloaded."),
    dict(id="tts-cloning", name="Pocket TTS · optional voice cloning", capability="Voice", repo="kyutai/pocket-tts", runtime="pocket-tts", enabled=False, workingMemoryGB=1.0, include=["languages/english_2026-09_2/model.safetensors", "languages/english_2026-09_2/tokenizer.json", "languages/english_2026-09_2/embeddings/alba.safetensors"], notes="Gated access requires user-authorized HF acceptance/token. Not required for normal built-in-voice speech."),
    dict(id="evil", name="Qwen3.5 9B Heretic v2 · Evil", capability="Chat", repo="filvyb/Qwen3.5-9B-heretic-v2-GGUF", runtime="llama.cpp", enabled=True, workingMemoryGB=8.5, include=["Qwen3.5-9B-heretic-v2-Q4_K_M.gguf"], notes="Correct trohrbaugh base conversion. Q4_K_M only; cannot load GGUF in MLX. Lower refusal tuning does not guarantee zero refusals. One chat checkpoint resident at a time."),
    dict(id="evil-vision-projector", name="Evil vision projector · optional", capability="Chat", repo="filvyb/Qwen3.5-9B-heretic-v2-GGUF", runtime="llama.cpp-mtmd", enabled=False, workingMemoryGB=1.2, include=["mmproj-Qwen3.5-9b-heretic-v2-F16.gguf"], notes="Same repository/base projector. Separate from text-only Q4_K_M. Enable only after llama.cpp Qwen3.5 multimodal compatibility smoke succeeds."),
    dict(id="images", name="FLUX.2 Klein 4B · 4-bit", capability="Images", repo="Runpod/FLUX.2-klein-4B-mflux-4bit", runtime="mflux", enabled=True, workingMemoryGB=6.0, include=["config.json", "text_encoder/*", "tokenizer/*", "transformer/*", "vae/*"], notes="Publisher identifies official Apache-2.0 base and mflux-save 4-bit conversion; artifact layout/indexes verified, runtime not yet smoke tested. Use low-ram callbacks/CLI and serialize heavy jobs. Supports Flux2Klein and Flux2KleinEdit."),
    dict(id="images-source", name="FLUX.2 Klein 4B · official conversion source", capability="Images", repo="black-forest-labs/FLUX.2-klein-4B", runtime="mflux-conversion", enabled=False, workingMemoryGB=20.0, include=["model_index.json", "scheduler/*", "text_encoder/*", "tokenizer/*", "transformer/*", "vae/*", "LICENSE.md"], notes="Official diffusers components only. Excludes duplicate root flux-2-klein-4b.safetensors and sample media. Source for local quantization if compressed conversion validation fails. Temporary conversion memory/disk exceed normal inference."),
    dict(id="zimage", name="Z-Image Turbo · provisional 4-bit", capability="Images", repo="filipstrand/Z-Image-Turbo-mflux-4bit", runtime="mflux", enabled=False, workingMemoryGB=8.0, include=["text_encoder/*", "tokenizer/*", "transformer/*", "vae/*"], notes="Disabled pending real job and license reconciliation: official Tongyi-MAI/Z-Image-Turbo is Apache-2.0 but conversion metadata says other/FLUX.1-dev. Img2img is not instruction editing. No refusal guarantee."),
    dict(id="video", name="FastMetal 1.3B QAD", capability="Video", repo="FastVideo/FastMetal-1.3B-QAD", runtime="fastvideo-mlx", enabled=True, workingMemoryGB=6.0, include=["mlx_dit.json", "mlx_dit.safetensors", "model_index.json", "scheduler/*", "text_encoder/*", "tokenizer/*", "vae/*"], notes="T2V only in released MLX examples, silent ~5s 480p. Packed MLX DiT plus T5 encoder and Wan VAE. Use --decode-backend wan-vae to avoid undeclared TAEHV downloads. ffmpeg must be shipped or output encoded through AVFoundation. Estimated memory is not a 16GB certification."),
]


def fetch(repo, revision=None):
    path = "/api/models/" + repo
    if revision:
        path += "/revision/" + urllib.parse.quote(revision, safe="")
    request = urllib.request.Request("https://huggingface.co" + path + "?blobs=true", headers={"User-Agent": "Prometh-catalog-builder/1"})
    with urllib.request.urlopen(request, timeout=60) as response:
        return json.load(response)


def build_model(spec):
    import fnmatch
    info = fetch(spec["repo"])
    revision = info["sha"]
    # A second pinned request prevents branch updates racing artifact enumeration.
    info = fetch(spec["repo"], revision)
    result = {k: v for k, v in spec.items() if k != "include"}
    result.update(revision=revision, license=info.get("cardData", {}).get("license"), gated=info.get("gated", False), memoryEstimate=True, testedOn16GB=False)
    result["files"] = []
    for entry in info["siblings"]:
        name = entry["rfilename"]
        if not any(fnmatch.fnmatchcase(name, p) for p in spec["include"]):
            continue
        lfs = entry.get("lfs") or {}
        algorithm = "sha256" if lfs else "git-blob-sha1"
        digest = lfs.get("sha256") or entry.get("blobId")
        if not digest or not isinstance(entry.get("size"), int):
            raise RuntimeError(f"Missing size/hash for {spec['repo']}:{name}")
        result["files"].append(dict(path=name, size=entry["size"], hashAlgorithm=algorithm, hash=digest, sha256=lfs.get("sha256"), oid=entry.get("blobId"), contentID=algorithm+":"+digest, url=f"https://huggingface.co/{spec['repo']}/resolve/{revision}/{urllib.parse.quote(name, safe='/')}"))
    if not result["files"]:
        raise RuntimeError(f"No selected artifacts for {spec['repo']}")
    result["summary"] = spec["notes"]
    result["downloadBytes"] = sum(f["size"] for f in result["files"])
    result["weightBytes"] = sum(f["size"] for f in result["files"] if f["path"].endswith((".safetensors", ".gguf", ".bin")))
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=pathlib.Path, default=ROOT / "Resources/model-catalog.json")
    parser.add_argument("--only", action="append", help="Model IDs to refresh; retain existing other entries")
    args = parser.parse_args()
    old = json.loads(args.output.read_text()) if args.only and args.output.exists() else {}
    models = {m["id"]: m for m in old.get("models", [])}
    for spec in SPECS:
        if args.only and spec["id"] not in args.only:
            continue
        model = build_model(spec)
        models[model["id"]] = model
        print(model["id"], model["revision"], model["downloadBytes"], flush=True)
    payload = dict(schemaVersion=1, generatedAt=datetime.datetime.now(datetime.timezone.utc).isoformat(), storagePolicy=dict(deduplicateBy="contentID", partialFileSuffix=".partial", reserveTemporaryDownloadBytes=True, macOSHeadroomBytes=8_000_000_000, note="Exact selected artifact sizes. Headroom and resident memory are policy estimates. Cache requires size and content hash validation. Reserve on actual cache volume and recheck before writes."), models=list(models.values()))
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(payload, indent=2)+"\n")

if __name__ == "__main__":
    main()
