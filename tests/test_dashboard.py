"""Behavior and HTTP contracts for the local dashboard; no real provider access."""
import importlib.util
import json
from pathlib import Path
import shutil
import tempfile
import threading
import unittest
from urllib.error import HTTPError
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location('dashboard', ROOT / 'dashboard/server.py')


class DashboardTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='publisher-dashboard-')
        self.prefix = Path(self.temp.name)
        shutil.copytree(ROOT / 'cloud/social-publisher', self.prefix / 'service')
        shutil.copytree(ROOT / 'mac/skill/social-publisher', self.prefix / 'home/.codex/skills/social-publisher')
        shutil.copytree(ROOT / 'examples/demo', self.prefix / 'projects/demo')
        registry = json.loads((ROOT / 'config/registry.example.json').read_text(encoding='utf-8'))
        registry['projects'][0]['root'] = str(self.prefix / 'projects/demo')
        self.registry_path = self.prefix / 'home/.codex/social-publisher/registry.json'
        self.registry_path.parent.mkdir(parents=True)
        self.registry_path.write_text(json.dumps(registry), encoding='utf-8')
        self.module = importlib.util.module_from_spec(SPEC)
        SPEC.loader.exec_module(self.module)
        self.app = self.module.Dashboard(self.prefix)

    def tearDown(self):
        self.temp.cleanup()

    def payload(self):
        snapshot = self.app.state('demo')
        return {'project': 'demo', 'revision': snapshot['revision'], 'post': {
            'id': 'new-post', 'title': 'Un lancement', 'media': [{'path': 'media/example.png', 'kind': 'image'}],
            'deliveries': [{'id': 'instagram', 'platform': 'instagram', 'account_ref': 'demo-instagram',
                'caption': 'Texte à relire', 'publish_at': '2030-02-02T09:30:00+01:00', 'state': 'draft', 'receipt': None}]}}

    def test_create_edit_resets_approval_and_rejects_stale_repeated_click(self):
        payload = self.payload()
        result = self.app.save(payload)
        self.assertEqual(len(result['queue']['posts']), 2)
        with self.assertRaises(self.module.DashboardError) as stale:
            self.app.save(payload)
        self.assertEqual(stale.exception.status, 409)
        revision = result['revision']
        approved = self.app.approve({'project': 'demo', 'post_id': 'new-post', 'delivery_id': 'instagram',
            'revision': revision, 'confirmed': True})
        delivery = approved['queue']['posts'][1]['deliveries'][0]
        self.assertEqual(delivery['state'], 'approved')
        payload['revision'] = approved['revision']
        payload['post']['deliveries'][0]['caption'] = 'Nouvelle légende'
        edited = self.app.save(payload)
        delivery = edited['queue']['posts'][1]['deliveries'][0]
        self.assertEqual(delivery['state'], 'draft')
        self.assertNotIn('approved_at', delivery)

    def test_invalid_media_outside_project_unknown_account_and_naive_time_do_not_write(self):
        for change in ('media', 'account', 'time'):
            payload = self.payload()
            if change == 'media':
                payload['post']['media'][0]['path'] = '../../outside.png'
            elif change == 'account':
                payload['post']['deliveries'][0]['account_ref'] = 'foreign-account'
            else:
                payload['post']['deliveries'][0]['publish_at'] = '2030-02-02T09:30:00'
            with self.assertRaises(self.module.DashboardError):
                self.app.save(payload)
            self.assertEqual(len(self.app.state('demo')['queue']['posts']), 1)

    def test_timezone_rejects_dst_gaps_and_ambiguity_and_keeps_explicit_offset(self):
        self.assertEqual(self.app.resolve_time('2030-02-02T09:30', 'Europe/Paris', None), '2030-02-02T09:30:00+01:00')
        for local in ('2030-03-31T02:30', '2030-10-27T02:30'):
            with self.assertRaises(self.module.DashboardError):
                self.app.resolve_time(local, 'Europe/Paris', None)
        self.assertEqual(self.app.resolve_time('2030-10-27T02:30', 'Europe/Paris', 1), '2030-10-27T02:30:00+01:00')

    def test_cancel_local_is_idempotent_and_remote_cancel_is_blocked(self):
        payload = self.payload()
        saved = self.app.save(payload)
        body = {'project': 'demo', 'post_id': 'new-post', 'delivery_id': 'instagram', 'revision': saved['revision']}
        cancelled = self.app.cancel(body)
        again = self.app.cancel(body)
        self.assertEqual(cancelled['revision'], again['revision'])
        queue_path = self.prefix / 'projects/demo/queue.json'
        queue = json.loads(queue_path.read_text(encoding='utf-8'))
        delivery = queue['posts'][1]['deliveries'][0]
        delivery.update(state='scheduled', receipt={'native_reference': 'api:pub_demo', 'verified_at': '2030-01-01T00:00:00Z'})
        queue_path.write_text(json.dumps(queue), encoding='utf-8')
        body['revision'] = self.app.state('demo')['revision']
        with self.assertRaises(self.module.DashboardError) as blocked:
            self.app.cancel(body)
        self.assertEqual(blocked.exception.status, 403)
        self.assertEqual(self.app.state('demo')['queue']['posts'][1]['deliveries'][0]['state'], 'scheduled')

    def test_remote_read_contract_and_errors_never_expose_credentials(self):
        self.assertFalse(self.app.state('demo')['capabilities']['remote_read'])
        with self.assertRaises(self.module.DashboardError):
            self.app.remote_accounts()
        calls = []
        def transport(method, path):
            calls.append((method, path))
            if path != '/v1/accounts':
                raise AssertionError(path)
            return {'accounts': [{'id': 'demo-instagram', 'project_id': 'demo', 'platform': 'instagram',
                'connection_status': 'ready', 'access_token': 'DO-NOT-EXPOSE'}]}
        app = self.module.Dashboard(self.prefix, allow_remote_read=True, transport=transport)
        self.assertNotIn('DO-NOT-EXPOSE', json.dumps(app.remote_accounts()))
        self.assertEqual(calls, [('GET', '/v1/accounts')])
        app.transport = lambda *args: (_ for _ in ()).throw(RuntimeError('sensitive-provider-value'))
        with self.assertRaises(self.module.DashboardError) as error:
            app.remote_accounts()
        self.assertNotIn('sensitive-provider-value', str(error.exception))

    def test_http_requires_same_origin_for_writes_and_has_no_publish_route(self):
        server = self.module.make_server(self.app, 0)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        origin = f'http://127.0.0.1:{server.server_port}'
        try:
            with urlopen(origin + '/api/state?project=demo') as response:
                state = json.load(response)
            self.assertIn('revision', state)
            for path, headers, status in (
                ('/api/save', {'Origin': 'https://other.example'}, 403),
                ('/api/publish', {'Origin': origin, 'X-Requested-With': 'SocialPublisher'}, 404)):
                request = Request(origin + path, data=b'{}', headers={'Content-Type': 'application/json', **headers})
                with self.assertRaises(HTTPError) as error:
                    urlopen(request)
                self.assertEqual(error.exception.code, status)
            with self.assertRaises(HTTPError):
                urlopen(origin + '/media?project=demo&path=../../outside')
        finally:
            server.shutdown()
            server.server_close()
            thread.join()

    def test_remote_account_payload_must_match_local_project_and_platform(self):
        transport = lambda *args: {'accounts': [{'id': 'demo-instagram', 'project_id': 'other', 'platform': 'instagram', 'connection_status': 'ready'}]}
        app = self.module.Dashboard(self.prefix, allow_remote_read=True, transport=transport)
        with self.assertRaises(self.module.DashboardError) as error:
            app.remote_accounts()
        self.assertEqual(error.exception.status, 502)

    def test_remote_cancel_uses_exact_receipt_once_and_reconciles_already_cancelled(self):
        path = self.prefix / 'projects/demo/queue.json'
        queue = json.loads(path.read_text(encoding='utf-8'))
        queue['posts'][0]['deliveries'][0].update(state='scheduled', publish_at='2030-01-01T00:00:00Z',
            receipt={'native_reference': 'api:pub_demo', 'verified_at': '2030-01-01T00:00:00Z'})
        path.write_text(json.dumps(queue), encoding='utf-8')
        calls = []
        def transport(method, target):
            calls.append((method, target))
            self.assertEqual(target, '/v1/publications/pub_demo')
            return {'id': 'pub_demo', 'project_id': 'demo', 'account_id': 'demo-instagram', 'platform': 'instagram',
                'post_id': 'demo-image', 'delivery_id': 'instagram', 'state': 'cancelled'}
        app = self.module.Dashboard(self.prefix, allow_remote_read=True, allow_remote_cancel=True, transport=transport)
        result = app.cancel({'project': 'demo', 'post_id': 'demo-image', 'delivery_id': 'instagram',
            'revision': app.state('demo')['revision'], 'confirmed': True})
        self.assertEqual(result['queue']['posts'][0]['deliveries'][0]['state'], 'cancelled')
        self.assertEqual(calls, [('GET', '/v1/publications/pub_demo')])

    def test_import_media_and_registration_stay_in_instance_without_connection(self):
        png = (ROOT / 'examples/demo/media/example.png').read_bytes()
        result = self.app.import_media('demo', '../../image.png', png)
        self.assertTrue(self.app.media_path('demo', result['path']).is_relative_to(self.prefix))
        project = self.app.register_project({'id': 'new-brand', 'brand': 'Nouvelle marque', 'timezone': 'Europe/Paris'})
        self.assertEqual(project['queue']['posts'], [])
        account = self.app.register_account({'project': 'new-brand', 'id': 'new-brand-linkedin', 'platform': 'linkedin', 'identity': 'Marque test'})
        self.assertEqual(account['accounts'][-1]['connection_state'], 'unconfigured')
        with self.assertRaises(self.module.DashboardError):
            self.app.register_project({'id': 'new-brand', 'brand': 'Dupliqué', 'timezone': 'Etc/UTC'})

    def test_approval_requires_exact_confirmation_and_future_time(self):
        payload = self.payload()
        saved = self.app.save(payload)
        body = {'project': 'demo', 'post_id': 'new-post', 'delivery_id': 'instagram', 'revision': saved['revision']}
        with self.assertRaises(self.module.DashboardError):
            self.app.approve(body)
        self.assertEqual(self.app.state('demo')['queue']['posts'][1]['deliveries'][0]['state'], 'draft')
        body['confirmed'] = True
        approved = self.app.approve(body)
        body['revision'] = approved['revision']
        repeated = self.app.approve(body)
        self.assertEqual(approved['revision'], repeated['revision'])

    def test_remote_status_checks_identity_and_cancel_success_is_not_repeated(self):
        path = self.prefix / 'projects/demo/queue.json'
        queue = json.loads(path.read_text(encoding='utf-8'))
        queue['posts'][0]['deliveries'][0].update(state='scheduled', publish_at='2030-01-01T00:00:00Z',
            receipt={'native_reference': 'api:pub_demo', 'verified_at': '2030-01-01T00:00:00Z'})
        path.write_text(json.dumps(queue), encoding='utf-8')
        calls = []
        def transport(method, target):
            calls.append((method, target))
            if method == 'GET':
                self.assertEqual(target, '/v1/publications/pub_demo')
                return {'id': 'pub_demo', 'project_id': 'demo', 'account_id': 'demo-instagram', 'platform': 'instagram',
                    'post_id': 'demo-image', 'delivery_id': 'instagram', 'state': 'scheduled', 'last_error': None}
            self.assertEqual((method, target), ('POST', '/v1/publications/pub_demo/cancel'))
            return {'id': 'pub_demo', 'state': 'cancelled'}
        app = self.module.Dashboard(self.prefix, allow_remote_read=True, allow_remote_cancel=True, transport=transport)
        body = {'project': 'demo', 'post_id': 'demo-image', 'delivery_id': 'instagram',
            'revision': app.state('demo')['revision'], 'confirmed': True}
        result = app.cancel(body)
        self.assertEqual(result['queue']['posts'][0]['deliveries'][0]['state'], 'cancelled')
        app.cancel(body)
        self.assertEqual(calls, [('GET', '/v1/publications/pub_demo'), ('POST', '/v1/publications/pub_demo/cancel')])


if __name__ == '__main__':
    unittest.main()
