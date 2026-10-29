"""Loopback dashboard for an installed Social Publisher instance; provider writes are opt-in."""
import argparse
from copy import deepcopy
from datetime import datetime, timezone
import hashlib
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import importlib.util
import json
import mimetypes
from pathlib import Path
import re
import sys
import threading
from urllib.parse import parse_qs, unquote, urlparse
from uuid import uuid4
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

sys.dont_write_bytecode = True
STATIC_ROOT = Path(__file__).resolve().parent / 'static'
LOOPBACK = '127.0.0.1'
DEFAULT_PORT = 8788
JSON_LIMIT = 2 * 1024 * 1024
MEDIA_LIMIT = 100 * 1024 * 1024
REQUEST_HEADER = 'SocialPublisher'
EDITABLE_STATES = frozenset(('draft', 'approved', 'cancelled', 'failed'))
REMOTE_CANCELLABLE = frozenset(('scheduled', 'retry'))
KNOWN_REMOTE_STATES = frozenset(('scheduled', 'publishing', 'processing', 'awaiting_creator', 'published', 'retry', 'failed', 'cancelled'))
MEDIA_EXTENSIONS = frozenset(('.png', '.jpg', '.jpeg', '.webp', '.mp4', '.mov', '.m4v', '.webm', '.pdf'))
SCHEDULERS = {'instagram': 'https://business.facebook.com/latest/content_calendar',
              'facebook': 'https://business.facebook.com/latest/content_calendar',
              'linkedin': 'https://www.linkedin.com/feed/', 'tiktok': 'https://www.tiktok.com/tiktokstudio/upload'}
PLATFORMS = frozenset(SCHEDULERS)
REFERENCE_PATTERN = re.compile(r'^api:([a-zA-Z0-9_-]+)$')
ACCOUNT_FIELDS = ('id', 'project_id', 'platform', 'expected_identity', 'connection_state',
                  'api_connection_state', 'publication_mode', 'connection_kind')
DELIVERY_FIELDS = ('id', 'platform', 'account_ref', 'caption', 'title', 'alt_text', 'publish_at', 'state', 'receipt', 'settings', 'approved_at')
REMOTE_ACCOUNT_FIELDS = ('id', 'project_id', 'platform', 'connection_status', 'display_name', 'publication_mode')


class DashboardError(Exception):
    def __init__(self, message, status=400, issues=None):
        super().__init__(message)
        self.status = status
        self.issues = issues or []


def load_module(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class Dashboard:
    def __init__(self, prefix, allow_remote_read=False, allow_remote_cancel=False, transport=None):
        self.prefix = Path(prefix).resolve()
        self.registry_path = self.prefix / 'home/.codex/social-publisher/registry.json'
        self.queue_engine = load_module('dashboard_queue', self.prefix / 'home/.codex/skills/social-publisher/scripts/social_queue.py')
        self.api_engine = load_module('dashboard_api', self.prefix / 'service/scripts/social_api.py')
        self.api_engine.REGISTRY_PATH = self.registry_path
        sys.path.insert(0, str(self.prefix / 'service/scripts'))
        self.allow_remote_read = allow_remote_read
        self.allow_remote_cancel = allow_remote_cancel and allow_remote_read
        self.transport = transport or self.api_engine.api_json
        self.lock = threading.RLock()

    def registry(self):
        return self.queue_engine.load_json(self.registry_path)

    def context(self, project_id):
        registry = self.registry()
        try:
            project, root, queue_path = self.queue_engine.project_paths(registry, project_id)
        except self.queue_engine.SocialQueueError as error:
            raise DashboardError('Projet inconnu.', 404) from error
        if not queue_path.is_relative_to(root):
            raise DashboardError('Le chemin de file sort du projet.')
        queue = self.queue_engine.load_json(queue_path)
        revision = hashlib.sha256(queue_path.read_bytes()).hexdigest()
        return registry, project, root, queue_path, queue, revision

    def state(self, project_id=None):
        registry = self.registry()
        if not project_id and registry.get('projects'):
            project_id = registry['projects'][0]['id']
        data = {'projects': [{key: project[key] for key in ('id', 'brand', 'queue_path')} for project in registry.get('projects', [])],
                'accounts': [{key: account[key] for key in ACCOUNT_FIELDS if key in account} for account in registry.get('accounts', [])],
                'capabilities': {'remote_read': self.allow_remote_read, 'remote_cancel': self.allow_remote_cancel,
                                 'publish': False, 'oauth': False, 'advertising': False},
                'project_id': project_id, 'queue': None, 'revision': None, 'issues': [], 'plan': []}
        if project_id:
            registry, project, root, path, queue, revision = self.context(project_id)
            data.update(queue={'schema_version': queue.get('schema_version'), 'project_id': queue.get('project_id'),
                'brand': queue.get('brand'), 'timezone': queue.get('timezone'), 'posts': [
                    {'id': post['id'], 'title': post.get('title', ''), 'media': post.get('media', []),
                     'deliveries': [{key: delivery[key] for key in DELIVERY_FIELDS if key in delivery} for delivery in post.get('deliveries', [])]}
                    for post in queue.get('posts', [])]}, revision=revision)
            data['issues'] = self.queue_engine.validate_registry(registry) + self.queue_engine.validate_queue(registry, project, root, path, queue)
            if not any(issue['level'] == 'error' for issue in data['issues']):
                data['plan'] = self.queue_engine.command_plan(registry, argparse.Namespace(project=project_id, now=None))['items']
        return data

    def checked_context(self, body):
        context = self.context(body.get('project'))
        if body.get('revision') != context[-1]:
            raise DashboardError('La file a changé. Rechargez avant de réessayer.', 409)
        return context

    def validate_queue(self, registry, project, root, path, queue):
        issues = self.queue_engine.validate_registry(registry) + self.queue_engine.validate_queue(registry, project, root, path, queue)
        if any(issue['level'] == 'error' for issue in issues):
            raise DashboardError('Corrigez les champs signalés avant d’enregistrer.', issues=issues)

    def canonical_post(self, value):
        if not isinstance(value, dict) or not self.queue_engine.is_identifier(value.get('id')):
            raise DashboardError('Identifiant de publication invalide.')
        deliveries = value.get('deliveries')
        if not isinstance(deliveries, list) or not deliveries:
            raise DashboardError('Une diffusion au moins est requise.')
        media = value.get('media')
        if not isinstance(media, list) or any(not isinstance(item, dict) for item in media):
            raise DashboardError('La liste des médias est invalide.')
        result = {'id': value['id'], 'title': str(value.get('title', '')).strip(),
                  'media': [{'path': item.get('path'), 'kind': item.get('kind')} for item in media], 'deliveries': []}
        for item in deliveries:
            if not isinstance(item, dict):
                raise DashboardError('Diffusion invalide.')
            delivery = {key: item[key] for key in ('id', 'platform', 'account_ref', 'caption', 'title', 'alt_text', 'publish_at', 'settings') if key in item}
            delivery.update(state='draft', receipt=None)
            result['deliveries'].append(delivery)
        return result

    def save(self, body):
        with self.lock:
            registry, project, root, path, queue, revision = self.checked_context(body)
            post = self.canonical_post(body.get('post'))
            existing = next((item for item in queue['posts'] if item['id'] == post['id']), None)
            if existing and any(item['state'] not in EDITABLE_STATES or item.get('receipt') for item in existing['deliveries']):
                raise DashboardError('Cette publication a un reçu d’exécution : modification bloquée.', 409)
            if existing:
                queue['posts'][queue['posts'].index(existing)] = post
            else:
                queue['posts'].append(post)
            self.validate_queue(registry, project, root, path, queue)
            self.queue_engine.atomic_write_json(path, queue)
            return self.state(project['id'])

    def validate(self, body):
        registry, project, root, path, queue, revision = self.context(body.get('project'))
        issues = self.queue_engine.validate_registry(registry) + self.queue_engine.validate_queue(registry, project, root, path, queue)
        return {'valid': not any(item['level'] == 'error' for item in issues), 'issues': issues, 'revision': revision}

    def selected(self, queue, body):
        try:
            post = self.queue_engine.find_post(queue, body.get('post_id'))
            delivery = self.queue_engine.find_delivery(post, body.get('delivery_id'))
            return post, delivery
        except self.queue_engine.SocialQueueError as error:
            raise DashboardError('Diffusion introuvable.', 404) from error

    def approve(self, body):
        with self.lock:
            registry, project, root, path, queue, revision = self.checked_context(body)
            post, delivery = self.selected(queue, body)
            if body.get('confirmed') is not True:
                raise DashboardError('L’approbation explicite du texte, des médias, du compte et de l’heure est requise.')
            if delivery['state'] not in ('draft', 'approved') or delivery.get('receipt'):
                raise DashboardError('Seul un brouillon sans reçu peut être approuvé.', 409)
            self.validate_queue(registry, project, root, path, queue)
            value = delivery.get('publish_at')
            if not value or self.queue_engine.parse_datetime(value) <= datetime.now(timezone.utc):
                raise DashboardError('Choisissez une heure future avec un fuseau explicite.')
            if delivery['state'] == 'approved':
                return self.state(project['id'])
            self.queue_engine.command_approve(registry, argparse.Namespace(project=project['id'], post=post['id'], delivery=delivery['id'], confirmed_by='user'))
            return self.state(project['id'])

    def remote(self, method, path):
        if not self.allow_remote_read:
            raise DashboardError('La lecture cloud est désactivée pour cette session.', 403)
        try:
            result = self.transport(method, path)
            if not isinstance(result, dict):
                raise ValueError('Invalid response')
            return result
        except Exception as error:
            raise DashboardError('Le service cloud est indisponible ou a refusé la demande. Aucune relance automatique.', 502) from error

    def remote_accounts(self):
        result = self.remote('GET', '/v1/accounts')
        if not isinstance(result.get('accounts'), list):
            raise DashboardError('Réponse de comptes cloud invalide.', 502)
        known = {account['id']: account for account in self.registry().get('accounts', [])}
        for account in result['accounts']:
            if not isinstance(account, dict):
                raise DashboardError('Réponse de comptes cloud invalide.', 502)
            local = known.get(account.get('id'))
            if local and (account.get('project_id') != local['project_id'] or account.get('platform') != local['platform']
                          or account.get('connection_status') not in ('ready', 'expired', 'revoked')):
                raise DashboardError('L’identité cloud diffère de l’alias local.', 502)
        return {'accounts': [{key: account[key] for key in REMOTE_ACCOUNT_FIELDS if key in account}
                             for account in result['accounts'] if isinstance(account, dict) and account.get('id') in known], 'source': 'cloud'}

    def remote_status(self, body):
        registry, project, root, path, queue, revision = self.context(body.get('project'))
        post, delivery = self.selected(queue, body)
        reference = (delivery.get('receipt') or {}).get('native_reference', '')
        match = REFERENCE_PATTERN.fullmatch(reference)
        if not match:
            raise DashboardError('Cette diffusion ne possède pas de reçu API interrogeable.')
        result = self.remote('GET', '/v1/publications/' + match[1])
        required = {'id': match[1], 'project_id': project['id'], 'account_id': delivery['account_ref'],
                    'post_id': post['id'], 'delivery_id': delivery['id'], 'platform': delivery['platform']}
        if any(result.get(key) != value for key, value in required.items()) or result.get('state') not in KNOWN_REMOTE_STATES:
            raise DashboardError('Le statut cloud ne correspond pas à cette diffusion.', 502)
        return {'id': result['id'], 'state': result['state'], 'has_error': bool(result.get('last_error')),
                'provider_reference': result.get('provider_reference'), 'source': 'cloud', 'observed_at': datetime.now(timezone.utc).isoformat()}

    def cancel(self, body):
        with self.lock:
            registry, project, root, path, queue, revision = self.context(body.get('project'))
            post, delivery = self.selected(queue, body)
            if delivery['state'] == 'cancelled':
                return self.state(project['id'])
            if body.get('revision') != revision:
                raise DashboardError('La file a changé. Rechargez avant de réessayer.', 409)
            if delivery.get('receipt'):
                if not self.allow_remote_cancel:
                    raise DashboardError('L’annulation cloud est désactivée. Le reçu est conservé.', 403)
                if body.get('confirmed') is not True:
                    raise DashboardError('Confirmez l’annulation de cette diffusion exacte.')
                remote = self.remote_status(body)
                if remote['state'] not in REMOTE_CANCELLABLE and remote['state'] != 'cancelled':
                    raise DashboardError('Exécution en cours ou terminée : annulation automatique refusée.', 409)
                if remote['state'] != 'cancelled':
                    result = self.remote('POST', '/v1/publications/' + remote['id'] + '/cancel')
                    if result.get('id') != remote['id'] or result.get('state') != 'cancelled':
                        raise DashboardError('Issue d’annulation incertaine : relisez le statut avant toute nouvelle tentative.', 502)
            elif delivery['state'] not in EDITABLE_STATES:
                raise DashboardError('Cette diffusion ne peut pas être annulée localement.', 409)
            delivery['state'] = 'cancelled'
            self.queue_engine.atomic_write_json(path, queue)
            return self.state(project['id'])

    def resolve_time(self, local_value, timezone_name, fold):
        try:
            local = datetime.fromisoformat(local_value)
            zone = ZoneInfo(timezone_name)
        except (ValueError, TypeError, ZoneInfoNotFoundError) as error:
            raise DashboardError('Date locale ou fuseau IANA invalide.') from error
        if local.tzinfo is not None:
            raise DashboardError('Saisissez une heure locale sans décalage dans ce champ.')
        choices = [local.replace(tzinfo=zone, fold=value) for value in (0, 1)]
        valid = [value for value in choices if value.astimezone(timezone.utc).astimezone(zone).replace(tzinfo=None) == local]
        if not valid:
            raise DashboardError('Cette heure n’existe pas lors du passage à l’heure d’été.')
        if choices[0].utcoffset() != choices[1].utcoffset() and fold not in (0, 1):
            raise DashboardError('Cette heure est répétée lors du changement d’heure. Choisissez la première ou la seconde occurrence.')
        return choices[fold if fold in (0, 1) else 0].isoformat(timespec='seconds')

    def media_path(self, project_id, value):
        registry, project, root, path, queue, revision = self.context(project_id)
        candidate = (path.parent / value).resolve()
        if not candidate.is_relative_to(root) or candidate.suffix.lower() not in MEDIA_EXTENSIONS or not candidate.is_file():
            raise DashboardError('Média absent ou extérieur au projet.', 404)
        return candidate

    def import_media(self, project_id, filename, content):
        registry, project, root, path, queue, revision = self.context(project_id)
        suffix = Path(filename).suffix.lower()
        if suffix not in MEDIA_EXTENSIONS or not content or len(content) > MEDIA_LIMIT:
            raise DashboardError('Format ou taille de média non pris en charge.')
        directory = path.parent / 'dashboard-media'
        if not directory.resolve().is_relative_to(root):
            raise DashboardError('Répertoire média invalide.')
        directory.mkdir(exist_ok=True)
        name = uuid4().hex + suffix
        with (directory / name).open('xb') as output:
            output.write(content)
        kind = next(key for key, values in self.queue_engine.MEDIA_KIND_EXTENSIONS.items() if suffix in values)
        return {'path': 'dashboard-media/' + name, 'kind': kind, 'bytes': len(content)}

    def register_project(self, body):
        with self.lock:
            identifier, brand, zone = body.get('id'), body.get('brand'), body.get('timezone')
            if not self.queue_engine.is_identifier(identifier) or not isinstance(brand, str) or not brand.strip():
                raise DashboardError('Identifiant kebab-case et nom de projet requis.')
            try:
                ZoneInfo(zone)
            except (TypeError, ZoneInfoNotFoundError) as error:
                raise DashboardError('Fuseau IANA invalide.') from error
            registry = self.registry()
            target = self.prefix / 'projects' / identifier
            if target.exists() or any(item['id'] == identifier for item in registry['projects']):
                raise DashboardError('Ce projet existe déjà.', 409)
            target.mkdir(parents=True)
            self.queue_engine.atomic_write_json(target / 'queue.json', {'schema_version': 1, 'project_id': identifier, 'brand': brand.strip(), 'timezone': zone, 'posts': []})
            registry['projects'].append({'id': identifier, 'brand': brand.strip(), 'root': str(target), 'queue_path': 'queue.json'})
            self.queue_engine.atomic_write_json(self.registry_path, registry)
            return self.state(identifier)

    def register_account(self, body):
        with self.lock:
            registry = self.registry()
            project = body.get('project')
            if project not in {item['id'] for item in registry['projects']}:
                raise DashboardError('Projet inconnu.', 404)
            identifier, platform, identity = body.get('id'), body.get('platform'), body.get('identity')
            if not self.queue_engine.is_identifier(identifier) or platform not in PLATFORMS or not isinstance(identity, str) or not identity.strip():
                raise DashboardError('Alias, plateforme et identité attendue requis.')
            if any(account['id'] == identifier for account in registry['accounts']):
                raise DashboardError('Cet alias existe déjà.', 409)
            account = {'id': identifier, 'project_id': project, 'platform': platform, 'expected_identity': identity.strip(),
                       'connection_state': 'unconfigured', 'api_connection_state': 'needs_connection', 'execution_provider': 'api',
                       'scheduler_provider': 'native', 'scheduler_url': SCHEDULERS[platform], 'native_horizon_days': 10 if platform == 'tiktok' else 29}
            if platform == 'tiktok':
                mode = body.get('publication_mode')
                if mode not in self.queue_engine.SUPPORTED_TIKTOK_PUBLICATION_MODES:
                    raise DashboardError('Choisissez le contrat TikTok de cet alias.')
                account['publication_mode'] = mode
            registry['accounts'].append(account)
            self.queue_engine.atomic_write_json(self.registry_path, registry)
            return self.state(project)


def make_server(app, port=DEFAULT_PORT):
    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *args):
            pass

        def json(self, value, status=200):
            raw = json.dumps(value, ensure_ascii=False).encode('utf-8')
            self.send_response(status)
            self.send_header('Content-Type', 'application/json; charset=utf-8')
            self.send_header('Content-Length', str(len(raw)))
            self.send_header('Cache-Control', 'no-store')
            self.send_header('X-Content-Type-Options', 'nosniff')
            self.end_headers()
            self.wfile.write(raw)

        def origin(self):
            return f'http://{LOOPBACK}:{self.server.server_port}'

        def check_host(self):
            if self.headers.get('Host') != f'{LOOPBACK}:{self.server.server_port}':
                raise DashboardError('Hôte local non autorisé.', 403)

        def do_GET(self):
            try:
                self.check_host()
                url = urlparse(self.path)
                query = {key: values[0] for key, values in parse_qs(url.query).items()}
                if url.path == '/api/state':
                    return self.json(app.state(query.get('project')))
                if url.path == '/api/accounts':
                    return self.json(app.remote_accounts())
                if url.path == '/media':
                    path = app.media_path(query.get('project'), query.get('path', ''))
                elif url.path in ('/', '/app.js', '/styles.css'):
                    path = STATIC_ROOT / ('index.html' if url.path == '/' else url.path[1:])
                else:
                    raise DashboardError('Page introuvable.', 404)
                self.send_response(200)
                self.send_header('Content-Type', mimetypes.guess_type(path.name)[0] or 'application/octet-stream')
                self.send_header('Content-Length', str(path.stat().st_size))
                self.send_header('X-Content-Type-Options', 'nosniff')
                self.send_header('Cache-Control', 'no-store')
                self.send_header('Content-Security-Policy', "default-src 'self'; img-src 'self' blob:; script-src 'self'; style-src 'self'; connect-src 'self'; frame-ancestors 'none'")
                self.end_headers()
                with path.open('rb') as source:
                    while block := source.read(65536):
                        self.wfile.write(block)
            except DashboardError as error:
                self.json({'error': str(error), 'issues': error.issues}, error.status)
            except (OSError, ValueError, KeyError, TypeError, app.queue_engine.SocialQueueError):
                self.json({'error': 'Données locales illisibles ou configuration incomplète. Vérifiez le registre et la file.'}, 400)

        def do_POST(self):
            try:
                self.check_host()
                if self.headers.get('Origin') != self.origin() or self.headers.get('X-Requested-With') != REQUEST_HEADER:
                    raise DashboardError('Requête locale d’origine différente refusée.', 403)
                url = urlparse(self.path)
                length = int(self.headers.get('Content-Length', '0'))
                limit = MEDIA_LIMIT if url.path == '/api/import-media' else JSON_LIMIT
                if length <= 0 or length > limit:
                    raise DashboardError('Taille de requête invalide.', 413)
                if url.path == '/api/import-media':
                    query = {key: values[0] for key, values in parse_qs(url.query).items()}
                    return self.json(app.import_media(query.get('project'), query.get('name', ''), self.rfile.read(length)))
                if self.headers.get('Content-Type') != 'application/json':
                    raise DashboardError('Un corps JSON est requis.', 415)
                body = json.loads(self.rfile.read(length))
                if not isinstance(body, dict):
                    raise DashboardError('Objet JSON requis.')
                routes = {'/api/save': app.save, '/api/validate': app.validate, '/api/approve': app.approve,
                          '/api/cancel': app.cancel, '/api/status': app.remote_status,
                          '/api/projects': app.register_project, '/api/accounts': app.register_account}
                if url.path == '/api/resolve-time':
                    return self.json({'publish_at': app.resolve_time(body.get('local'), body.get('timezone'), body.get('fold'))})
                if url.path not in routes:
                    raise DashboardError('Action indisponible dans ce tableau de bord.', 404)
                self.json(routes[url.path](body))
            except DashboardError as error:
                self.json({'error': str(error), 'issues': error.issues}, error.status)
            except (OSError, ValueError, KeyError, TypeError, app.queue_engine.SocialQueueError):
                self.json({'error': 'Demande invalide ou fichier non accessible. Les modifications n’ont pas été confirmées.'}, 400)

    return ThreadingHTTPServer((LOOPBACK, port), Handler)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--prefix', type=Path, required=True)
    parser.add_argument('--port', type=int, default=DEFAULT_PORT)
    parser.add_argument('--allow-remote-read', action='store_true')
    parser.add_argument('--allow-remote-cancel', action='store_true')
    args = parser.parse_args()
    app = Dashboard(args.prefix, args.allow_remote_read, args.allow_remote_cancel)
    server = make_server(app, args.port)
    print(f'Tableau de bord : http://{LOOPBACK}:{server.server_port} — Ctrl+C pour arrêter.', flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == '__main__':
    main()
