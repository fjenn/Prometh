#!/usr/bin/env python3
"""Offline model-cache contract; no network, real models or installed packages."""
import builtins
import contextlib
import hashlib
import importlib.util
import io
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('download', Path(__file__).resolve().parents[1] / 'Runtime/model_download.py')
d = importlib.util.module_from_spec(spec)
spec.loader.exec_module(d)


class OfflineCacheChecks(unittest.TestCase):
    def model(self, data=b'owned pinned weights'):
        return dict(id='offline', repo='test/model', revision='a'*40, files=[dict(path='weights.bin', size=len(data), sha256=hashlib.sha256(data).hexdigest())])

    def no_network_imports(self, name, *args, **kwargs):
        if name in {'requests', 'huggingface_hub'}:
            raise AssertionError('Network dependency requested: ' + name)
        return self.original_import(name, *args, **kwargs)

    def test_complete_checksum_cache_finishes_without_network_or_admission(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            model = self.model()
            folder = d.target(root, model)
            folder.mkdir()
            (folder / 'weights.bin').write_bytes(b'owned pinned weights')
            (folder / 'verified.json').write_text('{"revision":"old"}')
            output = io.StringIO()
            self.original_import = builtins.__import__
            with contextlib.redirect_stdout(output), patch('builtins.__import__', self.no_network_imports), patch.object(d.sys, 'stdin', None), patch.object(d.shutil, 'disk_usage', side_effect=AssertionError('Disk admission requested')):
                self.assertEqual(d.download(model, root), folder)
            receipt = json.loads((folder / 'verified.json').read_text())
            self.assertEqual(receipt['revision'], model['revision'])
            self.assertEqual(receipt['files'], model['files'])
            events = [json.loads(line) for line in output.getvalue().splitlines()]
            self.assertEqual(events[-1]['stage'], 'downloaded')
            self.assertEqual(events[-1]['completed'], model['files'][0]['size'])
            self.assertFalse(any('reserve' in e or e.get('stage') == 'preparing' for e in events))

    def test_corrupt_cache_requires_network_and_is_never_marked_verified(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            model = self.model()
            folder = d.target(root, model)
            folder.mkdir()
            (folder / 'weights.bin').write_bytes(b'x' * model['files'][0]['size'])
            self.original_import = builtins.__import__
            with contextlib.redirect_stdout(io.StringIO()), patch('builtins.__import__', self.no_network_imports):
                with self.assertRaisesRegex(AssertionError, 'Network dependency requested'):
                    d.download(model, root)
            self.assertFalse((folder / 'verified.json').exists())

    def test_catalog_escape_rejected_before_cache_read(self):
        with tempfile.TemporaryDirectory() as tmp:
            model = self.model()
            model['files'][0]['path'] = '../outside'
            with contextlib.redirect_stdout(io.StringIO()), self.assertRaisesRegex(RuntimeError, 'Unsafe artifact path'):
                d.download(model, Path(tmp))


if __name__ == '__main__':
    unittest.main()
