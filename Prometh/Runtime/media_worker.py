#!/usr/bin/env python3
"""One real local media job per process; stdout is exclusively NDJSON.

Read a job JSON from stdin, or pass its JSON file as argv[1]. Optional runtime
interpreter overrides: PROMETH_IMAGE_PYTHON, PROMETH_VIDEO_PYTHON,
PROMETH_STT_PYTHON, PROMETH_TTS_PYTHON. No provider downloads are allowed here.
"""
from __future__ import annotations
import contextlib
import importlib.util
import json
import os
from pathlib import Path
import resource
import signal
import subprocess
import sys
import threading
import time
import uuid

ROOT = Path(__file__).resolve().parent
_PROTOCOL = None
_CHILD = None
_STOP = threading.Event()
_REQUEST_ID = None
_STT_CACHE = None
_TTS_CACHE = None


def emit(event, **values):
    stream = _PROTOCOL or sys.stdout
    if event == "stage":
        values["stageCode"] = values.get("stage")
        values["stage"] = values.get("message", values.get("stage"))
    if _REQUEST_ID is not None:
        values["requestID"] = _REQUEST_ID
    stream.write(json.dumps({"event": event, **values}, ensure_ascii=False) + "\n")
    stream.flush()


def package(name):
    if importlib.util.find_spec(name) is None:
        raise RuntimeError(f"The packaged {name} runtime is unavailable. Rebuild or install this capability's runtime.")


def child(command, env):
    global _CHILD
    emit("stage", stage="running", message="Generating with the selected local model")
    _CHILD = subprocess.Popen(command, stdout=sys.stderr, stderr=sys.stderr, env=env)
    try:
        status = _CHILD.wait()
        if _STOP.is_set():
            raise InterruptedError("Cancelled")
        if status:
            raise RuntimeError(f"The local provider exited with status {status}. See the provider log for details.")
    finally:
        if _CHILD and _CHILD.poll() is None:
            _CHILD.terminate()
        _CHILD = None


def interpreter(kind):
    return os.environ.get(f"PROMETH_{kind.upper()}_PYTHON", sys.executable)


def choose_model(job, identifier):
    catalog = job.get("catalog") or str(ROOT.parent / "Resources/model-catalog.json")
    if isinstance(catalog, str):
        catalog = json.loads(Path(catalog).expanduser().read_text())
    model = next((m for m in catalog["models"] if m["id"] == identifier), None)
    if not model:
        raise ValueError(f"No catalog entry for {identifier}")
    if not model.get("enabled", False):
        raise ValueError(f"{model.get('name', identifier)} is not enabled: {model.get('summary', '')}")
    base = Path(job["modelRoot"]).expanduser().resolve()
    key = model["repo"].replace("/", "--") + "--" + model["revision"][:12]
    directory = base if (base / model["files"][0]["path"]).is_file() else base / key
    missing = []
    for entry in model["files"]:
        path = directory / entry["path"]
        if not path.is_file() or path.stat().st_size != entry["size"]:
            missing.append(entry["path"])
    if missing:
        raise FileNotFoundError(f"{model['name']} needs verified local files: " + ", ".join(missing[:3]) + ("…" if len(missing)>3 else ""))
    return model, directory


def require_input(job):
    path = Path(job.get("input", "")).expanduser().resolve()
    if not job.get("input") or not path.is_file():
        raise FileNotFoundError("Choose an existing local input file for this operation.")
    return path


def offline_environment(output):
    env = dict(os.environ)
    env.update(HF_HUB_OFFLINE="1", TRANSFORMERS_OFFLINE="1", HF_HUB_DISABLE_TELEMETRY="1", PYTHONNOUSERSITE="1", PYTHONDONTWRITEBYTECODE="1", TOKENIZERS_PARALLELISM="false")
    env["HF_HOME"] = str(output / ".provider-cache")
    # Relative runtime launchers already set PYTHONHOME. For a deliberately
    # separate capability interpreter, derive its own standalone prefix.
    return env


def process_image(job, output, env):
    model, directory = choose_model(job, "images")
    editing = bool(job.get("input"))
    module = "mflux.models.flux2.cli.flux2_edit_generate" if editing else "mflux.models.flux2.cli.flux2_generate"
    target = output / (uuid.uuid4().hex + ".png")
    command = [interpreter("image"), "-m", module, "--model", str(directory), "--base-model", "flux2-klein-4b", "--prompt", job.get("prompt", ""), "--steps", str(int(job.get("steps", 4))), "--seed", str(int(job.get("seed", 42))), "--width", str(int(job.get("width", 512))), "--height", str(int(job.get("height", 512))), "--low-ram", "--output", str(target)]
    if editing:
        command += ["--image-paths", str(require_input(job))]
    child(command, environment_for_interpreter(env, command[0]))
    if not target.is_file() or target.stat().st_size == 0:
        raise RuntimeError("Image provider completed without a generated image.")
    package("PIL")
    from PIL import Image
    with Image.open(target) as image:
        image.verify()
    return dict(path=str(target), filename=str(target), kind="image", model=model["repo"], revision=model["revision"])


def environment_for_interpreter(env, executable):
    result = dict(env)
    executable = Path(executable).resolve()
    if str(executable) != str(Path(sys.executable).resolve()):
        result.pop("PYTHONHOME", None)
        result.pop("PYTHONPATH", None)
        if (executable.parent.parent / "lib").is_dir():
            result["PYTHONHOME"] = str(executable.parent.parent)
    return result


def process_stt(job, output, env):
    global _STT_CACHE
    package("mlx_audio")
    _, directory = choose_model(job, "stt")
    # This MLX conversion predates processor packaging. Current mlx-audio
    # requires the explicit official processor component for tokenization.
    _, processor_directory = choose_model(job, "stt-processor")
    key = (str(directory), str(processor_directory))
    if _STT_CACHE is None or _STT_CACHE[0] != key:
        emit("stage", stage="loading", message="Loading local Whisper")
        from mlx_audio.stt.utils import load_model
        from transformers import WhisperProcessor
        model = load_model(str(directory))
        model._processor = WhisperProcessor.from_pretrained(str(processor_directory), local_files_only=True)
        _STT_CACHE = (key, model)
    model = _STT_CACHE[1]
    if job.get("prepareOnly"):
        return dict(kind="stt", prepared=True)
    source = require_input(job)
    emit("stage", stage="transcribing", message="Transcribing your recording")
    options = {}
    if job.get("language"):
        options["language"] = job["language"]
    result = model.generate(str(source), **options)
    text = result.text
    target = output / (uuid.uuid4().hex + ".txt")
    target.write_text(text)
    return dict(path=str(target), filename=str(target), text=text, kind="stt")


def process_tts(job, output, env):
    global _TTS_CACHE
    package("pocket_tts")
    package("yaml")
    model_info, directory = choose_model(job, "tts")
    import importlib.resources
    import numpy as np
    import yaml
    from pocket_tts import TTSModel
    from scipy.io.wavfile import write
    relative = "languages/english_2026-09_2/"
    if _TTS_CACHE is None or _TTS_CACHE[0] != str(directory):
        emit("stage", stage="loading", message="Loading local Pocket TTS")
        source = importlib.resources.files("pocket_tts").joinpath("config/english_2026-09_2.yaml")
        config = yaml.safe_load(source.read_text())
        config["weights_path"] = str(directory / (relative + "model.safetensors"))
        config["weights_path_without_voice_cloning"] = None
        config["flow_lm"]["lookup_table"]["tokenizer_path"] = str(directory / (relative + "tokenizer.json"))
        config_path = output / (uuid.uuid4().hex + ".pocket.yaml")
        config_path.write_text(yaml.safe_dump(config))
        try:
            model = TTSModel.load_model(config=config_path)
            model.has_voice_cloning = False
            state = model.get_state_for_audio_prompt(directory / (relative + "embeddings/alba.safetensors"))
            _TTS_CACHE = (str(directory), model, state)
        finally:
            config_path.unlink(missing_ok=True)
    model, state = _TTS_CACHE[1:]
    if job.get("prepareOnly"):
        return dict(kind="tts", prepared=True)
    emit("stage", stage="speaking", message="Generating speech")
    chunks = []
    first = True
    for chunk in model.generate_audio_stream(state, job.get("prompt", ""), stop=_STOP):
        if _STOP.is_set():
            raise InterruptedError("Cancelled")
        chunk_array = chunk.detach().cpu().numpy().reshape(-1).astype(np.float32)
        chunks.append(chunk_array)
        if job.get("stream", True):
            chunk_path = output / ("speech-" + uuid.uuid4().hex + ".chunk.wav")
            write(chunk_path, model.sample_rate, (np.clip(chunk_array, -1, 1) * 32767).astype(np.int16))
            emit("audio", audioChunk=str(chunk_path), sampleRate=model.sample_rate, durationSeconds=len(chunk_array)/model.sample_rate)
        if first:
            emit("stage", stage="audio-ready", message="Speech audio is being generated")
            first = False
    if not chunks:
        raise RuntimeError("Pocket TTS generated no audio.")
    audio = np.concatenate(chunks, axis=-1).reshape(-1).astype(np.float32)
    if len(audio) < model.sample_rate // 10 or not np.isfinite(audio).all():
        raise RuntimeError("Pocket TTS returned invalid audio.")
    target = output / (uuid.uuid4().hex + ".wav")
    write(target, model.sample_rate, (np.clip(audio, -1, 1) * 32767).astype(np.int16))
    return dict(path=str(target), filename=str(target), kind="tts", sampleRate=model.sample_rate, durationSeconds=len(audio)/model.sample_rate, voiceCloning=False, model=model_info["repo"])


def process_video(job, output, env):
    if job.get("input"):
        raise ValueError("FastMetal's released MLX runtime supports text-to-video. Use the app's trim/export controls for existing clips.")
    model, directory = choose_model(job, "video")
    source = ROOT / "FastVideo"
    script = source / "examples/inference/basic/mlx_wan_prompt_to_video.py"
    if not script.is_file():
        raise RuntimeError("The packaged FastMetal source runtime is missing.")
    target = output / (uuid.uuid4().hex + ".mp4")
    metrics = target.with_suffix(".metrics.json")
    # FastVideo's root __init__ eagerly imports every CUDA pipeline. Bootstrap
    # namespace packages so the official MLX entrypoint imports only its needed
    # implementation. All upstream source remains unmodified with provenance.
    namespace_setup = """for name in ("fastvideo", "fastvideo.mlx_runtime", "fastvideo.distributed", "fastvideo.platforms"):
 p=root.joinpath(*name.split("."), "__init__.py")
 m=types.ModuleType(name)
 m.__path__=[str(p.parent)]
 m.__package__=name
 sys.modules[name]=m
 parent,_,leaf=name.rpartition(".")
 if parent in sys.modules:
  setattr(sys.modules[parent],leaf,m)
"""
    bootstrap = "import sys,types,pathlib,runpy; root=pathlib.Path(sys.argv.pop(1)); "
    bootstrap += "exec(" + repr(namespace_setup) + "); "
    bootstrap += "script=sys.argv.pop(1);sys.argv[0]=script;sys.path.insert(0,str(root));runpy.run_path(script,run_name='__main__')"
    command = [interpreter("video"), "-c", bootstrap, str(source), str(script), "--model-root", str(directory), "--mlx-checkpoint", str(directory), "--prompt", job.get("prompt", ""), "--output-path", str(target), "--decode-backend", "wan-vae", "--width", str(int(job.get("width", 832))), "--height", str(int(job.get("height", 480))), "--num-frames", str(int(job.get("numFrames", 81))), "--fps", "16", "--seed", str(int(job.get("seed", 42))), "--metrics-json", str(metrics)]
    child(command, environment_for_interpreter(env, command[0]))
    if not target.is_file() or target.stat().st_size == 0:
        raise RuntimeError("FastMetal completed without a generated video.")
    return dict(path=str(target), filename=str(target), kind="video", metricsPath=str(metrics), model=model["repo"], revision=model["revision"])


def run(job):
    global _CHILD
    started = time.monotonic()
    kind = job.get("kind")
    if kind not in {"image", "video", "stt", "tts"}:
        raise ValueError("Unsupported media job kind.")
    if kind != "stt" and not job.get("prompt", "").strip():
        raise ValueError("Enter a prompt for this operation.")
    # Delegate the whole worker for STT/TTS if an optional isolated runtime was
    # configured. Child inherits the protocol directly and cannot recurse.
    selected_python = interpreter(kind)
    delegated = os.environ.get("PROMETH_MEDIA_DELEGATED") == "1"
    if kind in {"stt", "tts"} and not delegated and Path(selected_python).resolve() != Path(sys.executable).resolve():
        env = environment_for_interpreter(dict(os.environ), selected_python)
        env["PROMETH_MEDIA_DELEGATED"] = "1"
        _CHILD = subprocess.Popen([selected_python, str(Path(__file__).resolve())], stdin=subprocess.PIPE, text=True, stdout=_PROTOCOL or sys.stdout, stderr=sys.stderr, env=env)
        try:
            _CHILD.communicate(json.dumps(job))
            status = _CHILD.returncode
            if _STOP.is_set():
                raise InterruptedError("Cancelled")
            if status:
                raise SystemExit(status)
        finally:
            if _CHILD and _CHILD.poll() is None:
                _CHILD.terminate()
                try:
                    _CHILD.wait(timeout=3)
                except subprocess.TimeoutExpired:
                    _CHILD.kill()
            _CHILD = None
        return
    output = Path(job["outputRoot"]).expanduser().resolve()
    output.mkdir(parents=True, exist_ok=True)
    env = offline_environment(output)
    os.environ.update({k: v for k, v in env.items() if k in {"HF_HUB_OFFLINE", "TRANSFORMERS_OFFLINE", "HF_HUB_DISABLE_TELEMETRY", "HF_HOME", "TOKENIZERS_PARALLELISM"}})
    emit("stage", stage="checking", message="Checking selected local model files")
    function = {"image": process_image, "video": process_video, "stt": process_stt, "tts": process_tts}[kind]
    result = function(job, output, env)
    peak = max(resource.getrusage(resource.RUSAGE_SELF).ru_maxrss, resource.getrusage(resource.RUSAGE_CHILDREN).ru_maxrss)
    result.update(elapsedSeconds=round(time.monotonic()-started, 3), peakRSSBytes=peak, memoryMeasurement="Maximum resident process bytes on macOS; includes provider child peak, not a 16GB certification")
    if kind == "stt":
        try:
            import mlx.core as mx
            result["mlxPeakBytes"] = mx.get_peak_memory()
        except ImportError:
            pass
    result["result"] = "prepared" if job.get("prepareOnly") else "transcription" if kind == "stt" else result["path"]
    emit("result", **result)


def cancel(signum, frame):
    _STOP.set()
    if _CHILD and _CHILD.poll() is None:
        _CHILD.terminate()
        try:
            _CHILD.wait(timeout=3)
        except subprocess.TimeoutExpired:
            _CHILD.kill()
    raise InterruptedError("Cancelled")


def monitor_parent(parent_pid):
    """Stop providers when the owning app/worker dies, including delegated jobs."""
    while not _STOP.wait(0.25):
        if os.getppid() != parent_pid:
            os.kill(os.getpid(), signal.SIGTERM)
            return


def main():
    global _PROTOCOL, _REQUEST_ID
    _PROTOCOL = os.fdopen(os.dup(sys.stdout.fileno()), "w", buffering=1)
    # Include C/native library output in diagnostics, never in the NDJSON.
    sys.stdout.flush()
    os.dup2(sys.stderr.fileno(), sys.stdout.fileno())
    signal.signal(signal.SIGTERM, cancel)
    signal.signal(signal.SIGINT, cancel)
    threading.Thread(target=monitor_parent, args=(os.getppid(),), daemon=True, name="prometh-parent-watch").start()
    try:
        if "--serve" in sys.argv:
            # The app keeps one independently owned speech worker per kind.
            # Requests remain serial; cancellation terminates this worker, so
            # no stale audio can leak into the next conversation.
            for line in sys.stdin:
                try:
                    job = json.loads(line)
                    _REQUEST_ID = job.get("requestID")
                    if job.get("kind") not in {"stt", "tts"}:
                        raise ValueError("Persistent workers support speech jobs only.")
                    run(job)
                except (KeyboardInterrupt, InterruptedError):
                    raise
                except Exception as error:
                    emit("error", error=str(error), message=str(error), type=type(error).__name__)
                finally:
                    emit("requestDone")
                    _REQUEST_ID = None
            return 0
        job = json.loads(Path(sys.argv[1]).read_text()) if len(sys.argv)>1 else json.load(sys.stdin)
        run(job)
    except (KeyboardInterrupt, InterruptedError):
        emit("cancelled", message="Cancelled")
        return 130
    except Exception as error:
        emit("error", error=str(error), message=str(error), type=type(error).__name__)
        return 1
    return 0

if __name__ == "__main__":
    raise SystemExit(main())
