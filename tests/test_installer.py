"""Filesystem and mutation-boundary tests for the new installer."""
import contextlib
import importlib.util
import io
import json
from pathlib import Path
import tempfile
import unittest
from unittest import mock

ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location('setup', ROOT / 'social_publisher_setup.py')
SETUP = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(SETUP)


class InstallerTest(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix='publisher-installer-')
        self.base = Path(self.temporary.name)
        self.prefix = self.base / 'instance with spaces'

    def tearDown(self):
        self.temporary.cleanup()

    def install(self):
        with contextlib.redirect_stdout(io.StringIO()):
            SETUP.install(type('Args', (), {'prefix': self.prefix, 'skip_deps': True})())

    def config_args(self):
        return type('Args', (), {'prefix': self.prefix, 'worker_name': 'publisher-qa-duplicate',
            'database_name': 'publisher-qa-db', 'database_id': '11111111-1111-4111-8111-111111111111',
            'bucket_name': 'publisher-qa-media', 'public_base_url': 'https://publisher-qa.example',
            'workers_subdomain': None})()

    def test_install_creates_runnable_isolated_profile_and_docs(self):
        self.install()
        registry = json.loads((self.prefix / 'home/.codex/social-publisher/registry.json').read_text())
        self.assertEqual(Path(registry['projects'][0]['root']), self.prefix / 'projects/demo')
        self.assertEqual(registry['accounts'][0]['connection_state'], 'unconfigured')
        self.assertEqual(SETUP.receipt(self.prefix)['status'], 'installed')
        self.assertEqual(SETUP.receipt(self.prefix)['dependencies'], 'not_installed')
        for path in ('service/src/index.ts', 'home/.codex/skills/social-publisher/scripts/social_queue.py',
                     'bin/social-publisher.py', 'docs/ARCHITECTURE.md', 'docs/INSTALLATION.md',
                     'docs/CLOUDFLARE.md', 'docs/ROLLBACK.md', 'docs/document.md'):
            self.assertTrue((self.prefix / path).is_file(), path)

    def test_existing_destination_is_untouched(self):
        self.prefix.mkdir()
        sentinel = self.prefix / 'keep.txt'
        sentinel.write_text('existing')
        with self.assertRaisesRegex(ValueError, 'already exists'):
            self.install()
        self.assertEqual(sentinel.read_text(), 'existing')
        self.assertEqual(list(self.prefix.iterdir()), [sentinel])

    def test_cloud_configuration_never_calls_external_commands_and_refuses_production(self):
        self.install()
        args = self.config_args()
        with mock.patch.object(SETUP, 'run', side_effect=AssertionError('external mutation forbidden')):
            args.worker_name = SETUP.ORIGINAL_WORKER
            with self.assertRaises(ValueError):
                SETUP.cloud_config(args)
            self.assertFalse((self.prefix / 'service' / SETUP.INSTANCE_CONFIG).exists())
            args.worker_name = 'publisher-qa-duplicate'
            with contextlib.redirect_stdout(io.StringIO()):
                SETUP.cloud_config(args)
                SETUP.cloud_plan(args)
            config = json.loads((self.prefix / 'service' / SETUP.INSTANCE_CONFIG).read_text())
            self.assertEqual(config['name'], args.worker_name)
            self.assertEqual(config['triggers']['crons'], [])
            self.assertEqual(config['d1_databases'][0]['database_name'], args.database_name)
            with self.assertRaisesRegex(ValueError, 'already exists'):
                SETUP.cloud_config(args)

    def test_deploy_rejects_wrong_name_or_enabled_cron_before_any_network(self):
        self.install()
        args = self.config_args()
        with contextlib.redirect_stdout(io.StringIO()):
            SETUP.cloud_config(args)
        args.confirm_worker_name = 'wrong-name'
        with mock.patch.object(SETUP, 'run', side_effect=AssertionError('network forbidden')):
            with self.assertRaises(ValueError):
                SETUP.deploy(args)
            args.confirm_worker_name = args.worker_name
            path = self.prefix / 'service' / SETUP.INSTANCE_CONFIG
            config = json.loads(path.read_text())
            config['triggers']['crons'] = ['* * * * *']
            SETUP.write_json(path, config)
            with self.assertRaises(ValueError):
                SETUP.deploy(args)
        self.assertFalse(SETUP.receipt(self.prefix)['cloud_deployed'])

    def test_workers_dev_option_needs_no_custom_domain_or_dns(self):
        self.install()
        args = self.config_args()
        args.public_base_url = None
        args.workers_subdomain = 'account-example'
        with mock.patch.object(SETUP, 'run', side_effect=AssertionError('No network or DNS')):
            with contextlib.redirect_stdout(io.StringIO()):
                SETUP.cloud_config(args)
        config = json.loads((self.prefix / 'service' / SETUP.INSTANCE_CONFIG).read_text())
        self.assertEqual(config['vars']['PUBLIC_BASE_URL'], 'https://publisher-qa-duplicate.account-example.workers.dev')
        self.assertTrue(config['workers_dev'])
        self.assertNotIn('routes', config)
        self.assertEqual(config['triggers']['crons'], [])

    def test_rollback_plan_reports_changes_without_deleting(self):
        self.install()
        path = self.prefix / 'projects/demo/queue.json'
        path.write_text('{}')
        output = io.StringIO()
        with contextlib.redirect_stdout(output):
            SETUP.rollback_plan(type('Args', (), {'prefix': self.prefix})())
        result = json.loads(output.getvalue())
        self.assertIn('projects/demo/queue.json', result['changed_or_missing'])
        self.assertFalse(result['automatic_deletion'])
        self.assertTrue(path.is_file())


if __name__ == '__main__':
    unittest.main()
