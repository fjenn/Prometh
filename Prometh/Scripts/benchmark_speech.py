#!/usr/bin/env python3
"""Compare owned speech workers on a known WAV; never opens the microphone.

Example: python3 Scripts/benchmark_speech.py --mode persistent --runs 4
Use --worker dist/Prometh.app/Contents/Resources/media_worker.py --mode once
to compare a previously built baseline. Output is an append-only JSONL ledger.
"""
import argparse
import json
import os
from pathlib import Path
import subprocess
import time
import uuid


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--mode", choices=("once", "persistent"), default="persistent")
    parser.add_argument("--kind", choices=("stt", "tts", "both"), default="both")
    parser.add_argument("--runs", type=int, default=4)
    parser.add_argument("--worker", type=Path)
    parser.add_argument("--ledger", type=Path, default=Path("/tmp/prometh-speech-benchmark/ledger.jsonl"))
    args = parser.parse_args()
    root = Path(__file__).resolve().parents[1]
    worker = args.worker or root / "Runtime/media_worker.py"
    args.ledger.parent.mkdir(parents=True, exist_ok=True)
    for kind in (("stt", "tts") if args.kind == "both" else (args.kind,)):
        prefix = root / ".build" / ("MediaRuntime" if kind == "tts" else "Runtime") / "python"
        env = dict(os.environ, PYTHONHOME=str(prefix), PYTHONNOUSERSITE="1", PYTHONDONTWRITEBYTECODE="1", HF_HUB_OFFLINE="1", TRANSFORMERS_OFFLINE="1")
        for key in ("PYTHONPATH", "PROMETH_TTS_PYTHON", "PROMETH_STT_PYTHON"):
            env.pop(key, None)
        command = [str(prefix / "bin/python3"), str(worker)]
        process = None
        with args.ledger.with_suffix(".stderr").open("a") as err:
            try:
                for index in range(args.runs):
                    started = time.monotonic()
                    if process is None:
                        process = subprocess.Popen(command + (["--serve"] if args.mode == "persistent" else []), stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=err, text=True, env=env)
                    job = dict(kind=kind, requestID=uuid.uuid4().hex, modelRoot=str(Path.home()/"Library/Application Support/PromethPrototype/Models"), catalog=str(root/"Resources/model-catalog.json"), outputRoot=str(args.ledger.parent/"outputs"))
                    if kind == "stt":
                        job["input"] = str(root/"Resources/voice-demo.wav")
                    else:
                        job["prompt"] = "Independent quality check. The red sailboat is floating on a calm lake."
                    process.stdin.write(json.dumps(job) + "\n")
                    process.stdin.flush()
                    if args.mode == "once":
                        process.stdin.close()
                    first = None
                    result = None
                    for line in process.stdout:
                        event = json.loads(line)
                        if "error" in event:
                            raise RuntimeError(event["error"])
                        if "audioChunk" in event and first is None:
                            first = time.monotonic() - started
                        if event.get("event") == "result":
                            result = event
                        if event.get("event") == "requestDone":
                            break
                    if result is None:
                        raise RuntimeError("Worker ended without a result")
                    if kind == "stt" and "calm, creative weekend" not in result.get("text", "").lower():
                        raise RuntimeError("Known-WAV transcription correctness failed")
                    if kind == "tts" and not (result.get("sampleRate") == 24000 and result.get("durationSeconds", 0) > 1):
                        raise RuntimeError("TTS output correctness failed")
                    row = dict(mode=args.mode, kind=kind, index=index, cold=index == 0 or args.mode == "once", wallSeconds=round(time.monotonic()-started, 4), firstAudioSeconds=round(first, 4) if first is not None else None, correct=True, worker=str(worker), result=result)
                    with args.ledger.open("a") as ledger:
                        ledger.write(json.dumps(row)+"\n")
                    print(json.dumps({k:v for k,v in row.items() if k != "result"}), flush=True)
                    if args.mode == "once":
                        if process.wait(timeout=5):
                            raise RuntimeError("Worker exited unsuccessfully")
                        process = None
            finally:
                if process is not None:
                    process.terminate()
                    try:
                        process.wait(timeout=3)
                    except subprocess.TimeoutExpired:
                        process.kill()
                        process.wait()


if __name__ == "__main__":
    main()
