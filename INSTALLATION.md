# Installation par CLI

**Cible : macOS avec moteur Cloudflare.** Windows sert uniquement à préparer et tester le paquet. Le tableau de bord graphique est inclus ; son guide est [DASHBOARD.md](DASHBOARD.md).

Prérequis : Python 3.10+ (qualifié ici avec 3.13.2 Windows), Node/npm compatibles avec le lockfile, base de fuseaux IANA et outils médias selon les formats utilisés. Mac non testé. Aucun service permanent n'est installé.

Après téléchargement/clonage du paquet complet et contrôle du manifeste :

```sh
python3 social_publisher_setup.py install --prefix "$HOME/Projects/social-publisher-cloud"
python3 social_publisher_setup.py doctor --prefix "$HOME/Projects/social-publisher-cloud"
python3 social_publisher_setup.py dashboard --prefix "$HOME/Projects/social-publisher-cloud"
"$HOME/Projects/social-publisher-cloud/bin/social-publisher" validate demo
"$HOME/Projects/social-publisher-cloud/bin/social-publisher" plan demo
```

Sous Windows, utiliser `python` et un chemin absolu `--prefix`, puis `bin\social-publisher.cmd`. La commande crée tous les dossiers, les documents, le registre de démonstration et les lanceurs. Elle exécute `npm ci` dans le nouveau service, puis valide le brouillon. `--skip-deps` permet uniquement une installation des sources hors ligne ; ce résultat n'est pas une installation complète des dépendances.

La destination doit être inexistante. Une collision échoue sans modifier la destination. Le profil `~/.codex` réel n'est pas changé : chaque lanceur fixe HOME/USERPROFILE pour son processus enfant. L'installateur ne lit aucun coffre et ne configure aucune publication. Une installation interrompue garde un reçu `incomplete` pour diagnostic ; ne la relancer pas sur le même dossier sans revue.

`dashboard` lance l’interface sur `http://127.0.0.1:8788`. Ouvrir cette adresse dans le navigateur du Mac autorisé, puis arrêter avec Ctrl+C. `--port 8790` choisit un autre port. Le serveur n’est pas persistant, les fonctions cloud sont désactivées par défaut et aucun secret n’est saisi dans l’interface. Les fichiers sont installés sous `dashboard/`.

Le Mac demeure interdit dans la session d'export : ces commandes y sont une procédure future après autorisation. Le test Windows du CLI se fait dans le workspace, avec un chemin comportant des espaces. Les résultats et limites sont dans `validation/results.json`.

Pour préparer le duplicata Cloudflare, lire [CLOUDFLARE.md](CLOUDFLARE.md). Aucune commande d'installation locale ne déploie le Worker.
