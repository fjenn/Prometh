#!/usr/bin/env python3
"""Normalize the working freeze and pin wheel SHA-256 hashes from PyPI metadata."""
from concurrent.futures import ThreadPoolExecutor
import json
from pathlib import Path
import urllib.request

ROOT = Path(__file__).resolve().parents[1]


def requirement(line):
    line = line.strip()
    if not line or line.startswith('#'):
        return ''
    if line.startswith('pip @'):
        line = 'pip==26.1.1'
    if ' @ ' in line or '==' not in line:
        raise ValueError('Release dependencies must use exact PyPI versions: ' + line)
    name, version = line.split('==')
    with urllib.request.urlopen('https://pypi.org/pypi/' + name + '/' + version + '/json', timeout=30) as response:
        metadata = json.load(response)
    hashes = sorted({file['digests']['sha256'] for file in metadata['urls'] if file['packagetype'] == 'bdist_wheel'})
    if not hashes:
        raise ValueError('No published wheels: ' + line)
    return line + ' \\\n' + ' \\\n'.join('    --hash=sha256:' + value for value in hashes)


def main():
    for kind in ['chat', 'media']:
        source = ROOT / 'Runtime' / (kind + '-requirements.lock')
        with ThreadPoolExecutor(max_workers=12) as pool:
            lines = list(pool.map(requirement, source.read_text().splitlines()))
        destination = ROOT / 'Scripts/requirements' / (kind + '.txt')
        temporary = destination.with_suffix('.tmp')
        temporary.write_text('# Generated from Runtime/' + kind + '-requirements.lock; wheels only, PyPI SHA-256.\n' + '\n'.join(line for line in lines if line) + '\n')
        temporary.replace(destination)
        print(destination)


if __name__ == '__main__':
    main()
