#!/usr/bin/env python3
"""Check a reviewed Git stage for generated runtimes, private caches and weights."""
from pathlib import PurePosixPath
import subprocess
import sys

files = subprocess.check_output(['git', 'ls-files', '-z'], text=True).split('\0')
blocked = []
for file in filter(None, files):
    parts = PurePosixPath(file).parts
    if any(p in {'.build', 'dist', '.git', '.cursor', '__pycache__', 'vendor', 'node_modules'} for p in parts):
        blocked.append(file)
    elif file.startswith(('Prometh/work/', 'Prometh/Runtime/FastVideo/')):
        blocked.append(file)
    elif file.endswith(('.safetensors', '.gguf', '.onnx', '.pyc')):
        blocked.append(file)
    elif any(p == '.env' or (p.startswith('.env.') and p != '.env.example') for p in parts):
        blocked.append(file)
    else:
        try:
            size = __import__('pathlib').Path(file).stat().st_size
        except FileNotFoundError:
            continue
        if size > 95 * 1024 * 1024:
            blocked.append(file + ' (over 95 MiB)')
if blocked:
    print('Release stage contains excluded/private/generated inputs:\n' + '\n'.join(blocked), file=sys.stderr)
    raise SystemExit(1)
print('Git release inputs contain no generated runtimes, model weights or excluded local state.')
