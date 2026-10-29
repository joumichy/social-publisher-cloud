'use strict';
const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const names = {instagram: 'Instagram', facebook: 'Facebook', linkedin: 'LinkedIn', tiktok: 'TikTok'};
const icons = {instagram: '◎', facebook: 'f', linkedin: 'in', tiktok: '♪'};
const states = {draft: 'Brouillon', approved: 'Approuvé localement', scheduled: 'Programmé', published: 'Publié', failed: 'Échec', retry: 'Nouvel essai attendu', cancelled: 'Annulé', processing: 'En traitement', publishing: 'En cours', awaiting_creator: 'À finaliser dans TikTok'};
const accountStates = {unconfigured: 'Non configuré', needs_connection: 'Connexion requise', needs_verification: 'Identité à vérifier', ready: 'Prêt selon le registre', verified: 'Vérifié selon le registre'};
const viewTitles = {posts: ['Publications', 'Une idée claire. Le bon format. Le bon moment.'], planning: ['Planning', 'Une vue d’ensemble, dans le fuseau de votre projet.'], accounts: ['Comptes', 'Des identités explicites. Des connexions à vérifier.'], projects: ['Projets', 'Un espace et une file propres à chaque marque.'], validation: ['Validations', 'Relire les détails avant la moindre diffusion.']};
const editStates = new Set(['draft', 'approved', 'failed', 'cancelled']);
const busy = new Set();
let data, view = 'posts', filter = 'all', search = '', editPost, editIndex = 0, confirmationAction, editLocked = false;
let loadGeneration = 0, weekStart = mondayForCivil(new Date().toISOString().slice(0, 10));
function mondayForCivil(value) {
  const date = new Date(value + 'T12:00:00Z');
  date.setUTCDate(date.getUTCDate() - (date.getUTCDay() + 6) % 7);
  return date;
}

function esc(value) { return String(value ?? '').replace(/[&<>"']/g, char => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[char])); }
function badge(state) { return `<span class="badge ${esc(state)}">${esc(states[state] || state)}</span>`; }
function network(platform) { return `<span class="network"><span class="network-icon">${icons[platform] || '·'}</span>${esc(names[platform] || platform)}</span>`; }
function mediaURL(path) { return `/media?project=${encodeURIComponent(data.project_id)}&path=${encodeURIComponent(path)}`; }
function deliveries() { return (data?.queue?.posts || []).flatMap(post => post.deliveries.map(delivery => ({post, delivery}))); }
function dateLabel(value, options = {}) {
  if (!value) return 'Date à définir';
  try { return new Intl.DateTimeFormat('fr-FR', {timeZone: data.queue.timezone, day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', ...options}).format(new Date(value)); }
  catch { return 'Date ou fuseau invalide'; }
}
function notice(message, error = false) { const node = $('#notice'); node.textContent = message; node.classList.toggle('error', error); node.hidden = !message; }
async function request(path, body, raw = false) {
  const options = body === undefined ? {} : {method: 'POST', headers: {'X-Requested-With': 'SocialPublisher', ...(!raw && {'Content-Type': 'application/json'})}, body: raw ? body : JSON.stringify(body)};
  const response = await fetch(path, options);
  let result;
  try { result = await response.json(); } catch { throw new Error('Réponse illisible. Rechargez la page avant de réessayer.'); }
  if (!response.ok) {
    const detail = (result.issues || []).map(issue => `${issue.location} : ${issue.message}`).join('\n');
    throw new Error([result.error || `Erreur ${response.status}`, detail].filter(Boolean).join('\n'));
  }
  return result;
}
async function load(project) {
  const generation = ++loadGeneration;
  $('#refresh').disabled = true;
  try { const result = await request('/api/state' + (project ? `?project=${encodeURIComponent(project)}` : '')); if (generation === loadGeneration) { notice(''); applyState(result, true); } }
  catch (error) { notice(error.message, true); if (!data) $('#content').innerHTML = '<div class="empty"><strong>Espace indisponible</strong>Vérifiez le registre de cette instance, puis rechargez.</div>'; }
  finally { if (generation === loadGeneration) $('#refresh').disabled = false; }
}
function applyState(result, force = false) {
  if (!force && data && result.project_id !== data.project_id) return;
  if (data?.project_id !== result.project_id && result.queue) {
    try { weekStart = mondayForCivil(dayKey(new Date(), result.queue.timezone)); } catch { /* The validation screen reports an invalid queue timezone. */ }
  }
  data = result;
  $('#project-select').innerHTML = data.projects.map(project => `<option value="${esc(project.id)}">${esc(project.brand)}</option>`).join('');
  $('#project-select').value = data.project_id || '';
  render();
}
function render() {
  if (!data) return;
  $('#page-title').textContent = viewTitles[view][0]; $('#page-description').textContent = viewTitles[view][1];
  $('#new-post').hidden = !['posts', 'planning'].includes(view); $('#new-post').disabled = !data.project_id;
  $('#nav-count').textContent = String(data.queue?.posts?.length || 0);
  $$('.nav-item').forEach(button => button.classList.toggle('active', button.dataset.view === view));
  $('#footer-source').textContent = `File locale${data.queue ? ' · ' + data.queue.timezone : ''} · aucun envoi depuis cette interface`;
  const renderer = {posts: renderPosts, planning: renderPlanning, accounts: renderAccounts, projects: renderProjects, validation: renderValidation};
  $('#content').innerHTML = renderer[view]();
  if (view === 'posts') { $('#search').value = search; }
}
function renderStats() {
  const all = deliveries();
  const values = [all.filter(item => item.delivery.state === 'draft').length, all.filter(item => item.delivery.state === 'approved').length, all.filter(item => ['scheduled', 'processing', 'publishing', 'awaiting_creator'].includes(item.delivery.state)).length, all.filter(item => ['failed', 'retry'].includes(item.delivery.state)).length];
  return `<section class="stats" aria-label="Diffusions de la file locale">${['À préparer', 'Approuvées localement', 'Avec une exécution', 'À revoir'].map((label, index) => `<div class="stat"><div class="stat-label"><span class="stat-dot"></span>${label}</div><div class="stat-value">${values[index]}<span class="stat-sub">diffusion${values[index] > 1 ? 's' : ''}</span></div></div>`).join('')}</section>`;
}
function row(post, delivery) {
  const key = `${post.id}:${delivery.id}`;
  const media = post.media[0];
  const thumbnail = media?.kind === 'image' ? `<img class="thumb" src="${mediaURL(media.path)}" alt="">` : '<div class="thumb thumb-fallback">s</div>';
  const button = (action, label, disabled = false, danger = false) => `<button class="row-action ${danger ? 'danger' : ''}" data-command="${action}" data-post="${esc(post.id)}" data-delivery="${esc(delivery.id)}" ${disabled || busy.has(`${action}:${key}`) ? 'disabled' : ''}>${busy.has(`${action}:${key}`) ? 'En cours…' : label}</button>`;
  return `<article class="post-row">${thumbnail}<div class="post-info"><button class="post-title" data-command="edit" data-post="${esc(post.id)}" data-delivery="${esc(delivery.id)}">${esc(post.title || post.id)}</button><p class="post-excerpt">${esc(delivery.caption)}</p><div class="post-meta">${network(delivery.platform)}<span>·</span><span>${dateLabel(delivery.publish_at)}</span></div></div><div class="post-status">${badge(delivery.state)}<div class="row-actions">${button('edit', 'Ouvrir')}${button('approve', 'Approuver', !['draft', 'approved'].includes(delivery.state))}${button('status', 'Statut cloud', !data.capabilities.remote_read || !delivery.receipt?.native_reference?.startsWith('api:'))}${button('cancel', 'Annuler', delivery.state === 'published' || delivery.state === 'cancelled' || (!!delivery.receipt && !data.capabilities.remote_cancel), true)}</div></div></article>`;
}
function renderPosts() {
  const all = deliveries();
  const selected = all.filter(({post, delivery}) => (filter === 'all' || delivery.state === filter) && `${post.title} ${delivery.caption}`.toLowerCase().includes(search.toLowerCase()));
  const accounts = data.accounts.filter(account => account.project_id === data.project_id);
  return `${renderStats()}<div class="work-grid"><section class="panel"><div class="panel-heading"><div><h3>Votre carnet de publications</h3><p>${data.queue ? esc(data.queue.brand) : 'Choisissez ou créez un projet'} · ${all.length} diffusion${all.length > 1 ? 's' : ''}</p></div><span class="subtle-label">SOURCE LOCALE</span></div><div class="filters">${[['all', 'Toutes'], ['draft', 'Brouillons'], ['approved', 'Approuvées'], ['scheduled', 'Programmées'], ['cancelled', 'Annulées']].map(([id, label]) => `<button class="filter ${filter === id ? 'active' : ''}" data-filter="${id}">${label}</button>`).join('')}<input id="search" class="search" aria-label="Rechercher une publication" placeholder="Rechercher…"></div><div id="post-list">${selected.length ? selected.map(({post, delivery}) => row(post, delivery)).join('') : '<div class="empty"><strong>De la place pour votre prochaine idée.</strong>Aucune diffusion pour cette sélection.<br>Créez un brouillon pour commencer.</div>'}</div></section><aside class="sidebar-panels"><section class="panel context-panel"><div class="context-title">Vos comptes<span class="subtle-label">REGISTRE</span></div>${accounts.length ? accounts.slice(0, 4).map(account => `<div class="account-mini"><span class="network-icon">${icons[account.platform]}</span><div><strong>${esc(account.expected_identity)}</strong><p>${esc(accountStates[account.connection_state] || account.connection_state)}</p></div></div>`).join('') : '<p class="context-hint">Aucun alias pour ce projet.</p>'}<p class="context-hint">Ces états proviennent du registre local. Ils ne confirment pas une connexion actuelle au réseau.</p><button class="text-button" data-view="accounts">Gérer les alias →</button></section><section class="panel workflow"><span class="large-mark">sp.</span><h3>Prendre le temps de bien faire.</h3><p>Préparez votre contenu, vérifiez chaque diffusion, puis approuvez le texte exact. Le tableau de bord ne soumet aucun média et ne publie rien.</p><button class="text-button" data-view="validation">Vérifier la file →</button></section></aside></div>`;
}
function renderAccounts() {
  const accounts = data.accounts.filter(account => account.project_id === data.project_id);
  return `<div class="toolbar"><button class="button primary" data-open="account-dialog" ${!data.project_id ? 'disabled' : ''}>＋ Nouvel alias local</button><button id="cloud-accounts" class="button secondary" ${!data.capabilities.remote_read ? 'disabled' : ''}>Lire les comptes cloud</button><span class="subtle-label">${data.capabilities.remote_read ? 'Lecture cloud activée pour cette session' : 'Lecture cloud désactivée'}</span></div><section class="panel"><div class="panel-heading"><div><h3>Les identités de votre projet</h3><p>Créer un alias ne connecte pas le compte social.</p></div></div>${accounts.length ? `<table class="account-table"><thead><tr><th>Compte attendu</th><th>Réseau</th><th>État local</th><th>Contrat</th></tr></thead><tbody>${accounts.map(account => `<tr><td>${esc(account.expected_identity)}<small>${esc(account.id)}</small></td><td>${network(account.platform)}</td><td>${esc(accountStates[account.connection_state] || account.connection_state)}<small>Source : registre local</small></td><td>${account.publication_mode ? esc(account.publication_mode) : 'Organique'}</td></tr>`).join('')}</tbody></table>` : '<div class="empty"><strong>Aucun alias enregistré</strong>Ajoutez l’identité attendue sans lancer de connexion.</div>'}</section><div id="cloud-accounts-result"></div>`;
}
function renderProjects() {
  return `<div class="toolbar"><button class="button primary" data-open="project-dialog">＋ Nouveau projet local</button></div><div class="project-list">${data.projects.map(project => `<section class="panel project-card"><div class="eyebrow">${esc(project.id)}</div><h2>${esc(project.brand)}</h2><p>Une file et des médias séparés.<br>File : ${esc(project.queue_path)}</p><button class="button secondary" data-project="${esc(project.id)}">Ouvrir ce projet →</button></section>`).join('')}</div>`;
}
function renderValidation() {
  const issues = data.issues || [];
  return `<div class="toolbar"><button id="validate-queue" class="button primary" ${!data.project_id ? 'disabled' : ''}>✓ Vérifier la file</button><span class="subtle-label">Contrat du moteur existant · aucune approbation implicite</span></div><section class="panel"><div class="panel-heading"><div><h3>Contrôles de préparation</h3><p>Médias dans le projet, identités, formats, dates et reçus.</p></div><span class="badge ${issues.some(issue => issue.level === 'error') ? 'failed' : 'approved'}">${issues.some(issue => issue.level === 'error') ? 'Erreurs à corriger' : 'Structure valide'}</span></div>${issues.length ? issues.map(issue => `<div class="issue"><code>${esc(issue.location)}</code>${esc(issue.message)}</div>`).join('') : '<div class="empty"><strong>Aucune erreur structurelle détectée.</strong>La validité de la file n’autorise ni upload ni publication.<br>Chaque légende et chaque compte restent à relire.</div>'}</section>`;
}
function dayKey(date, zone) { return new Intl.DateTimeFormat('en-CA', {timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit'}).format(date); }
function renderPlanning() {
  if (!data.queue) return '<div class="empty">Choisissez un projet.</div>';
  try { dayKey(new Date(), data.queue.timezone); } catch { return '<div class="empty">Fuseau du projet invalide. Consultez les validations avant de planifier.</div>'; }
  const planned = deliveries().filter(({delivery}) => delivery.publish_at && delivery.state !== 'cancelled');
  const days = Array.from({length: 7}, (_, index) => { const date = new Date(weekStart); date.setUTCDate(date.getUTCDate() + index); return date; });
  const daysMarkup = days.map(date => {
    const key = date.toISOString().slice(0, 10);
    const items = planned.filter(({delivery}) => dayKey(new Date(delivery.publish_at), data.queue.timezone) === key);
    return `<div class="calendar-day"><header>${new Intl.DateTimeFormat('fr-FR', {weekday: 'short', timeZone: 'UTC'}).format(date)}<strong>${date.getUTCDate().toString().padStart(2, '0')}</strong></header>${items.map(({post, delivery}) => `<button class="calendar-entry" data-command="edit" data-post="${esc(post.id)}" data-delivery="${esc(delivery.id)}"><span>${dateLabel(delivery.publish_at, {day: undefined, month: undefined})}</span><strong>${esc(post.title || post.id)}</strong>${esc(names[delivery.platform])}<span>${esc(states[delivery.state])}</span></button>`).join('')}</div>`;
  }).join('');
  return `<div class="calendar-toolbar"><div><button class="icon-button" data-week="-1" aria-label="Semaine précédente">‹</button><strong>${new Intl.DateTimeFormat('fr-FR', {month: 'long', year: 'numeric', timeZone: 'UTC'}).format(weekStart)}</strong><button class="icon-button" data-week="1" aria-label="Semaine suivante">›</button><button class="text-button" id="today">Aujourd’hui</button><input id="planning-date" type="date" aria-label="Aller à une date du planning" value="${weekStart.toISOString().slice(0, 10)}"></div><span class="subtle-label">Heures en ${esc(data.queue.timezone)} · brouillons datés ≠ programmation distante</span></div><section class="panel"><div class="calendar">${daysMarkup}</div><div class="schedule-list">${planned.length} diffusion${planned.length > 1 ? 's' : ''} datée${planned.length > 1 ? 's' : ''} dans la file · ${deliveries().filter(({delivery}) => !delivery.publish_at).length} sans date.</div></section>`;
}
function selected(postId, deliveryId) { const post = data.queue.posts.find(item => item.id === postId); return {post, delivery: post.deliveries.find(item => item.id === deliveryId)}; }
function renderMediaFields() {
  $('#media-fields').innerHTML = editPost.media.map((item, index) => `<div class="media-entry"><input aria-label="Chemin du média ${index + 1}" data-media-path="${index}" value="${esc(item.path)}" placeholder="media/image.jpg" required><select aria-label="Type du média ${index + 1}" data-media-kind="${index}">${[['image', 'Image'], ['video', 'Vidéo'], ['document', 'PDF']].map(([value, label]) => `<option value="${value}" ${item.kind === value ? 'selected' : ''}>${label}</option>`).join('')}</select><button type="button" data-remove-media="${index}" aria-label="Retirer le média ${index + 1}">×</button></div>`).join('');
}
function accountOptions() {
  const platform = $('#post-platform').value;
  const delivery = editPost.deliveries[editIndex];
  const options = data.accounts.filter(account => account.project_id === data.project_id && account.platform === platform && account.connection_kind !== 'advertising');
  $('#post-account').innerHTML = options.length ? options.map(account => `<option value="${esc(account.id)}">${esc(account.expected_identity)} · ${esc(account.id)}</option>`).join('') : '<option value="">Aucun alias pour ce réseau</option>';
  if (options.some(account => account.id === delivery.account_ref)) $('#post-account').value = delivery.account_ref;
}
function localDate(value, zone) {
  if (!value) return '';
  const parts = new Intl.DateTimeFormat('sv-SE', {timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23'}).format(new Date(value));
  return parts.replace(' ', 'T');
}
function fillDelivery() {
  const delivery = editPost.deliveries[editIndex];
  $('#post-platform').value = delivery.platform; accountOptions(); $('#post-caption').value = delivery.caption || ''; $('#post-alt').value = delivery.alt_text || '';
  $('#post-timezone').value = data.queue.timezone; $('#post-local-time').value = localDate(delivery.publish_at, data.queue.timezone); $('#post-fold').value = '';
  $('#resolved-time').textContent = delivery.publish_at ? `Instant enregistré : ${delivery.publish_at}. Choisir une occurrence si l’heure se répète.` : 'Sans date : le contenu reste un brouillon non planifié.';
  preview();
}
function syncDelivery() {
  const delivery = editPost.deliveries[editIndex];
  delivery.platform = $('#post-platform').value; delivery.account_ref = $('#post-account').value; delivery.caption = $('#post-caption').value; delivery.alt_text = $('#post-alt').value;
  $$('.media-entry').forEach((entry, index) => { editPost.media[index] = {path: $('[data-media-path]', entry).value, kind: $('[data-media-kind]', entry).value}; });
}
async function resolveCurrentTime() {
  const local = $('#post-local-time').value;
  if (!local) return null;
  const foldValue = $('#post-fold').value;
  const result = await request('/api/resolve-time', {local, timezone: $('#post-timezone').value, fold: foldValue === '' ? null : Number(foldValue)});
  $('#resolved-time').textContent = `Instant précis : ${result.publish_at}`;
  return result.publish_at;
}
function preview() {
  const caption = $('#post-caption').value;
  $('#preview-caption').textContent = caption || 'Votre légende apparaîtra ici.'; $('#caption-count').textContent = `${caption.length} caractère${caption.length > 1 ? 's' : ''}`;
  $('#preview-account').textContent = $('#post-account').selectedOptions[0]?.textContent?.split(' · ')[0] || 'Votre compte'; $('#preview-platform').textContent = names[$('#post-platform').value];
  const path = $('[data-media-path="0"]')?.value;
  const kind = $('[data-media-kind="0"]')?.value;
  $('#preview-media').innerHTML = path && kind === 'image' ? `<img src="${mediaURL(path)}" alt="Aperçu du premier média">` : path && kind === 'video' ? `<video src="${mediaURL(path)}" controls preload="metadata"></video>` : '<span>Média non prévisualisable</span>';
}
function openEditor(postId, deliveryId) {
  const post = data.queue.posts.find(item => item.id === postId);
  editPost = post ? structuredClone(post) : {id: 'post-' + crypto.randomUUID(), title: '', media: [{path: '', kind: 'image'}], deliveries: [{id: 'instagram', platform: 'instagram', account_ref: '', caption: '', publish_at: null, state: 'draft', receipt: null}]};
  editIndex = post ? Math.max(0, editPost.deliveries.findIndex(item => item.id === deliveryId)) : 0;
  const locked = editPost.deliveries.some(delivery => !editStates.has(delivery.state) || delivery.receipt);
  editLocked = locked;
  $('#editor-title').textContent = post ? 'Détails de la publication' : 'Nouvelle publication'; $('#post-title').value = editPost.title;
  $('#delivery-select').innerHTML = editPost.deliveries.map((item, index) => `<option value="${index}">${esc(names[item.platform])} · ${esc(item.id)}</option>`).join(''); $('#delivery-select').value = String(editIndex);
  $('#editor-error').hidden = true; $('#save-post').disabled = locked; $('#editor-state').textContent = locked ? 'Reçu existant : consultation seule' : 'Enregistrement local uniquement';
  $$('#post-form input, #post-form textarea, #post-platform, #post-account, #post-fold, #add-media').forEach(control => control.disabled = locked);
  renderMediaFields(); fillDelivery();
  if (locked) $$('#media-fields input, #media-fields select, #media-fields button').forEach(control => control.disabled = true);
  $('#editor').showModal();
}
async function action(button) {
  const {command, post: postId, delivery: deliveryId} = button.dataset;
  if (command === 'edit') return openEditor(postId, deliveryId);
  const {post, delivery} = selected(postId, deliveryId);
  const key = `${command}:${postId}:${deliveryId}`;
  if (busy.has(key)) return;
  if (command === 'status') {
    busy.add(key); render();
    try { const result = await request('/api/status', {project: data.project_id, post_id: postId, delivery_id: deliveryId}); notice(`Cloud : ${states[result.state]}. Observation ${dateLabel(result.observed_at)}.${result.has_error ? ' Le service signale une erreur ; aucune relance effectuée.' : ''}`); }
    catch (error) { notice(error.message, true); }
    finally { busy.delete(key); render(); }
    return;
  }
  $('#confirmation-title').textContent = command === 'approve' ? 'Approuver cette diffusion locale' : 'Annuler cette diffusion';
  $('#confirmation-content').className = 'confirmation-content';
  $('#confirmation-content').innerHTML = `<div class="facts"><strong>${esc(post.title || post.id)}</strong><br>${esc(names[delivery.platform])} · ${esc(delivery.account_ref)}<br>${esc(delivery.publish_at || 'Aucune date')}<br>${esc(data.queue.timezone)}<br>${post.media.map(item => esc(item.path)).join('<br>')}</div><p>${esc(delivery.caption)}</p><p>${command === 'approve' ? 'Cette approbation est locale. Aucun upload ni envoi ne sera effectué.' : delivery.receipt ? 'L’annulation du planificateur ne supprime pas un objet déjà créé chez le fournisseur.' : 'Le brouillon sera conservé avec l’état annulé.'}</p>`;
  $('#approval-check-label').lastChild.textContent = command === 'approve' ? 'J’approuve ce texte exact, les médias, le compte et l’heure affichés.' : 'Je confirme l’annulation de cette diffusion exacte.';
  $('#approval-check').checked = false; $('#confirm-action').disabled = true; $('#confirm-action').textContent = command === 'approve' ? 'Approuver localement' : 'Confirmer l’annulation'; $('#confirmation-error').hidden = true;
  confirmationAction = {command, postId, deliveryId, key, project: data.project_id, revision: data.revision};
  $('#confirmation').showModal();
}

document.addEventListener('click', async event => {
  const target = event.target.closest('button'); if (!target || target.disabled) return;
  if (target.dataset.view) { view = target.dataset.view; notice(''); render(); }
  if (target.dataset.close) $('#' + target.dataset.close).close();
  if (target.dataset.open) { const dialog = $('#' + target.dataset.open); $('.form-error', dialog).hidden = true; dialog.showModal(); }
  if (target.dataset.project) { view = 'posts'; await load(target.dataset.project); }
  if (target.dataset.command) await action(target);
  if (target.dataset.filter) { filter = target.dataset.filter; render(); }
  if (target.dataset.week) { weekStart.setUTCDate(weekStart.getUTCDate() + Number(target.dataset.week) * 7); render(); }
  if (target.id === 'today') { weekStart = mondayForCivil(dayKey(new Date(), data.queue.timezone)); render(); }
  if (target.dataset.removeMedia !== undefined) { syncDelivery(); editPost.media.splice(Number(target.dataset.removeMedia), 1); renderMediaFields(); preview(); }
  if (target.id === 'validate-queue') { target.disabled = true; try { const result = await request('/api/validate', {project: data.project_id}); data.issues = result.issues; render(); notice(result.valid ? 'File valide. Aucun contenu n’a été approuvé ni envoyé.' : 'La file contient des erreurs à corriger.', !result.valid); } catch (error) { notice(error.message, true); target.disabled = false; } }
  if (target.id === 'cloud-accounts') { target.disabled = true; try { const result = await request('/api/accounts'); $('#cloud-accounts-result').innerHTML = `<div class="notice">Observation cloud : ${result.accounts.map(account => `${esc(account.id)} — ${esc(account.connection_status)}`).join(' ; ') || 'aucun compte correspondant au registre'}.</div>`; } catch (error) { notice(error.message, true); } finally { target.disabled = false; } }
});
$('#refresh').addEventListener('click', () => load(data?.project_id));
$('#project-select').addEventListener('change', event => { filter = 'all'; search = ''; notice(''); load(event.target.value); });
$('#new-post').addEventListener('click', () => openEditor());
$('#content').addEventListener('input', event => { if (event.target.id === 'search') { search = event.target.value; const selection = event.target.selectionStart; render(); $('#search').focus(); $('#search').setSelectionRange(selection, selection); } });
$('#content').addEventListener('change', event => { if (event.target.id === 'planning-date' && event.target.value) { weekStart = mondayForCivil(event.target.value); render(); } });
$('#post-platform').addEventListener('change', () => { accountOptions(); preview(); });
$('#post-form').addEventListener('input', event => { if (!['post-local-time', 'post-timezone', 'post-fold'].includes(event.target.id)) preview(); });
$('#delivery-select').addEventListener('change', async event => { const previous = editIndex; try { if (!editLocked) { syncDelivery(); editPost.deliveries[previous].publish_at = await resolveCurrentTime(); } editIndex = Number(event.target.value); fillDelivery(); } catch (error) { event.target.value = String(previous); $('#editor-error').hidden = false; $('#editor-error').textContent = error.message; } });
$('#add-media').addEventListener('click', () => { syncDelivery(); editPost.media.push({path: '', kind: 'image'}); renderMediaFields(); });
$('#media-import').addEventListener('change', async event => {
  const input = event.target; input.disabled = true; $('#save-post').disabled = true;
  try { syncDelivery(); for (const file of input.files) { const result = await request(`/api/import-media?project=${encodeURIComponent(data.project_id)}&name=${encodeURIComponent(file.name)}`, file, true); editPost.media = editPost.media.filter(item => item.path); editPost.media.push({path: result.path, kind: result.kind}); } renderMediaFields(); preview(); }
  catch (error) { $('#editor-error').hidden = false; $('#editor-error').textContent = error.message; }
  finally { input.value = ''; input.disabled = false; $('#save-post').disabled = false; }
});
$('#post-form').addEventListener('submit', async event => {
  event.preventDefault(); const button = $('#save-post'); if (button.disabled) return; button.disabled = true; $('#editor-error').hidden = true;
  try { syncDelivery(); editPost.title = $('#post-title').value; editPost.deliveries[editIndex].publish_at = await resolveCurrentTime(); const result = await request('/api/save', {project: data.project_id, revision: data.revision, post: editPost}); applyState(result); $('#editor').close(); notice('Brouillon enregistré. Les approbations précédentes de cette publication ont été retirées.'); }
  catch (error) { $('#editor-error').hidden = false; $('#editor-error').textContent = error.message; }
  finally { button.disabled = false; }
});
$('#approval-check').addEventListener('change', event => $('#confirm-action').disabled = !event.target.checked);
$('#confirm-action').addEventListener('click', async () => {
  const button = $('#confirm-action'), item = confirmationAction;
  if (button.disabled || busy.has(item.key)) return;
  busy.add(item.key); button.disabled = true; $('#confirmation-error').hidden = true;
  try { const result = await request('/api/' + item.command, {project: item.project, revision: item.revision, post_id: item.postId, delivery_id: item.deliveryId, confirmed: $('#approval-check').checked}); applyState(result); $('#confirmation').close(); notice(item.command === 'approve' ? 'Approbation locale enregistrée. Aucun envoi effectué.' : 'Annulation confirmée pour cette diffusion.'); }
  catch (error) { $('#confirmation-error').hidden = false; $('#confirmation-error').textContent = error.message; }
  finally { busy.delete(item.key); button.disabled = !$('#approval-check').checked; render(); }
});
for (const [formId, endpoint, dialogId] of [['project-form', '/api/projects', 'project-dialog'], ['account-form', '/api/accounts', 'account-dialog']]) {
  $('#' + formId).addEventListener('submit', async event => { event.preventDefault(); const form = event.target, button = $('button', form); if (button.disabled) return; button.disabled = true; $('.form-error', form).hidden = true;
    try { const body = Object.fromEntries(new FormData(form)); if (formId === 'account-form') body.project = data.project_id; const result = await request(endpoint, body); applyState(result, true); $('#' + dialogId).close(); notice(formId === 'project-form' ? 'Projet local créé.' : 'Alias local créé. Aucun compte social connecté.'); form.reset(); }
    catch (error) { $('.form-error', form).hidden = false; $('.form-error', form).textContent = error.message; }
    finally { button.disabled = false; }
  });
}
load();
