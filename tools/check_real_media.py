"""Verify actual exported PNG conversion without uploading or editing source media."""
import argparse
import hashlib
import importlib.util
import json
from pathlib import Path
import sys
import tempfile

sys.dont_write_bytecode = True
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('root', type=Path)
root = parser.parse_args().root.resolve()
spec = importlib.util.spec_from_file_location('media_api', root / 'cloud/social-publisher/scripts/social_api.py')
api = importlib.util.module_from_spec(spec)
spec.loader.exec_module(api)
source = root / 'examples/demo/media/example.png'
before = hashlib.sha256(source.read_bytes()).hexdigest()
with tempfile.TemporaryDirectory(prefix='publisher-real-media-') as directory:
    api.PREPARED_MEDIA_ROOT = Path(directory) / 'prepared'
    instagram = api.prepare_instagram_photo(source)
    tiktok = api.prepare_tiktok_photo(source)
    if not instagram.read_bytes().startswith(b'\xff\xd8'):
        raise AssertionError('Missing JPEG signature')
    webp = tiktok.read_bytes()
    if webp[:4] != b'RIFF' or webp[8:12] != b'WEBP':
        raise AssertionError('Missing WebP signature')
    if api.prepare_instagram_photo(source) != instagram or api.prepare_tiktok_photo(source) != tiktok:
        raise AssertionError('Prepared media not reused')
    if hashlib.sha256(source.read_bytes()).hexdigest() != before:
        raise AssertionError('Source image modified')
    print(json.dumps({'passed': True, 'source_unchanged': True, 'instagram_jpeg_bytes': instagram.stat().st_size,
                      'tiktok_webp_bytes': tiktok.stat().st_size, 'cache_reuse': True, 'uploads': 0}, indent=2))
