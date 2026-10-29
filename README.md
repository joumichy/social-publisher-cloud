# Social Publisher — gestion graphique macOS + moteur Cloudflare

Cette révision du 29 octobre 2026 inclut le **tableau de bord graphique**, son serveur local, la CLI d’installation, le moteur existant et les documents de reprise. La cible est **macOS avec moteur Cloudflare**. Windows a servi uniquement à préparer et tester le paquet ; le Mac n’a pas été accédé ni testé. Lire [document.md](document.md) avant toute opération.

Installation complète dans un dossier neuf :

```sh
python3 social_publisher_setup.py install --prefix "$HOME/Projects/social-publisher-cloud"
python3 social_publisher_setup.py doctor --prefix "$HOME/Projects/social-publisher-cloud"
"$HOME/Projects/social-publisher-cloud/bin/social-publisher" dashboard
```

Ouvrir `http://127.0.0.1:8788`, puis arrêter avec Ctrl+C. L’installation crée les dossiers, le dashboard, le profil isolé, les lanceurs, les documents et les dépendances du moteur via `npm ci`. Aucun Worker ni service permanent n’est déployé. Le dashboard prépare et valide les publications ; il ne soumet ni média ni publication distante. Les lectures et annulations cloud sont désactivées par défaut.

Guides : [dashboard et limites](DASHBOARD.md), [installation](INSTALLATION.md), [architecture](ARCHITECTURE.md), [duplicata Cloudflare](CLOUDFLARE.md), [adresse sans achat de domaine](DOMAINE-GRATUIT.md), [retour arrière](ROLLBACK.md). Les résultats du dashboard sont dans `validation/dashboard-results.json`. La suite Python historique conserve un échec de fixture PNG, sans modification de l’existant.

Vérification depuis le dossier extrait : `python3 tools/verify_package.py .` puis `python3 tools/acceptance_offline.py .`. Les tests existants et les limites sont consignés dans `validation/results.json`.

La configuration Cloudflare est neutralisée, la démo est un brouillon non connecté. Les anciens README et skills sont conservés comme sources historiques ; les divergences et restrictions de reprise sont précisées dans `document.md`.
