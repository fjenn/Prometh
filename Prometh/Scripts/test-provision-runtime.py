#!/usr/bin/env python3
"""Small fault tests for the distribution boundary, without models or downloads."""
import importlib.util
import io
from pathlib import Path
import tarfile
import tempfile
import unittest

spec = importlib.util.spec_from_file_location('provision', Path(__file__).with_name('provision-runtime.py'))
p = importlib.util.module_from_spec(spec)
spec.loader.exec_module(p)


class DistributionChecks(unittest.TestCase):
    def test_archive_traversal_rejected(self):
        for name in ['../escape', '/absolute']:
            with self.subTest(name=name), tempfile.TemporaryDirectory() as tmp:
                root = Path(tmp)
                archive = root / 'test.tar.gz'
                with tarfile.open(archive, 'w:gz') as tar:
                    entry = tarfile.TarInfo(name)
                    entry.size = 1
                    tar.addfile(entry, io.BytesIO(b'x'))
                with self.assertRaisesRegex(RuntimeError, 'Unsafe archive'):
                    p.extract(archive, root / 'out')

    def test_archive_external_link_rejected(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            archive = root / 'test.tar.gz'
            with tarfile.open(archive, 'w:gz') as tar:
                entry = tarfile.TarInfo('link')
                entry.type = tarfile.SYMTYPE
                entry.linkname = '../../outside'
                tar.addfile(entry)
            with self.assertRaisesRegex(RuntimeError, 'Unsafe archive link'):
                p.extract(archive, root / 'out')

    def test_corrupt_cache_rejected(self):
        with tempfile.TemporaryDirectory() as tmp:
            cache = Path(tmp)
            (cache / p.PINS['python']['file']).write_bytes(b'corrupt')
            with self.assertRaisesRegex(RuntimeError, 'checksum mismatch'):
                p.fetch('python', cache, True)

    def test_missing_cache_fails_offline(self):
        with tempfile.TemporaryDirectory() as tmp:
            with self.assertRaisesRegex(RuntimeError, 'Offline cache missing'):
                p.fetch('llama', Path(tmp), True)

    def test_missing_runtime_fails_before_bundle(self):
        with tempfile.TemporaryDirectory() as tmp:
            with self.assertRaisesRegex(RuntimeError, 'Missing standalone Python'):
                p.verify(Path(tmp))

    def test_locks_have_no_local_paths_or_unpinned_dependencies(self):
        for kind in ['chat', 'media']:
            text = (p.ROOT / 'Scripts/requirements' / (kind + '.txt')).read_text()
            self.assertNotIn('file://', text)
            self.assertNotIn(' @ ', text)
            self.assertIn('--hash=sha256:', text)
            self.assertEqual(p.lock_packages(kind)['pip'], '26.1.1')
            source = {}
            for line in (p.ROOT / 'Runtime' / (kind + '-requirements.lock')).read_text().splitlines():
                if line.startswith('pip @'):
                    source['pip'] = '26.1.1'
                elif line and not line.startswith('#'):
                    name, version = line.split('==')
                    source[name] = version
            self.assertEqual(p.lock_packages(kind), source)


if __name__ == '__main__':
    unittest.main()
