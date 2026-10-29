# Tableau de bord graphique — macOS + Cloudflare

L’outil de gestion graphique est inclus. L’interface est servie localement sur le Mac par un processus Python temporaire et réutilise le moteur de files existant. Cloudflare reste le moteur d’exécution distant. Windows sert uniquement à la préparation et aux tests ; le Mac n’a pas été contacté ni qualifié.

## Installer et ouvrir sur un Mac autorisé

```sh
python3 social_publisher_setup.py install --prefix "$HOME/Projects/social-publisher"
python3 social_publisher_setup.py dashboard --prefix "$HOME/Projects/social-publisher"
```

Ouvrir l’adresse affichée, par défaut `http://127.0.0.1:8788`. `--port 8790` permet de choisir un autre port. Arrêter avec **Ctrl+C**. Aucun service permanent, LaunchAgent, Cron Mac ou navigateur automatique n’est créé. Le serveur écoute uniquement sur `127.0.0.1` et refuse les écritures d’une autre origine. Ne pas ouvrir le port sur le réseau.

Après installation, le paquet d’origine n’est plus nécessaire pour ouvrir l’interface : `"$HOME/Projects/social-publisher/bin/social-publisher" dashboard` lance le dashboard de cette instance. Le lanceur moteur portable historique sous `mac/bin/` reste une source de référence ; privilégier le lanceur généré par l’installateur.

Le dashboard utilise HTML/CSS/JavaScript et la bibliothèque standard Python ; aucune nouvelle dépendance npm d’exploitation. Python doit disposer de la base de fuseaux IANA. Les dépendances du Worker restent celles du lockfile. Python Playwright est une dépendance facultative de qualification, utilisée par `tools/qa_dashboard.py`, pas par le dashboard.

Une installation avec `--skip-deps` permet de qualifier le dashboard hors ligne, sans qualifier les dépendances Cloudflare. L’accès au Mac reste soumis à une autorisation distincte, absente dans la session de préparation.

## Parcours disponibles

| Écran | Fonctions opérationnelles |
|---|---|
| Projets | Sélection ; nouveau dossier et file vide dans l’instance ; refus d’écraser un dossier existant |
| Comptes | Alias et identités attendues ; états attribués au registre local ; création d’un alias non connecté, sans OAuth |
| Publications | Création/édition de brouillons ; légende, accessibilité, médias ordonnés et date par diffusion ; aperçu local |
| Médias | Chemins relatifs contrôlés dans le projet ; import local de fichiers dans `dashboard-media/` ; aucune soumission distante |
| Planning | Vue hebdomadaire, navigation et accès à une date ; affichage dans le fuseau du projet ; ouverture des diffusions |
| Validations | Réemploi du moteur existant pour identités, chemins, formats, dates et reçus ; aucune approbation implicite |
| Approbation | Présentation du contenu exact, fichiers, compte et heure ; confirmation dédiée ; approbation locale uniquement |
| Annulation | Brouillon conservé avec état annulé ; reçus distants protégés ; aucun doublon lors de clics répétés |

Le dashboard ne comporte **aucune route de soumission ou de publication**. Il ne crée ni publicité, connexion de compte, déploiement ou déclenchement des tâches dues. La CLI moteur existante reste livrée pour une future exploitation explicitement autorisée. Un brouillon daté dans le planning ne devient pas un envoi programmé chez Cloudflare.

Les publications possédant un reçu d’exécution restent en consultation seule. Une édition autorisée remet les diffusions de la publication en brouillon et retire leurs anciennes approbations. Les autres publications sont conservées.

## Fuseaux, clics répétés et erreurs

L’éditeur distingue heure locale, fuseau IANA et instant ISO à décalage explicite dans `publish_at`. Le serveur calcule le décalage sans se fier au fuseau Windows. Une heure inexistante au printemps est refusée. Une heure répétée à l’automne impose le choix de la première ou de la seconde occurrence. Le planning affiche ensuite les instants dans le fuseau du projet.

L’activité des boutons est suivie par diffusion. Les écritures portent une empreinte de révision : une modification concurrente produit un conflit au lieu d’écraser un état plus récent. Les JSON sont écrits avec le remplacement atomique existant. Utiliser un seul processus de gestion actif : il n’existe pas de verrou partagé avec un autre outil externe qui écrirait simultanément les fichiers.

Les erreurs de validation restent visibles dans l’éditeur ; les erreurs HTTP permettent de recharger. Les réponses cloud ne renvoient pas le corps brut du fournisseur ni un secret au frontend. Aucun retry de mutation n’est automatique. Les compteurs proviennent uniquement des diffusions effectivement présentes dans la file ; aucune métrique d’engagement ou connexion n’est inventée.

Un import crée un fichier local avant l’enregistrement du brouillon. Si l’éditeur est abandonné, ce fichier peut rester dans `dashboard-media/` ; aucune suppression automatique de média personnel n’est effectuée. Les conversions et exigences propres aux fournisseurs restent à vérifier lors d’une future soumission autorisée.

## Cloud : options futures désactivées par défaut

Le lancement normal ne demande aucun secret, ne lit pas de coffre et ne contacte aucun Worker. Le frontend ne reçoit jamais le jeton administrateur ou un jeton fournisseur.

Dans un futur périmètre autorisé, `dashboard --allow-remote-read` permet les lectures de comptes et de statut par reçu. Le serveur réutilise `social_api.api_json` en lui donnant le registre de **cette instance**, au lieu du HOME global historique. L’authentification doit être injectée dans le processus par un mécanisme sécurisé prévu par le moteur. Ne pas mettre de jeton dans l’interface, une URL, un prompt, un argument ou un fichier livré.

Les statuts contrôlent l’identifiant, le projet, le compte, la plateforme, la publication et la diffusion. Les comptes cloud sont filtrés et rapprochés du registre. L’observation distante ne transforme pas silencieusement les états locaux en succès.

`--allow-remote-cancel` exige aussi `--allow-remote-read`. Le code prévoit une confirmation exacte, une lecture du reçu puis la route existante `POST /v1/publications/<id>/cancel`, uniquement pour `scheduled` ou `retry`. Un état distant déjà annulé est rapproché localement sans nouvel appel d’annulation. Les exécutions en cours ou terminées sont refusées. Ces options n’ont pas été activées contre un service réel pendant la livraison.

Une annulation du planificateur ne supprime pas un post, ne désactive pas une campagne créée et ne garantit pas l’arrêt d’une requête déjà partie. Un résultat incertain impose une nouvelle lecture avant décision. Les tests de ce contrat utilisent des transports simulés, pas les fournisseurs.

## Preuves et limites

Voir `validation/dashboard-results.json` et les captures de qualification sur **données factices identifiées**. Le navigateur est un profil neuf indépendant de toute session existante. Les tests couvrent création, édition, doubles clics, approbation, annulation, erreurs, conflits, import, comptes/projets, HTTP et changements d’heure.

Non exécutés : installation et rendu macOS, OAuth, lecture ou annulation cloud réelle, publication, publicité, déploiement et Cron. Aucun accès persistant n’a été créé. Héberger cette interface sur Internet demanderait une authentification et un périmètre distincts.
