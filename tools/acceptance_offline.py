"""Exercise exported code using temporary demo data, never production configuration."""
import argparse
import importlib.util
import json
from pathlib import Path
import shutil
import sqlite3
import sys
import tempfile
from unittest import mock

QUEUE_SCRIPT = 'mac/skill/social-publisher/scripts/social_queue.py'
API_SCRIPT = 'cloud/social-publisher/scripts/social_api.py'
MIGRATION_DIRECTORY = 'cloud/social-publisher/migrations'
EXPECTED_MIGRATION_COUNT = 9
EXPECTED_PUBLICATION_STATE = 'awaiting_creator'
sys.dont_write_bytecode = True


def load_module(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('root', type=Path)
    root = parser.parse_args().root.resolve()
    queue_module = load_module('export_queue', root / QUEUE_SCRIPT)
    api_module = load_module('export_api', root / API_SCRIPT)
    with tempfile.TemporaryDirectory(prefix='social-publisher-acceptance-') as temporary:
        demo_root = Path(temporary) / 'demo'
        shutil.copytree(root / 'examples/demo', demo_root)
        registry = json.loads((root / 'config/registry.example.json').read_text(encoding='utf-8'))
        registry['projects'][0]['root'] = str(demo_root)
        registry['api']['service_root'] = str(root / 'cloud/social-publisher')
        registry_path = Path(temporary) / 'registry.json'
        registry_path.write_text(json.dumps(registry), encoding='utf-8')
        issues = queue_module.validate_registry(registry)
        project, project_root, queue_path = queue_module.project_paths(registry, 'demo')
        queue = queue_module.load_json(queue_path)
        issues += queue_module.validate_queue(registry, project, project_root, queue_path, queue)
        if issues:
            raise AssertionError(issues)
        plan = queue_module.command_plan(registry, argparse.Namespace(project='demo', now=None))
        if 'draft' not in json.dumps(plan):
            raise AssertionError('Demo must stay draft')
        with (mock.patch.object(api_module, 'REGISTRY_PATH', registry_path),
              mock.patch.object(api_module, 'load_queue_module', return_value=queue_module),
              mock.patch.object(api_module, 'upload_file', side_effect=AssertionError('Forbidden upload')) as upload,
              mock.patch.object(api_module, 'api_json', side_effect=AssertionError('Forbidden API call')) as network):
            try:
                api_module.command_submit(argparse.Namespace(project='demo', post='demo-image', delivery='instagram'))
            except api_module.ApiCliError:
                pass
            else:
                raise AssertionError('Draft submission accepted')
            upload.assert_not_called()
            network.assert_not_called()

    database = sqlite3.connect(':memory:')
    migrations = sorted((root / MIGRATION_DIRECTORY).glob('*.sql'))
    if len(migrations) != EXPECTED_MIGRATION_COUNT:
        raise AssertionError('Migration inventory changed')
    for migration in migrations:
        database.executescript(migration.read_text(encoding='utf-8'))
    if database.execute('PRAGMA foreign_key_check').fetchall():
        raise AssertionError('Foreign key violations')
    publication_schema = database.execute("SELECT sql FROM sqlite_master WHERE name = 'publications'").fetchone()[0]
    if EXPECTED_PUBLICATION_STATE not in publication_schema:
        raise AssertionError('Missing awaiting_creator state')
    table_names = sorted(row[0] for row in database.execute("SELECT name FROM sqlite_master WHERE type = 'table'"))
    if any(database.execute('SELECT COUNT(*) FROM ' + name).fetchone()[0] for name in table_names):
        raise AssertionError('Migrations seeded operational records')
    database.close()
    print(json.dumps({'valid': True, 'demo_validation': 'pass', 'demo_plan': 'draft',
                      'draft_submission': 'rejected_before_upload', 'network_calls': 0,
                      'migrations_on_empty_sqlite': len(migrations), 'tables': table_names,
                      'sqlite_version': sqlite3.sqlite_version, 'production_and_mac': 'not_accessed'}, indent=2))


if __name__ == '__main__':
    main()
