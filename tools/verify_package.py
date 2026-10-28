"""Verify an export directory or ZIP without executing its contents."""
import argparse
import hashlib
import json
from pathlib import Path, PurePosixPath
import stat
import zipfile

MANIFEST = 'manifest.json'
FORBIDDEN_PARTS = frozenset(('node_modules', '.wrangler', '__pycache__', '.git', '.aws'))
FORBIDDEN_NAMES = frozenset(('.env', '.dev.vars', 'auth.json', 'cookies.json', 'credentials.json'))
FORBIDDEN_SUFFIXES = ('.sqlite', '.sqlite3', '.db', '.pyc', '.log', '.pem', '.key')


def safe_name(name):
    path = PurePosixPath(name)
    if (not name or '\\' in name or ':' in name or path.is_absolute() or '..' in path.parts
            or name != path.as_posix() or FORBIDDEN_PARTS.intersection(path.parts)
            or path.name in FORBIDDEN_NAMES or path.name.endswith(FORBIDDEN_SUFFIXES)
            or (path.name.startswith('.env.') and not path.name.endswith('.example'))):
        raise ValueError('Forbidden or unsafe export path: ' + name)


def verify(files):
    for name in files:
        safe_name(name)
    manifest = json.loads(files[MANIFEST].decode('utf-8'))
    expected = {item['path']: item for item in manifest['files']}
    if len(expected) != len(manifest['files']):
        raise ValueError('Duplicate manifest path')
    if set(files) != set(expected) | {MANIFEST}:
        raise ValueError('Missing or extra files: ' + str(sorted(set(files) ^ (set(expected) | {MANIFEST}))))
    for name, item in expected.items():
        payload = files[name]
        if len(payload) != item['bytes'] or hashlib.sha256(payload).hexdigest() != item['sha256']:
            raise ValueError('Digest or size mismatch: ' + name)
    return {'valid': True, 'verified_files': len(expected), 'manifest_self_excluded': True}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('path', type=Path)
    parser.add_argument('--zip', action='store_true')
    args = parser.parse_args()
    if args.zip:
        with zipfile.ZipFile(args.path) as archive:
            entries = archive.infolist()
            if len({entry.filename for entry in entries}) != len(entries):
                raise ValueError('Duplicate ZIP entry')
            for entry in entries:
                if entry.is_dir() or stat.S_ISLNK(entry.external_attr >> 16):
                    raise ValueError('Directory or symbolic link ZIP entry')
                safe_name(entry.filename)
            files = {entry.filename: archive.read(entry) for entry in entries}
    else:
        files = {}
        for path in args.path.rglob('*'):
            if path.relative_to(args.path).parts[0] == '.git':
                continue
            if path.is_symlink():
                raise ValueError('Symbolic link in export: ' + str(path))
            if path.is_file():
                files[path.relative_to(args.path).as_posix()] = path.read_bytes()
    print(json.dumps(verify(files), indent=2))


if __name__ == '__main__':
    main()
