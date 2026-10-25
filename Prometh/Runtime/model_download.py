"""Prometh artifact downloader. Nativ's pinned dry-run/admission protocol adapted
to an explicit file allowlist, verified cache and resumable direct HF transfers.
MIT, Nativ contributors; see ThirdParty/Nativ-LICENSE.txt.
"""
import argparse, hashlib, json, os, shutil, sys, time
from pathlib import Path
from urllib.parse import quote

HEADROOM = 12 * 1024**3

def emit(**event):
    print(json.dumps(event), flush=True)

def digest(path, artifact):
    if artifact.get('sha256'):
        h = hashlib.sha256()
    else:
        h = hashlib.sha1()
        h.update(f'blob {path.stat().st_size}\0'.encode())
    with path.open('rb') as f:
        while chunk := f.read(8 * 1024 * 1024): h.update(chunk)
    return h.hexdigest()

def valid(path, artifact):
    expected = artifact.get('sha256') or artifact.get('oid')
    return path.is_file() and path.stat().st_size == artifact['size'] and expected and digest(path, artifact) == expected

def target(root, model):
    return Path(root) / (model['repo'].replace('/', '--') + '--' + model['revision'][:12])

def finish(model, folder, total):
    marker = {'revision':model['revision'], 'files':model['files'], 'verifiedAt':time.time()}
    tmp=folder/'.verified.tmp'; tmp.write_text(json.dumps(marker)); tmp.replace(folder/'verified.json')
    emit(stage='downloaded', completed=total, total=total, path=str(folder), model=model['id'])
    return folder

def download(model, root, approve=True):
    folder = target(root, model)
    folder.mkdir(parents=True, exist_ok=True)
    # The pinned catalog is sufficient to verify an already installed model.
    # Reopening offline must not require Hub metadata, admission or free space
    # for weights that are already present and checksum-correct.
    emit(stage='checking', model=model['id'])
    if not model['files']:
        raise RuntimeError('Pinned artifact list is empty.')
    total = sum(f['size'] for f in model['files'])
    done = 0
    verified = set()
    for f in model['files']:
        p = folder / f['path']
        if not p.resolve().is_relative_to(folder.resolve()):
            raise RuntimeError('Unsafe artifact path.')
        if valid(p, f):
            done += f['size']; verified.add(f['path'])
        elif p.exists():
            p.unlink()  # corrupted complete cache must never be loaded
    remaining = total - done
    if len(verified) == len(model['files']):
        return finish(model, folder, total)
    # Missing/corrupt artifacts still require the original pinned Hub preflight
    # and per-volume admission before any transfer.
    import requests
    from huggingface_hub import snapshot_download
    emit(stage='preparing', model=model['id'])
    planned = snapshot_download(repo_id=model['repo'], revision=model['revision'],
        cache_dir=str(Path(root) / '.hub-metadata'), dry_run=True,
        allow_patterns=[f['path'] for f in model['files']])
    expected = {f['path']:f for f in model['files']}
    if not planned or {f.filename for f in planned} != set(expected):
        raise RuntimeError('Pinned artifact list changed or is incomplete. Refresh catalog before downloading.')
    for item in planned:
        if item.commit_hash != model['revision'] or item.file_size != expected[item.filename]['size']:
            raise RuntimeError('Hub metadata disagrees with the pinned catalog. Download refused.')
    if approve:
        emit(reserve=remaining + HEADROOM, remaining=remaining, total=total)
        approval = json.loads(sys.stdin.readline())
        if approval.get('approved') is not True: raise RuntimeError(approval.get('error', 'Disk admission denied.'))
    emit(stage='downloading', completed=done, total=total)
    token = os.environ.get('HF_TOKEN')
    headers = {'Authorization': 'Bearer ' + token} if token else {}
    for f in model['files']:
        if f['path'] in verified: continue
        p = folder / f['path']
        if p.is_absolute() and not p.resolve().is_relative_to(folder.resolve()): raise RuntimeError('Unsafe artifact path.')
        p.parent.mkdir(parents=True, exist_ok=True)
        partial = p.with_name(p.name + '.partial')
        attempts = 0
        while True:
            offset = partial.stat().st_size if partial.exists() else 0
            if offset > f['size']: partial.unlink(); offset = 0
            try:
                if shutil.disk_usage(folder).free < f['size'] - offset + HEADROOM:
                    raise RuntimeError(f'Not enough storage on the model volume. Need {f["size"]-offset+HEADROOM:,} free bytes; deselect optional capabilities.')
                url = f'https://huggingface.co/{model["repo"]}/resolve/{model["revision"]}/{quote(f["path"])}'
                h = dict(headers)
                if offset: h['Range'] = f'bytes={offset}-'
                with requests.get(url, headers=h, stream=True, timeout=(30,90)) as response:
                    response.raise_for_status()
                    if offset and response.status_code != 206: offset = 0
                    last = 0
                    with partial.open('ab' if offset else 'wb') as out:
                        for chunk in response.iter_content(1024*1024):
                            if shutil.disk_usage(folder).free < len(chunk) + HEADROOM:
                                raise RuntimeError('Storage headroom reached. Pause and free space or deselect optional models.')
                            out.write(chunk); offset += len(chunk)
                            if time.monotonic()-last > .2:
                                emit(stage='downloading', completed=done+offset, total=total, file=f['path']); last=time.monotonic()
                if offset != f['size']: raise IOError('Incomplete transfer; retry will resume.')
                emit(stage='checking', completed=done+offset, total=total, file=f['path'])
                if not valid(partial, f):
                    partial.unlink()
                    raise IOError('Artifact checksum failed; removed corrupt data. Retry the download.')
                partial.replace(p); break
            except (requests.RequestException, IOError):
                attempts += 1
                if attempts >= 4: raise
                time.sleep(min(attempts*2, 8))
        done += f['size']
        emit(stage='downloading', completed=done, total=total)
    return finish(model, folder, total)

def main():
    parser=argparse.ArgumentParser()
    parser.add_argument('--catalog',required=True); parser.add_argument('--root',required=True)
    parser.add_argument('--model',required=True); parser.add_argument('--no-admission',action='store_true')
    args=parser.parse_args()
    model=next(m for m in json.loads(Path(args.catalog).read_text())['models'] if m['id']==args.model)
    if not model.get('enabled',True): raise RuntimeError(model.get('reason','Model not enabled.'))
    download(model,args.root,not args.no_admission)

if __name__=='__main__':
    try: main()
    except Exception as error:
        emit(error=str(error)); sys.exit(1)
