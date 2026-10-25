#!/usr/bin/env python3
"""Provision pinned standalone Apple Silicon runtimes; never reads installed apps/models.

Prometh adaptation of Nativ PythonDistribution packaging (MIT): standalone
CPython, native relative-path launcher, nativ_server overlay and capability map.
Upstream source is downloaded at an immutable commit and SHA-256 verified.
"""
import argparse
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import tarfile
import tempfile
import urllib.request

ROOT = Path(__file__).resolve().parents[1]
PINS = {
    "python": dict(file="cpython-3.12.13+20260508-aarch64-apple-darwin-install_only_stripped.tar.gz", url="https://github.com/astral-sh/python-build-standalone/releases/download/20260508/cpython-3.12.13%2B20260508-aarch64-apple-darwin-install_only_stripped.tar.gz", sha256="77cae8bed0dfdda8daf680c1d51eb0dc88497786cc33d19968722a412643d60d"),
    "nativ": dict(file="nativ-55493b75315e53ea446eb22afe5df05d56fc1c9a.tar.gz", url="https://codeload.github.com/Blaizzy/nativ/tar.gz/55493b75315e53ea446eb22afe5df05d56fc1c9a", sha256="6b5d6327d3b6c2bbdc8caf75749ba259de2ae5627d32e56012ba680b6ebd5ba2"),
    "fastvideo": dict(file="FastVideo-8db2d71ef217e84bec7dbb6e4ab65c92b144df4f.tar.gz", url="https://codeload.github.com/hao-ai-lab/FastVideo/tar.gz/8db2d71ef217e84bec7dbb6e4ab65c92b144df4f", sha256="e825dd9bb02566a284c9270ca5a9196aaec331e5107760ec5bcf11990dec3c50"),
    "llama": dict(file="llama-b11669-bin-macos-arm64.tar.gz", url="https://github.com/ggml-org/llama.cpp/releases/download/b11669/llama-b11669-bin-macos-arm64.tar.gz", sha256="dbed55493d72bc1ba2babc8770d669c2289b5bc4ee9fb2a4dfc158d45b7d13fd"),
}


def sha(path):
    h = hashlib.sha256()
    with path.open('rb') as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b''):
            h.update(block)
    return h.hexdigest()


def fetch(name, cache, offline):
    pin = PINS[name]
    path = cache / pin['file']
    if not path.exists():
        if offline:
            raise RuntimeError('Offline cache missing: ' + str(path))
        print('Downloading ' + pin['file'], flush=True)
        temporary = path.with_suffix(path.suffix + '.partial')
        request = urllib.request.Request(pin['url'], headers={'User-Agent': 'Prometh-runtime-builder'})
        try:
            with urllib.request.urlopen(request, timeout=120) as response, temporary.open('wb') as stream:
                shutil.copyfileobj(response, stream)
            if sha(temporary) != pin['sha256']:
                raise RuntimeError('Downloaded archive checksum mismatch: ' + pin['file'])
            temporary.replace(path)
        finally:
            temporary.unlink(missing_ok=True)
    if sha(path) != pin['sha256']:
        raise RuntimeError('Cached archive checksum mismatch: ' + str(path))
    return path


def extract(archive, destination, only=None):
    destination = destination.resolve()
    destination.mkdir()
    # Reject traversal, device files and links escaping the archive destination,
    # including on the Xcode bootstrap interpreter (which may predate tar filters).
    with tarfile.open(archive) as tar:
        for member in tar.getmembers():
            if only:
                relative = member.name.split('/', 1)[1] if '/' in member.name else ''
                if relative and not any(relative == part or relative.startswith(part + '/') for part in only):
                    continue
            target = (destination / member.name).resolve()
            if target != destination and destination not in target.parents:
                raise RuntimeError('Unsafe archive path: ' + member.name)
            if member.isdev() or member.isfifo():
                raise RuntimeError('Unsafe special archive member: ' + member.name)
            if member.issym() or member.islnk():
                link = (target.parent / member.linkname if member.issym() else destination / member.linkname).resolve()
                if link != destination and destination not in link.parents:
                    raise RuntimeError('Unsafe archive link: ' + member.name)
            if sys.version_info >= (3, 12):
                tar.extract(member, destination, filter='data')
            else:
                tar.extract(member, destination)
    return destination


def clone(source, destination):
    # APFS copy-on-write, never mutable hard links to an existing installation.
    result = subprocess.run(['/bin/cp', '-cR', str(source), str(destination)], stderr=subprocess.PIPE)
    if result.returncode:
        if destination.exists():
            shutil.rmtree(destination)
        shutil.copytree(source, destination, symlinks=True, ignore=shutil.ignore_patterns('__pycache__', '*.pyc'))


def environment(prefix):
    env = dict(os.environ, PYTHONHOME=str(prefix), PYTHONNOUSERSITE='1', PYTHONDONTWRITEBYTECODE='1', PIP_DISABLE_PIP_VERSION_CHECK='1')
    env.pop('PYTHONPATH', None)
    env.pop('VIRTUAL_ENV', None)
    return env


def run_python(prefix, args, **kwargs):
    return subprocess.run([str(prefix / 'bin/python3'), *args], env=environment(prefix), check=True, **kwargs)


def lock_packages(kind):
    packages = {}
    for line in (ROOT / 'Scripts/requirements' / (kind + '.txt')).read_text().splitlines():
        match = re.match(r'^([\w.-]+)==([^\s]+)', line)
        if match:
            packages[match[1]] = match[2]
    if not packages:
        raise RuntimeError('Empty dependency lock: ' + kind)
    return packages


def verify_python(path, kind):
    prefix = path / 'python'
    if not (prefix / 'bin/python3').is_file():
        raise RuntimeError('Missing standalone Python: ' + str(path))
    code = "import importlib.metadata as m, json, sys; expected=json.loads(sys.argv[1]); bad=[f'{k}: expected {v}, found {m.version(k)}' for k,v in expected.items() if m.version(k)!=v]; assert not bad, '\\n'.join(bad); assert sys.version_info[:3]==(3,12,13),sys.version"
    run_python(prefix, ['-c', code, json.dumps(lock_packages(kind))])
    run_python(prefix, ['-m', 'pip', 'check'])
    imports = 'import mlx_vlm.server,nativ_server,mlx_audio' if kind == 'chat' else 'import mflux.models.flux2.cli.flux2_generate,pocket_tts,mlx_audio,torch,diffusers,imageio_ffmpeg,av'
    run_python(prefix, ['-c', imports])
    if kind == 'chat' and not os.access(path / 'bin/mlx-vlm-server', os.X_OK):
        raise RuntimeError('Missing native chat launcher: ' + str(path))


def notices(path):
    prefix = path / 'python'
    code = """import importlib.metadata as m,json
print(json.dumps(sorted([{'name':d.metadata['Name'],'version':d.version,'license':d.metadata.get('License-Expression') or d.metadata.get('License'),'classifiers':[c for c in d.metadata.get_all('Classifier',[]) if c.startswith('License ::')]} for d in m.distributions()],key=lambda x:x['name'].lower()),indent=2))"""
    result = run_python(prefix, ['-c', code], stdout=subprocess.PIPE, text=True)
    (path / 'DEPENDENCIES.json').write_text(result.stdout + '\n')
    # Keep wheel .dist-info/licenses and PBS licenses in place when bundling.


def build_python(kind, output, scratch, cache, offline, nativ, reuse):
    name = 'Runtime' if kind == 'chat' else 'MediaRuntime'
    destination = output / name
    if destination.exists():
        verify_python(destination, kind)
        notices(destination)
        return
    staged = scratch / name
    source = reuse / name if reuse else None
    if source and source.is_dir():
        verify_python(source, kind)
        clone(source, staged)
    else:
        staged.mkdir()
        unpacked = scratch / ('python-' + kind)
        extract(fetch('python', cache, offline), unpacked)
        prefix = next(unpacked.glob('python/bin/python3')).parents[1]
        clone(prefix, staged / 'python')
        command = ['-m', 'pip', 'install', '--only-binary=:all:', '--require-hashes', '--no-deps', '--no-compile', '-r', str(ROOT / 'Scripts/requirements' / (kind + '.txt'))]
        if offline:
            command.extend(['--no-index', '--find-links', str(cache / 'wheels')])
        run_python(staged / 'python', command)
    if kind == 'chat':
        distribution = nativ / 'PythonDistribution'
        (staged / 'bin').mkdir(exist_ok=True)
        subprocess.run(['/usr/bin/xcrun', 'clang', '-O2', '-Wall', '-Wextra', '-o', str(staged / 'bin/mlx-vlm-server'), str(distribution / 'Launcher/mlx_vlm_server_launcher.c')], check=True)
        site = next((staged / 'python/lib').glob('python*/site-packages'))
        shutil.copy2(distribution / 'Overlay/nativ_server.py', site / 'nativ_server.py')
        sys.path.insert(0, str(distribution / 'Scripts'))
        from generate_model_capabilities_manifest import generate_model_capabilities_manifest
        generate_model_capabilities_manifest(site, staged / 'model-capabilities.json')
        shutil.copy2(nativ / 'LICENSE', staged / 'Nativ-LICENSE.txt')
    verify_python(staged, kind)
    notices(staged)
    staged.rename(destination)


def verify(output):
    verify_python(output / 'Runtime', 'chat')
    verify_python(output / 'MediaRuntime', 'media')
    binary = output / 'llama/llama-server'
    if not os.access(binary, os.X_OK):
        raise RuntimeError('Missing enabled Evil backend: ' + str(binary))
    result = subprocess.run([str(binary), '--version'], capture_output=True, text=True, check=True)
    if '620d2225c' not in result.stdout + result.stderr:
        raise RuntimeError('llama-server does not match pinned b11669')
    fast = output / 'FastVideo'
    for file in ['LICENSE', 'examples/inference/basic/mlx_wan_prompt_to_video.py', 'fastvideo/mlx_runtime/__init__.py']:
        if not (fast / file).is_file():
            raise RuntimeError('Missing enabled video runtime file: ' + str(fast / file))
    manifest = json.loads((output / 'provenance.json').read_text())
    expected_locks = {k:sha(ROOT / 'Scripts/requirements' / (k+'.txt')) for k in ['chat','media']}
    if manifest.get('requirements') != expected_locks:
        raise RuntimeError('Runtime lock provenance is stale; provision into a new output')
    if manifest.get('archives') != PINS:
        raise RuntimeError('Runtime provenance does not match pinned archives; provision into a new output')
    for relative, digest in manifest['sourceFiles'].items():
        path = (output / relative).resolve()
        if output not in path.parents:
            raise RuntimeError('Unsafe runtime manifest path: ' + relative)
        if sha(path) != digest:
            raise RuntimeError('Runtime source checksum mismatch: ' + relative)
    print('All enabled standalone runtime components verified.', flush=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path, default=ROOT / '.build')
    parser.add_argument('--cache', type=Path, default=ROOT / '.build/downloads')
    parser.add_argument('--reuse-from', type=Path, help='Clone and verify existing Prometh runtimes; never modifies the source')
    parser.add_argument('--offline', action='store_true', help='Require cached archives and, for fresh installs, cache/wheels')
    parser.add_argument('--verify-only', action='store_true')
    parser.add_argument('--dry-run', action='store_true')
    args = parser.parse_args()
    output, cache = args.output.resolve(), args.cache.resolve()
    if args.dry_run:
        print(json.dumps(dict(output=str(output), cache=str(cache), archives=PINS, dependencies={k: lock_packages(k) for k in ['chat', 'media']}), indent=2))
        return
    if sys.platform != 'darwin' or os.uname().machine != 'arm64':
        raise RuntimeError('Standalone runtimes require Apple Silicon macOS')
    if args.verify_only:
        verify(output)
        return
    output.mkdir(parents=True, exist_ok=True)
    cache.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix='.provision-', dir=output) as tmp:
        scratch = Path(tmp)
        upstream = extract(fetch('nativ', cache, args.offline), scratch / 'nativ')
        nativ = next(upstream.iterdir())
        for kind in ['chat', 'media']:
            build_python(kind, output, scratch, cache, args.offline, nativ, args.reuse_from.resolve() if args.reuse_from else None)
        if not (output / 'llama').exists():
            llama = extract(fetch('llama', cache, args.offline), scratch / 'llama-archive')
            binary = next(llama.rglob('llama-server'))
            clone(binary.parent, scratch / 'llama')
            (scratch / 'llama').rename(output / 'llama')
        if not (output / 'FastVideo').exists():
            fast = next(extract(fetch('fastvideo', cache, args.offline), scratch / 'fastvideo-archive', only=['LICENSE', 'README.md', 'pyproject.toml', 'fastvideo', 'examples/inference/basic']).iterdir())
            subset = scratch / 'FastVideo'
            subset.mkdir()
            for name in ['LICENSE', 'README.md', 'pyproject.toml']:
                shutil.copy2(fast / name, subset / name)
            for name in ['fastvideo', 'examples/inference/basic']:
                source = fast / name
                destination = subset / name
                destination.parent.mkdir(parents=True, exist_ok=True)
                shutil.copytree(source, destination, ignore=shutil.ignore_patterns('__pycache__', '*.pyc'))
            subset.rename(output / 'FastVideo')
        sources = {}
        for directory in ['FastVideo', 'llama']:
            for file in sorted((output / directory).rglob('*')):
                if file.is_file() and not file.is_symlink():
                    sources[str(file.relative_to(output))] = sha(file)
        overlay = next((output / 'Runtime/python/lib').glob('python*/site-packages/nativ_server.py'))
        sources[str(overlay.relative_to(output))] = sha(overlay)
        sources['Runtime/bin/mlx-vlm-server'] = sha(output / 'Runtime/bin/mlx-vlm-server')
        manifest = dict(archives=PINS, sourceFiles=sources, requirements={k:sha(ROOT / 'Scripts/requirements' / (k+'.txt')) for k in ['chat','media']})
        (output / 'provenance.json').write_text(json.dumps(manifest, indent=2, sort_keys=True)+'\n')
    verify(output)


if __name__ == '__main__':
    try:
        main()
    except (RuntimeError, subprocess.CalledProcessError, OSError, ValueError) as error:
        raise SystemExit('Runtime setup failed: ' + str(error))
