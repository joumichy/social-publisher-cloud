#!/usr/bin/env python3
"""Install an isolated Social Publisher instance and prepare a distinct Cloudflare Worker."""
from datetime import datetime, timezone
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
from urllib.parse import urlparse
from uuid import UUID

sys.dont_write_bytecode = True

PACKAGE_ROOT = Path(__file__).resolve().parent
RECEIPT_NAME = 'installation.json'
INSTANCE_CONFIG = 'wrangler.instance.jsonc'
ORIGINAL_WORKER = 'stellark-social-publisher'
NAME_PATTERN = re.compile(r'^[a-z][a-z0-9-]{2,62}$')
DOC_DIRECTORIES = ('prompts', 'inventory', 'validation')
DOC_FILES = ('document.md', 'README.md', 'ARCHITECTURE.md', 'INSTALLATION.md', 'CLOUDFLARE.md', 'ROLLBACK.md', 'DOMAINE-GRATUIT.md', 'DASHBOARD.md')
SECRET_NAMES = ('ADMIN_API_TOKEN', 'TOKEN_ENCRYPTION_KEY', 'META_APP_SECRET', 'INSTAGRAM_APP_SECRET',
                'LINKEDIN_CLIENT_SECRET', 'TIKTOK_CLIENT_KEY', 'TIKTOK_CLIENT_SECRET',
                'TIKTOK_BUSINESS_CLIENT_ID', 'TIKTOK_BUSINESS_CLIENT_SECRET')
LAUNCHER_SOURCE = '''#!/usr/bin/env python3
import os
from pathlib import Path
import subprocess
import sys
root = Path(__file__).resolve().parents[1]
environment = os.environ.copy()
environment['HOME'] = str(root / 'home')
environment['USERPROFILE'] = str(root / 'home')
environment['SOCIAL_PUBLISHER_REGISTRY'] = str(root / 'home/.codex/social-publisher/registry.json')
environment['PYTHONDONTWRITEBYTECODE'] = '1'
arguments = sys.argv[1:]
if arguments and arguments[0] == 'dashboard':
    command = [sys.executable, str(root / 'dashboard/server.py'), '--prefix', str(root), *arguments[1:]]
else:
    command = [sys.executable, str(root / 'service/scripts/social_cli.py'), *arguments]
raise SystemExit(subprocess.call(command, env=environment))
'''
SHELL_LAUNCHER = '''#!/bin/sh
set -eu
SCRIPT_DIRECTORY=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
exec python3 "$SCRIPT_DIRECTORY/social-publisher.py" "$@"
'''
WINDOWS_LAUNCHER = '@echo off\r\npython "%~dp0social-publisher.py" %*\r\n'


def write_json(path, payload):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')


def run(command, cwd, environment=None):
    subprocess.run(command, cwd=cwd, env=environment, check=True)


def receipt(prefix):
    data = json.loads((prefix / RECEIPT_NAME).read_text(encoding='utf-8'))
    if Path(data['prefix']).resolve() != prefix or data.get('format') != 'social-publisher-install-v1':
        raise ValueError('Installation receipt does not match this directory')
    return data


def verify_package():
    verifier_path = PACKAGE_ROOT / 'tools/verify_package.py'
    spec = importlib.util.spec_from_file_location('package_verifier', verifier_path)
    verifier = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(verifier)
    payload = {}
    manifest = json.loads((PACKAGE_ROOT / 'manifest.json').read_text(encoding='utf-8'))
    for item in [*manifest['files'], {'path': 'manifest.json'}]:
        verifier.safe_name(item['path'])
        path = PACKAGE_ROOT / item['path']
        if path.is_symlink():
            raise ValueError('Linked package file: ' + item['path'])
        payload[item['path']] = path.read_bytes()
    verifier.verify(payload)
    allowed = set(payload)
    for path in PACKAGE_ROOT.rglob('*'):
        relative = path.relative_to(PACKAGE_ROOT)
        if relative.parts[0] == '.git':
            continue
        if path.is_symlink() or (path.is_file() and relative.as_posix() not in allowed):
            raise ValueError('Unmanifested or linked package file: ' + relative.as_posix())


def install(args):
    prefix = args.prefix.expanduser().resolve()
    if prefix.exists():
        raise ValueError('Destination already exists; choose a new empty installation path: ' + str(prefix))
    if prefix == PACKAGE_ROOT or prefix in PACKAGE_ROOT.parents or PACKAGE_ROOT in prefix.parents:
        raise ValueError('Destination must be outside the source package')
    verify_package()
    npm = shutil.which('npm')
    if not args.skip_deps and (not npm or not shutil.which('node')):
        raise ValueError('Node and npm are required. Use --skip-deps only for an offline source installation.')
    prefix.mkdir(parents=True)
    data = {'format': 'social-publisher-install-v1', 'prefix': str(prefix),
            'created_at': datetime.now(timezone.utc).isoformat(), 'status': 'installing',
            'dependencies': 'not_installed', 'source_manifest_sha256': hashlib.sha256((PACKAGE_ROOT / 'manifest.json').read_bytes()).hexdigest(),
            'cloud_deployed': False, 'files': []}
    write_json(prefix / RECEIPT_NAME, data)
    try:
        shutil.copytree(PACKAGE_ROOT / 'cloud/social-publisher', prefix / 'service')
        shutil.copytree(PACKAGE_ROOT / 'mac/skill/social-publisher', prefix / 'home/.codex/skills/social-publisher')
        shutil.copytree(PACKAGE_ROOT / 'examples/demo', prefix / 'projects/demo')
        shutil.copytree(PACKAGE_ROOT / 'dashboard', prefix / 'dashboard')
        for directory in DOC_DIRECTORIES:
            shutil.copytree(PACKAGE_ROOT / directory, prefix / 'docs' / directory)
        for filename in DOC_FILES:
            shutil.copyfile(PACKAGE_ROOT / filename, prefix / 'docs' / filename)
        shutil.copytree(PACKAGE_ROOT / 'tools', prefix / 'tools')
        for directory in ('bin', 'config', 'run', 'prepared-media'):
            (prefix / directory).mkdir()
        registry = json.loads((PACKAGE_ROOT / 'config/registry.example.json').read_text(encoding='utf-8'))
        registry['api']['service_root'] = str(prefix / 'service')
        registry['projects'][0]['root'] = str(prefix / 'projects/demo')
        write_json(prefix / 'home/.codex/social-publisher/registry.json', registry)
        (prefix / 'config/README.md').write_text('Registre canonique : ../home/.codex/social-publisher/registry.json\nConfiguration cloud : ../service/wrangler.instance.jsonc après cloud-config.\n', encoding='utf-8')
        for name, source in (('social-publisher.py', LAUNCHER_SOURCE), ('social-publisher', SHELL_LAUNCHER), ('social-publisher.cmd', WINDOWS_LAUNCHER)):
            path = prefix / 'bin' / name
            path.write_bytes(source.encode('utf-8'))
            path.chmod(0o700)
        if not args.skip_deps:
            run([npm, 'ci', '--no-audit', '--no-fund'], prefix / 'service')
            data['dependencies'] = 'npm_ci_completed'
        run([sys.executable, str(prefix / 'bin/social-publisher.py'), 'validate', 'demo'], prefix)
        data['status'] = 'installed'
    except Exception:
        data['status'] = 'incomplete'
        raise
    finally:
        data['files'] = [{'path': path.relative_to(prefix).as_posix(), 'sha256': hashlib.sha256(path.read_bytes()).hexdigest()}
                         for path in sorted(prefix.rglob('*')) if path.is_file()
                         and 'node_modules' not in path.relative_to(prefix).parts and path.name != RECEIPT_NAME]
        write_json(prefix / RECEIPT_NAME, data)
    print(json.dumps({'installed': str(prefix), 'dependencies': data['dependencies'],
                      'command': str(prefix / 'bin/social-publisher'), 'documents': str(prefix / 'docs'),
                      'cloud_deployed': False, 'profile': 'isolated'}, indent=2))


def doctor(args):
    prefix = args.prefix.expanduser().resolve()
    data = receipt(prefix)
    results = {'receipt_status': data['status'], 'python': sys.version.split()[0],
               'tools': {name: shutil.which(name) for name in ('node', 'npm', 'ffmpeg', 'ffprobe', 'cwebp', 'sips')},
               'registry': str(prefix / 'home/.codex/social-publisher/registry.json'),
               'cloud_config_present': (prefix / 'service' / INSTANCE_CONFIG).is_file()}
    run([sys.executable, str(prefix / 'bin/social-publisher.py'), 'validate', 'demo'], prefix)
    print(json.dumps(results, indent=2))


def cloud_config(args):
    prefix = args.prefix.expanduser().resolve()
    receipt(prefix)
    for value in (args.worker_name, args.database_name, args.bucket_name):
        if not NAME_PATTERN.fullmatch(value) or value == ORIGINAL_WORKER:
            raise ValueError('A distinct lowercase resource name is required')
    if args.database_name == 'social-publisher' or args.bucket_name == 'social-publisher-media':
        raise ValueError('Historical production D1/R2 names cannot be used for this duplicate')
    database_id = str(UUID(args.database_id))
    if UUID(database_id).int == 0:
        raise ValueError('Provide the UUID returned when the NEW D1 database was created')
    if args.workers_subdomain:
        if not NAME_PATTERN.fullmatch(args.workers_subdomain):
            raise ValueError('Provide the actual lowercase account workers.dev subdomain')
        public_base_url = 'https://' + args.worker_name + '.' + args.workers_subdomain + '.workers.dev'
    else:
        public_base_url = args.public_base_url
    url = urlparse(public_base_url)
    if url.scheme != 'https' or not url.hostname or url.username or url.password or url.query or url.fragment or url.path not in ('', '/'):
        raise ValueError('An HTTPS origin without credentials, path or query is required')
    if url.hostname == 'stellark-social-publisher.ginozapro.workers.dev':
        raise ValueError('Historical production URL cannot be used for this duplicate')
    config_path = prefix / 'service' / INSTANCE_CONFIG
    if config_path.exists():
        raise ValueError('Instance config already exists; review it manually instead of overwriting')
    config = json.loads((prefix / 'service/wrangler.jsonc').read_text(encoding='utf-8'))
    config['name'] = args.worker_name
    config['workers_dev'] = True
    config['triggers'] = {'crons': []}
    config['vars']['PUBLIC_BASE_URL'] = public_base_url.rstrip('/')
    config['d1_databases'][0].update(database_name=args.database_name, database_id=database_id)
    config['r2_buckets'][0]['bucket_name'] = args.bucket_name
    write_json(config_path, config)
    print(json.dumps({'configuration_created': str(config_path), 'worker': args.worker_name,
                      'crons': [], 'cloud_mutation': False, 'next': 'cloud-plan'}, indent=2))


def dashboard(args):
    prefix = args.prefix.expanduser().resolve()
    receipt(prefix)
    command = [sys.executable, str(prefix / 'dashboard/server.py'), '--prefix', str(prefix), '--port', str(args.port)]
    if args.allow_remote_read:
        command.append('--allow-remote-read')
    if args.allow_remote_cancel:
        if not args.allow_remote_read:
            raise ValueError('Remote cancellation requires explicitly enabling remote read as well')
        command.append('--allow-remote-cancel')
    run(command, prefix)


def cloud_plan(args):
    prefix = args.prefix.expanduser().resolve()
    receipt(prefix)
    path = prefix / 'service' / INSTANCE_CONFIG
    config = json.loads(path.read_text(encoding='utf-8')) if path.exists() else None
    print(json.dumps({'service_directory': str(prefix / 'service'),
       'commands_after_owner_authorization': [
          'npx --no-install wrangler login',
          'npx --no-install wrangler d1 create <NEW_DATABASE_NAME>',
          'npx --no-install wrangler r2 bucket create <NEW_BUCKET_NAME>',
          'Run setup cloud-config with returned NEW D1 UUID and distinct names',
          'npx --no-install wrangler d1 migrations apply <NEW_DATABASE_NAME> --remote --config ' + INSTANCE_CONFIG,
          'npx --no-install wrangler secret put <SECRET_NAME> --config ' + INSTANCE_CONFIG,
          'Run setup deploy --prefix <PREFIX> --confirm-worker-name <NEW_WORKER_NAME>'],
       'configured_worker': config['name'] if config else None,
       'required_secrets': list(SECRET_NAMES), 'cron_remains_disabled': True,
       'production_data_or_tokens_to_copy': False, 'commands_executed': False}, indent=2))


def deploy(args):
    prefix = args.prefix.expanduser().resolve()
    receipt(prefix)
    config = json.loads((prefix / 'service' / INSTANCE_CONFIG).read_text(encoding='utf-8'))
    if (config['name'] != args.confirm_worker_name or config['name'] == ORIGINAL_WORKER
            or config.get('triggers', {}).get('crons') or config['d1_databases'][0]['database_name'] == 'social-publisher'
            or config['r2_buckets'][0]['bucket_name'] == 'social-publisher-media'):
        raise ValueError('Distinct worker confirmation, new D1/R2 and disabled Cron are required')
    database_id = UUID(config['d1_databases'][0]['database_id'])
    if not database_id.int or not shutil.which('node'):
        raise ValueError('A real NEW D1 UUID and Node are required')
    wrangler = prefix / 'service/node_modules/wrangler/bin/wrangler.js'
    if not wrangler.is_file():
        raise ValueError('Install dependencies first with npm ci in the instance service directory')
    run([shutil.which('node'), str(wrangler), 'deploy', '--config', INSTANCE_CONFIG], prefix / 'service')
    data = receipt(prefix)
    data['cloud_deployed'] = True
    data['worker_name'] = config['name']
    write_json(prefix / RECEIPT_NAME, data)


def rollback_plan(args):
    prefix = args.prefix.expanduser().resolve()
    data = receipt(prefix)
    changed = [item['path'] for item in data['files']
               if not (prefix / item['path']).is_file()
               or hashlib.sha256((prefix / item['path']).read_bytes()).hexdigest() != item['sha256']]
    print(json.dumps({'prefix': str(prefix), 'status': data['status'], 'changed_or_missing': changed,
       'action': 'Review all new content, stop only processes started for this instance, then remove only this verified new prefix if authorized.',
       'automatic_deletion': False, 'existing_user_profile_changed': False,
       'cloud': 'Local removal does not remove Workers, D1/R2 or provider objects. Handle them separately with explicit authorization.'}, indent=2))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest='command', required=True)
    for name in ('install', 'doctor', 'dashboard', 'cloud-config', 'cloud-plan', 'deploy', 'rollback-plan'):
        command = commands.add_parser(name)
        command.add_argument('--prefix', type=Path, required=True)
        if name == 'install':
            command.add_argument('--skip-deps', action='store_true')
        if name == 'dashboard':
            command.add_argument('--port', type=int, default=8788)
            command.add_argument('--allow-remote-read', action='store_true')
            command.add_argument('--allow-remote-cancel', action='store_true')
        if name == 'cloud-config':
            for argument in ('worker-name', 'database-name', 'database-id', 'bucket-name'):
                command.add_argument('--' + argument, required=True)
            origin = command.add_mutually_exclusive_group(required=True)
            origin.add_argument('--public-base-url')
            origin.add_argument('--workers-subdomain', help='Use the existing account workers.dev subdomain; no domain purchase or DNS change')
        if name == 'deploy':
            command.add_argument('--confirm-worker-name', required=True)
    args = parser.parse_args()
    actions = {'install': install, 'doctor': doctor, 'cloud-config': cloud_config,
               'cloud-plan': cloud_plan, 'deploy': deploy, 'rollback-plan': rollback_plan, 'dashboard': dashboard}
    try:
        actions[args.command](args)
    except (OSError, ValueError, subprocess.CalledProcessError) as error:
        print('Setup failed: ' + str(error), file=sys.stderr)
        return 1
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
