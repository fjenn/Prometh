#!/usr/bin/env python3
"""Build a Prometh-owned, relocatable optional media Python from its chat runtime.

No user Python is needed by the finished app. This build-time script clones the
already downloaded python-build-standalone prefix, installs media dependencies,
and records exact versions. Never mutates the source runtime.
"""
import argparse
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import time

ROOT = Path(__file__).resolve().parents[1]
PACKAGES = ["mflux==0.23.0", "pocket-tts==4.0.1", "ddgs", "diffusers>=0.38.0", "imageio", "imageio-ffmpeg", "av", "einops", "psutil", "pillow==12.3.0", "fsspec>=2026.6.0,<=2026.7.0"]


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--source", type=Path, default=ROOT / ".build/Runtime/python")
    p.add_argument("--output", type=Path, default=ROOT / ".build/MediaRuntime")
    p.add_argument("--lock", type=Path, default=ROOT / "Runtime/media-requirements.lock")
    p.add_argument("--force", action="store_true")
    p.add_argument("--refresh-lock", action="store_true", help="Resolve fresh dependencies instead of rebuilding the exact recorded lock")
    args = p.parse_args()
    source = args.source.resolve()
    output = args.output.resolve()
    if output == source or source in output.parents:
        raise SystemExit("Media runtime output must be separate from source runtime")
    if not (source / "bin/python3").is_file():
        raise SystemExit("Build the standalone chat runtime first")
    output.mkdir(parents=True, exist_ok=True)
    destination = output / "python"
    if args.force and destination.exists():
        shutil.rmtree(destination)
    if not destination.exists():
        print("Cloning standalone Python into its independent media runtime", flush=True)
        if sys.platform == "darwin":
            # APFS clone-on-write saves disk without shared mutable hardlinks.
            clone = subprocess.run(["/bin/cp", "-cR", str(source), str(destination)])
            if clone.returncode:
                if destination.exists():
                    shutil.rmtree(destination)
                shutil.copytree(source, destination, symlinks=True)
        else:
            shutil.copytree(source, destination, symlinks=True)
    python = destination / "bin/python3"
    env = dict(os.environ, PYTHONHOME=str(destination), PYTHONNOUSERSITE="1", PYTHONDONTWRITEBYTECODE="1")
    env.pop("PYTHONPATH", None)
    start = time.monotonic()
    requirements = ["-r", str(args.lock.resolve())] if args.lock.exists() and not args.refresh_lock else PACKAGES
    subprocess.run([str(python), "-m", "pip", "install", "--upgrade", *requirements], env=env, check=True)
    subprocess.run([str(python), "-m", "pip", "check"], env=env, check=True)
    subprocess.run([str(python), "-c", "import mflux.models.flux2.cli.flux2_generate,pocket_tts,mlx_audio,torch,diffusers,imageio_ffmpeg; print('Media imports passed')"], env=env, check=True)
    freeze = subprocess.check_output([str(python), "-m", "pip", "freeze", "--all"], env=env, text=True)
    args.lock.parent.mkdir(parents=True, exist_ok=True)
    args.lock.write_text("# Prometh optional media runtime exact resolved packages\n" + freeze)
    (output / "prometh-runtime.json").write_text(json.dumps(dict(source="python-build-standalone, cloned from Prometh-owned chat runtime", packages=PACKAGES, lock=str(args.lock), builtSeconds=round(time.monotonic()-start, 3)), indent=2)+"\n")
    print("Media runtime ready:", output)

if __name__ == "__main__":
    main()
