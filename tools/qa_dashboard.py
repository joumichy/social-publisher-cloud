"""Reproducible browser QA in a new, disposable instance; requires optional Python Playwright."""
import argparse
from copy import deepcopy
import importlib.util
import json
import os
import re
from pathlib import Path
import subprocess
import sys
import tempfile
import threading
from playwright.sync_api import sync_playwright, expect

sys.dont_write_bytecode = True
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('root', type=Path)
parser.add_argument('--output', type=Path, required=True)
args = parser.parse_args()
root, output = args.root.resolve(), args.output.resolve()
output.mkdir(parents=True, exist_ok=True)
checks = []
with tempfile.TemporaryDirectory(prefix='publisher-browser-') as temporary:
    prefix = Path(temporary) / 'Instance test Mac ready'
    subprocess.run([sys.executable, str(root / 'social_publisher_setup.py'), 'install', '--prefix', str(prefix), '--skip-deps'], check=True)
    registry_path = prefix / 'home/.codex/social-publisher/registry.json'
    registry = json.loads(registry_path.read_text(encoding='utf-8'))
    registry['projects'][0]['brand'] = 'Atelier Démo · données factices'
    for platform, identity in [('linkedin', 'Atelier Démo'), ('tiktok', 'atelier-demo')]:
        account = deepcopy(registry['accounts'][0])
        account.update(id='demo-' + platform, platform=platform, expected_identity=identity,
            scheduler_url='https://www.linkedin.com/feed/' if platform == 'linkedin' else 'https://www.tiktok.com/tiktokstudio/upload')
        if platform == 'tiktok':
            account['publication_mode'] = 'creator_inbox_draft'
        registry['accounts'].append(account)
    registry_path.write_text(json.dumps(registry, ensure_ascii=False), encoding='utf-8')
    queue_path = prefix / 'projects/demo/queue.json'
    queue = json.loads(queue_path.read_text(encoding='utf-8'))
    queue.update(brand='Atelier Démo · données factices', timezone='Europe/Paris')
    template = queue['posts'][0]
    template.update(title='Les détails qui font la différence')
    template['deliveries'][0]['caption'] = 'Un regard neuf sur notre atelier. Prenons le temps de raconter ce qui compte. #Démonstration'
    for identifier, title, platform, caption in [
        ('regard-coulisses', 'Dans les coulisses de l’atelier', 'linkedin', 'Partager une méthode, un geste, une idée. Le carnet de notre équipe se prépare ici.'),
        ('nouvelle-saison', 'Une nouvelle saison se dessine', 'tiktok', 'Une première intention. Une nouvelle histoire à préparer ensemble.')]:
        post = deepcopy(template)
        post.update(id=identifier, title=title)
        post['deliveries'][0].update(id=platform, platform=platform, account_ref='demo-' + platform, caption=caption)
        queue['posts'].append(post)
    queue_path.write_text(json.dumps(queue, ensure_ascii=False), encoding='utf-8')
    spec = importlib.util.spec_from_file_location('browser_dashboard', prefix / 'dashboard/server.py')
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    server = module.make_server(module.Dashboard(prefix), 0)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    origin = 'http://127.0.0.1:' + str(server.server_port)
    errors, external_requests = [], []
    try:
        with sync_playwright() as playwright:
            browser = playwright.chromium.launch(channel='chrome', headless=True)
            context = browser.new_context(viewport={'width': 1440, 'height': 1040}, device_scale_factor=1)
            def restrict(route):
                if route.request.url.startswith(origin + '/'):
                    route.continue_()
                else:
                    external_requests.append(route.request.url)
                    route.abort()
            context.route('**/*', restrict)
            page = context.new_page()
            page.on('pageerror', lambda error: errors.append(str(error)))
            page.goto(origin, wait_until='networkidle')
            expect(page.locator('.post-row')).to_have_count(3)
            expect(page.get_by_text('PRÉPARATION LOCALE', exact=True)).to_be_visible()
            page.screenshot(path=str(output / 'dashboard-overview.png'), full_page=True)
            checks.append('overview renders actual synthetic queue and unconfigured aliases')

            page.locator('#new-post').click()
            page.locator('#post-title').fill('Un prochain rendez-vous')
            page.locator('#post-caption').fill('Un lancement pensé pour demain. #Démonstration')
            page.locator('#media-import').set_input_files(str(root / 'examples/demo/media/example.png'))
            expect(page.locator('[data-media-path="0"]')).to_have_value(re.compile(r'dashboard-media/[a-f0-9]+\.png'))
            checks.append('file picker imports media into the selected project only')
            page.locator('#post-local-time').fill('2030-02-09T09:30')
            page.locator('#post-timezone').fill('Europe/Paris')
            page.screenshot(path=str(output / 'dashboard-editor.png'), full_page=True)
            page.locator('#save-post').dblclick()
            expect(page.locator('#editor')).not_to_be_visible()
            expect(page.locator('.post-row')).to_have_count(4)
            queue_now = json.loads(queue_path.read_text(encoding='utf-8'))
            created = next(post for post in queue_now['posts'] if post['title'] == 'Un prochain rendez-vous')
            assert created['deliveries'][0]['publish_at'] == '2030-02-09T09:30:00+01:00'
            checks.append('create double-click writes one draft with canonical UTC offset')
            row = page.locator('.post-row').filter(has=page.get_by_role('button', name='Un prochain rendez-vous', exact=True))
            row.get_by_role('button', name='Ouvrir', exact=True).click()
            page.locator('[data-media-path="0"]').fill('../../outside.png')
            page.locator('#save-post').click()
            expect(page.locator('#editor-error')).to_contain_text('Corrigez')
            assert len(json.loads(queue_path.read_text(encoding='utf-8'))['posts']) == 4
            page.locator('[data-media-path="0"]').fill('media/example.png')
            page.locator('#post-caption').fill('<img id="injected" src="invalid"> Texte à relire.')
            page.locator('#save-post').click()
            expect(page.locator('#editor')).not_to_be_visible()
            expect(page.locator('#injected')).to_have_count(0)
            checks.append('invalid media leaves queue unchanged; caption HTML is rendered as text')
            row.get_by_role('button', name='Approuver', exact=True).click()
            expect(page.locator('#confirm-action')).to_be_disabled()
            page.locator('#approval-check').check()
            page.locator('#confirm-action').dblclick()
            expect(page.locator('#confirmation')).not_to_be_visible()
            expect(row.locator('.badge')).to_have_text('Approuvé localement')
            row.get_by_role('button', name='Ouvrir', exact=True).click()
            page.locator('#post-caption').fill('La nouvelle légende annule l’approbation précédente.')
            page.locator('#save-post').click()
            expect(page.locator('#editor')).not_to_be_visible()
            expect(row.locator('.badge')).to_have_text('Brouillon')
            checks.append('approval requires exact confirmation; editing removes approval')
            row.get_by_role('button', name='Annuler', exact=True).click()
            page.locator('#approval-check').check()
            page.locator('#confirm-action').dblclick()
            expect(page.locator('#confirmation')).not_to_be_visible()
            expect(row.locator('.badge')).to_have_text('Annulé')
            expect(row.get_by_role('button', name='Annuler', exact=True)).to_be_disabled()
            checks.append('cancellation is confirmed and repeated button is disabled')

            page.locator('#new-post').click()
            page.locator('#post-title').fill('Changement d’heure')
            page.locator('#post-caption').fill('Test de fuseau explicite.')
            page.locator('[data-media-path="0"]').fill('media/example.png')
            page.locator('#post-local-time').fill('2030-03-31T02:30')
            page.locator('#post-timezone').fill('Europe/Paris')
            page.locator('#save-post').click()
            expect(page.locator('#editor-error')).to_contain_text('n’existe pas')
            page.locator('#post-local-time').fill('2030-10-27T02:30')
            page.locator('#save-post').click()
            expect(page.locator('#editor-error')).to_contain_text('répétée')
            page.locator('#post-fold').select_option('1')
            page.locator('#save-post').click()
            expect(page.locator('#editor')).not_to_be_visible()
            created = next(post for post in json.loads(queue_path.read_text(encoding='utf-8'))['posts'] if post['title'] == 'Changement d’heure')
            assert created['deliveries'][0]['publish_at'].endswith('+01:00')
            checks.append('DST gap and fold rejected; explicit second occurrence saved')

            page.locator('.nav-item[data-view="accounts"]').click()
            expect(page.locator('#cloud-accounts')).to_be_disabled()
            page.locator('[data-open="account-dialog"]').click()
            page.locator('#account-form [name="id"]').fill('demo-facebook')
            page.locator('#account-form [name="identity"]').fill('Atelier Démo')
            page.locator('#account-form [name="platform"]').select_option('facebook')
            page.locator('#account-form button').dblclick()
            expect(page.locator('#account-dialog')).not_to_be_visible()
            expect(page.locator('.account-table tbody tr')).to_have_count(4)
            assert json.loads(registry_path.read_text(encoding='utf-8'))['accounts'][-1]['connection_state'] == 'unconfigured'
            checks.append('local alias creation is unique and never connects an account')
            page.locator('.nav-item[data-view="projects"]').click()
            page.locator('[data-open="project-dialog"]').click()
            page.locator('#project-form [name="brand"]').fill('Carnet test')
            page.locator('#project-form [name="id"]').fill('carnet-test')
            page.locator('#project-form [name="timezone"]').fill('America/Montreal')
            page.locator('#project-form button').click()
            expect(page.locator('#project-dialog')).not_to_be_visible()
            expect(page.locator('#project-select')).to_have_value('carnet-test')
            page.locator('.nav-item[data-view="posts"]').click()
            expect(page.locator('.post-row')).to_have_count(0)
            page.locator('#project-select').select_option('demo')
            expect(page.locator('.post-row')).to_have_count(5)
            checks.append('project creation isolates queue and project switching restores correct data')
            page.locator('.nav-item[data-view="planning"]').click()
            expect(page.locator('.calendar-day')).to_have_count(7)
            page.locator('[data-week="1"]').click()
            expect(page.locator('.calendar-day')).to_have_count(7)
            page.locator('#planning-date').fill('2030-10-27')
            page.locator('#planning-date').press('Tab')
            expect(page.locator('.calendar-entry')).to_have_count(1)
            expect(page.locator('.calendar-entry')).to_contain_text('02:30')
            page.screenshot(path=str(output / 'dashboard-planning.png'), full_page=True)
            page.locator('.nav-item[data-view="validation"]').click()
            page.locator('#validate-queue').click()
            expect(page.locator('#notice')).to_contain_text('File valide')
            checks.append('weekly planning and structural validation are functional without publication')
            page.route('**/api/state*', lambda route: route.fulfill(status=503, content_type='application/json', body='{"error":"Service de test indisponible"}'))
            page.locator('#refresh').click()
            expect(page.locator('#notice')).to_contain_text('Service de test indisponible')
            page.unroute('**/api/state*')
            page.locator('#refresh').click()
            expect(page.locator('#refresh')).to_be_enabled()
            expect(page.locator('#notice')).not_to_be_visible()
            checks.append('HTTP failure is visible and reload remains available')
            page.locator('.nav-item[data-view="posts"]').click()
            page.set_viewport_size({'width': 390, 'height': 844})
            page.screenshot(path=str(output / 'dashboard-mobile.png'), full_page=True)
            assert page.evaluate('document.documentElement.scrollWidth <= window.innerWidth')
            checks.append('mobile layout has no horizontal page overflow')
            assert not errors, errors
            assert not external_requests, external_requests
            browser.close()
    finally:
        server.shutdown()
        server.server_close()
        thread.join()
(output / 'browser-results.json').write_text(json.dumps({'passed': True, 'checks': checks,
    'javascript_errors': errors, 'external_page_requests': external_requests,
    'data': 'synthetic only', 'browser': 'new isolated Chrome profile on Windows; no Mac test'}, ensure_ascii=False, indent=2), encoding='utf-8')
print(json.dumps({'passed': True, 'checks': len(checks), 'output': str(output)}, ensure_ascii=False))
