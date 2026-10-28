# Export Social Publisher — 28 octobre 2026

Lire [document.md](document.md) avant toute opération. Ce paquet contient l'existant Windows et des prompts de reprise cloud/Mac. Le Mac n'a pas été accédé ni testé. Aucun déploiement, compte connecté ou contenu de production n'est transféré.

Installation complète dans un dossier neuf :

```sh
python3 social_publisher_setup.py install --prefix "$HOME/Projects/social-publisher-cloud"
python3 social_publisher_setup.py doctor --prefix "$HOME/Projects/social-publisher-cloud"
```

Sous Windows : remplacer `python3` par `python` et fournir un chemin Windows. L'installation crée les dossiers, le profil isolé, les lanceurs, les documents et installe les dépendances via `npm ci`. Elle ne déploie aucun Worker.

Guides : [installation](INSTALLATION.md), [architecture](ARCHITECTURE.md), [duplicata Cloudflare](CLOUDFLARE.md), [adresse sans achat de domaine](DOMAINE-GRATUIT.md), [retour arrière](ROLLBACK.md). Le Cron et les comptes réels restent désactivés. Une installation Windows complète a été vérifiée. Les 59 tests TypeScript et les 6 tests de l'installateur passent ; la suite Python historique conserve un échec de fixture PNG (8/9 passent), documenté dans les preuves.

Vérification depuis le dossier extrait : `python3 tools/verify_package.py .` puis `python3 tools/acceptance_offline.py .`. Les tests existants et les limites sont consignés dans `validation/results.json`.

La configuration Cloudflare est neutralisée, la démo est un brouillon non connecté. Les anciens README et skills sont conservés comme sources historiques ; les divergences et restrictions de reprise sont précisées dans `document.md`.
