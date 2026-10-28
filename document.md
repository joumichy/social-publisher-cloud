# Social Publisher — export de reprise cloud et Mac

Demande de John Allou du 28 octobre 2026. Export préparé sur Windows, à partir des fichiers réellement accessibles. Les dates et empreintes précises sont dans `inventory/source-inventory.json`.

Extension de la demande dans cette session : fournir une CLI d'installation complète des dossiers et documents, préparer un duplicata du Worker Cloudflare et mettre le paquet sur un dépôt GitHub public. `social_publisher_setup.py` et les guides `INSTALLATION.md`, `ARCHITECTURE.md`, `CLOUDFLARE.md`, `ROLLBACK.md` répondent à cette extension. Le statut de publication GitHub est consigné séparément après confirmation ; aucun Worker n'est prétendu déployé par la préparation du paquet.

Le complément sur une adresse sans achat est traité dans `DOMAINE-GRATUIT.md` et par `cloud-config --workers-subdomain`. Les callbacks, HTTPS, propriété de médias TikTok et absence de récepteur webhook ont été rapprochés du code ; les limites de la consultation officielle et les contrôles non effectués y sont explicites. Aucun achat, DNS ou nouvel accès ne découle de ce complément.

## Statut de livraison

Le véritable service a été retrouvé dans `C:/stellark/social-publisher`, avec son skill dans `C:/Users/User/.codex/skills/social-publisher`. Ce paquet contient le moteur existant, ses tests, ses migrations, ses deux icônes, le gestionnaire de files indispensable et des prompts de reprise nouvellement rédigés. Il constitue un instantané de travail identifié par SHA-256 : aucun commit Git n'a été établi, le dossier du service ne comportant pas de `.git`.

L'architecture est déjà cloud : Worker Cloudflare, D1 et R2. Le Mac sert de poste de préparation et de soumission ; il n'héberge pas le planificateur. Une version « agent cloud » peut utiliser les mêmes scripts Python et des fichiers de projet accessibles à son propre exécuteur. Aucun nouveau service permanent ni infrastructure supplémentaire n'est nécessaire au seul transfert du paquet.

**Ce paquet ne constitue ni une migration de l'état de production, ni une installation Mac qualifiée.** Le Mac n'a pas été contacté et demeure non autorisé dans la session d'origine. La session Discord exclue n'a été ni lue, ni pilotée. Aucun navigateur, coffre de secrets, API de production ou compte social n'a été ouvert. Aucune publication, reconnexion, programmation ou dépense n'a été effectuée.

## Cartographie et responsabilités

| Composant | Emplacement du paquet | Rôle et persistance |
|---|---|---|
| Worker TypeScript | `cloud/social-publisher/src` | API, OAuth, adaptateurs, orchestration et tâches planifiées |
| Schéma D1 | `cloud/social-publisher/migrations` | Comptes chiffrés, cibles, publications, tentatives et publicités ; aucune donnée exportée |
| Stockage R2 | configuration du Worker | Médias téléversés et rétention ; aucun objet exporté |
| CLI Python | `cloud/social-publisher/scripts` | Dispatcher et pont API ; lit le registre local et les files propres à chaque marque |
| Skill + gestionnaire de file | `mac/skill/social-publisher` | Validation, dates, approbations et reçus ; requis aussi par l'agent cloud qui utilise la CLI |
| Lanceur Mac portable | `mac/bin/social-publisher` | Nouveau lanceur pointant explicitement vers le service choisi |
| Installateur multiplateforme | `social_publisher_setup.py` | Création d'une instance isolée, dépendances npm, diagnostic, configuration et déploiement explicite d'un Worker distinct |
| Données de démonstration | `examples/demo`, `config/registry.example.json` | Brouillon sans compte connecté, sans date, sans reçu |
| Prompts de reprise | `prompts` | Instructions nouvellement rédigées à transmettre à l'agent suivant |
| Preuves et inventaires | `inventory`, `validation` | Provenance, dépendances verrouillées, contrôles et limites |

File locale = plan éditorial canonique ; enregistrement distant = état d'exécution ; identifiant final fournisseur = reçu publié. Les médias restent dans la racine de leur projet. D1 chiffre les jetons avec AES-256-GCM ; le secret administrateur est indépendant de la clé de chiffrement. Le code attend les bindings `DB` et `MEDIA`.

Le Cron historique est à la minute. Il n'est pas une automation de conversation et ne dépend pas du Mac allumé. Il est **désactivé dans la configuration livrée**. Pour les médias, le code prévoit une limite d'upload de 100 MiB et une rétention par défaut de sept jours ; ces paramètres ne qualifient pas les limites actuelles de l'offre Cloudflare.

## Contenu, exclusions et divergences conservées

Les sources applicatives, tests, migrations, `package.json`, lockfile et contenu du skill sont copiés à l'identique. `wrangler.jsonc` seul est neutralisé : autre nom de Worker, `workers_dev: false`, Cron vide, URL loopback, UUID D1 nul, bucket de revue et suppression des identifiants publics des applications OAuth. Le registre opérationnel n'est pas exporté ; `observed-projects.public.json` garde seulement les noms des trois projets et leurs chemins relatifs de file. Les identifiants de comptes, états opérationnels et profils navigateur sont exclus du paquet public.

Sont exclus : `.env` réels, `.dev.vars` réel, clés, jetons, cookies, profils navigateur, coffres Windows/Mac, bases et exports D1/R2, files et campagnes personnelles, approbations, reçus opérationnels, caches et `node_modules`. L'icône du service est réutilisée uniquement comme média de démonstration. Aucun média marketing ni contenu personnel de marque n'est inclus. Pour reprendre des publications réelles, un export séparé et explicitement autorisé des seules files et ressources nécessaires restera indispensable.

Des identifiants **publics et non authentifiants** demeurent dans le code, les tests et les migrations historiques, notamment l'identifiant annonceur ciblé par `0009`, les alias de marque et la preuve publique de domaine TikTok dans `router.ts`. Ils sont conservés pour la fidélité du code. Ils n'autorisent aucun accès et ne vérifient pas un nouveau domaine. Les pages légales sont celles de Stellark LLC : à requalifier si l'opérateur change.

Points à lire avant toute reprise :

- Le skill historique préconise Business Organic pour TikTok, alors que le README, les migrations `0007/0008` et le code prennent aussi en charge `creator_inbox_draft`. Les métadonnées locales de Shortlistable et Sibyl indiquent ce dernier mode, des sandboxes et une approbation fournisseur en attente. Ce sont des observations locales anciennes, pas une vérification fournisseur au jour de l'export.
- `creator_inbox_draft` termine à `awaiting_creator`, jamais à `published`. Le créateur finalise dans TikTok. `direct_publish` exige ses propres autorisations et paramètres de confidentialité. Aucun basculement implicite entre les modes.
- Le contrat de file historique omet `awaiting_creator` dans sa liste narrative, mais le gestionnaire et le schéma le gèrent. Prendre les types, migrations et tests comme références techniques pour cet instantané.
- Le runbook historique contient un paragraphe Buffer. Buffer reste hors du périmètre de cette reprise. Aucun changement de déclaration de contenu généré n'est autorisé par cet export ; requalifier toute règle de plateforme et déclaration avec le propriétaire avant une future publication.
- Les posts LinkedIn PDF/documents ne disposent pas d'adaptateur API dans cette version : recours natif documenté seulement dans un futur périmètre autorisé.
- Les chemins `/Users/gideon/...` et l'URL de production dans le README d'origine sont historiques. Utiliser les chemins paramétrés et la procédure du présent document. Le README d'origine n'est pas une autorisation de déployer.
- La variable `SOCIAL_PUBLISHER_REGISTRY` est reconnue par `social_queue.py`, **pas** par `social_api.py`, qui lit toujours `~/.codex/social-publisher/registry.json`. Le dispatcher et certains tests attendent aussi le skill sous `~/.codex/skills/social-publisher`. Ne pas croire qu'un registre de démo redirige les commandes API.
- Le lanceur Windows d'origine pointe vers `C:/stellark`. Il n'est pas utilisable sur Mac ; le nouveau lanceur portable s'appuie sur `SOCIAL_PUBLISHER_SERVICE_ROOT`.

## Versions et dépendances

Service `@stellark/social-publisher` **0.1.0**, modules ES. Dépendances de développement déclarées : TypeScript `^7.0.2`, Vitest `^5.0.0`, Wrangler `^4.129.1`, types Workers `^5.20260907.1`. Les versions transitives, contraintes `engines` et versions exactes sont dans `inventory/dependencies.json` et le lockfile conservé. Le Worker utilise `compatibility_date: 2026-09-01`, Meta Graph `v26.0`, LinkedIn `202608`. Ce sont les valeurs de l'existant, pas une recommandation de versions actuelles.

Runtimes Windows observés : Node sélectionné `22.23.4`, Python `3.13.2`, FFmpeg `9.0.2`. Le PATH général expose Node `22.13.1` et npm `10.9.2`. Le répertoire Node sélectionné contient seulement `node.exe` : la route npm de `run_project.py` est absente. Les premiers contrôles utilisent directement ce Node et une copie isolée des dépendances présentes. L'installation complète par la nouvelle CLI a ensuite été exécutée dans un autre dossier du workspace, avec un téléchargement npm autorisé : 74 paquets installés, registre de démo validé, reçu `installed`. Consulter `validation/results.json` pour les résultats et limites.

La CLI Python utilise la bibliothèque standard ; Python 3.10 au minimum est nécessaire pour la syntaxe et les méthodes utilisées, mais la seule version qualifiée ici est 3.13.2 Windows. Une base IANA `zoneinfo` doit être disponible (paquet `tzdata` si le système n'en fournit pas). `ffprobe` sert à l'inspection des médias ; PNG Instagram nécessite `sips` ou FFmpeg ; PNG TikTok nécessite `cwebp` ou FFmpeg avec WebP. L'environnement Mac devra être qualifié séparément, architecture Apple Silicon ou Intel comprise. Aucun binaire Windows n'est livré.

## Reprise par l'agent cloud, maintenant

1. Télécharger le ZIP depuis la Library avec les outils et helpers officiels de **l'exécuteur destinataire**, puis le matérialiser dans son propre workspace. Un chemin Windows n'est pas un chemin cloud. Ne pas fournir le ZIP à un site public et ne pas créer d'accès partagé.
2. Vérifier le SHA-256 du ZIP reçu avec le fichier `.sha256` remis séparément. Extraire dans un dossier neuf, en refusant les chemins absolus, `..`, liens et entrées dupliquées. Exécuter `python3 tools/verify_package.py .` depuis la racine extraite ; ou `python3 tools/verify_package.py export.zip --zip` avant extraction. Le manifeste couvre chaque fichier sauf le manifeste lui-même ; le SHA externe protège l'archive complète.
3. Lire ce document, `inventory/source-inventory.json`, les instructions applicables du workspace destinataire et `prompts/01-reprise-cloud.md`. Ne pas interpréter les anciens états locaux ou la présence du code comme des permissions nouvelles.
4. Dans une **copie de qualification**, installer les dépendances avec `npm ci`, jamais dans une installation existante. Cette étape dépend d'un réseau autorisé et d'un runtime compatible avec les `engines` du lockfile. Un `npm ci` neuf via la CLI a été qualifié sur Windows ; la cible cloud/Mac devra refaire cette installation dans son propre environnement.
5. Vérifier avec `npm run check`, `npx --no-install vitest run`, puis `PYTHONDONTWRITEBYTECODE=1 python3 -m unittest discover -s test_python -p 'test_*.py'`. Le script npm `test:python` historique utilise une affectation POSIX et ne se lance pas tel quel dans PowerShell. Les tests Python du contrat de file exigent le skill dans un HOME de qualification, voir la procédure Mac.
6. Exécuter `python3 tools/acceptance_offline.py .` depuis la racine du paquet. Ce contrôle utilise un registre de démo temporaire et les sources livrées, applique les migrations dans SQLite en mémoire, puis vérifie que la démo est bloquée avant upload. Il ne lance pas de Worker et ne contacte aucun fournisseur.

La version agent cloud n'a pas d'interface SaaS autonome ni de synchronisation de fichiers fournie. **Hypothèse de reprise recommandée** : garder le même moteur et rendre les seules files/médias autorisés accessibles à l'exécuteur qui soumettra. Le choix d'un stockage partagé ou d'une interface multiutilisateur est un développement futur distinct, non réalisé ici. Un agent sans Keychain utilise plus tard une injection éphémère de `SOCIAL_PUBLISHER_ADMIN_TOKEN` par un mécanisme approuvé ; aucune valeur ne doit apparaître dans un prompt, log ou argument.

## Installation Mac, après nouvelle autorisation explicite

Le Mac n'est actuellement pas autorisé. Ne pas se connecter, utiliser SSH, Remote Control, navigateur, disque partagé ou autre route pour contourner ce refus. L'agent cloud peut préparer les fichiers et le rapport hors Mac ; l'installation décrite ci-dessous est une procédure future, non exécutée.

1. Une fois l'hôte et le périmètre expressément autorisés, choisir un dossier de service neuf, par exemple `~/Projects/social-publisher-export-review`, et copier **tout** `cloud/social-publisher`. Vérifier les versions et installer les dépendances uniquement dans ce nouveau dossier. Le chemin est un exemple, pas un emplacement constaté.
2. Avant toute copie sous `~/.codex`, inventorier uniquement les destinations concernées. S'il existe un skill, un lanceur ou un registre Social Publisher, en faire une sauvegarde privée datée et obtenir la décision de rapprochement avant de remplacer quoi que ce soit. Ne pas modifier les autres skills ou sessions.
3. Dans un profil de qualification isolé, placer `mac/skill/social-publisher` sous `<HOME_QA>/.codex/skills/social-publisher`. Placer le lanceur sous `<HOME_QA>/.codex/bin/social-publisher` et le rendre exécutable (`chmod 700`). Il attend Python 3 et `SOCIAL_PUBLISHER_SERVICE_ROOT` pointant sur le dossier du service. La qualification ne nécessite ni Keychain ni compte réel.
4. Pour la démo, générer une copie de `config/registry.example.json` en remplaçant `__SERVICE_ROOT__` par le dossier du service et `__DEMO_ROOT__` par le chemin absolu d'une copie de `examples/demo`. Ne pas laisser les placeholders dans le registre utilisé. Fournir ce registre via `SOCIAL_PUBLISHER_REGISTRY` aux seules commandes `projects`, `validate demo`, `plan demo`. `plan` doit indiquer `draft` et n'effectue aucun envoi.
5. Pour tester le dispatcher et l'API avec leurs chemins HOME fixes, utiliser un **processus enfant** lancé avec `HOME=<HOME_QA>` et le skill copié. Ne pas modifier le HOME global de l'utilisateur. Exécuter les tests Python depuis la copie du service. Conserver les brouillons, sans secret réel, sans OAuth ni upload.
6. Exécuter `tools/acceptance_offline.py`, vérifier les conversions PNG avec les outils réellement installés, puis consigner OS, architecture, versions, résultats et limites. Fermer tous les processus de qualification démarrés. N'installer aucun LaunchAgent, cron Mac ou service permanent.

Après cette qualification seulement, un futur périmètre peut prévoir l'installation utilisateur réelle. La valeur administrateur doit être saisie par un mécanisme sécurisé dans le Keychain, service `stellark-social-publisher-admin` attendu par le code, avec un compte explicitement choisi. Ne jamais lire un coffre Windows pour le copier sur Mac. Aucune commande incluant une valeur secrète dans les arguments n'est fournie.

## Configuration cloud future : choix à faire avant mutation

Deux options à décider explicitement avec le propriétaire : conserver le service existant, ou créer un environnement de test distinct. Ce paquet n'exécute aucune des deux. Les états « deployed » du registre sont des métadonnées historiques ; aucun contrôle distant ne les a actualisés.

Pour un environnement distinct, après autorisation de création et de facturation éventuelle : créer un nouveau Worker, D1 vide et bucket R2, relever leurs identifiants et modifier une copie de `wrangler.jsonc`. Choisir un nom de base distinct et ajuster aussi les scripts `db:local`/`db:remote` du manifeste si ce nom change. Ne jamais appliquer les migrations de ce paquet à une base existante sans sauvegarde, comparaison de son journal de migrations et plan approuvé. `0008` reconstruit des tables ; `0009` est une correction de données propre à un alias historique. Sur une base vide, les mises à jour spécifiques ne trouvent aucune ligne.

Configurer seulement les fournisseurs concernés, d'après `src/types.ts` et `.dev.vars.example`. Exemples de noms de secrets attendus : `ADMIN_API_TOKEN`, `TOKEN_ENCRYPTION_KEY`, `META_APP_SECRET`, `INSTAGRAM_APP_SECRET`, `LINKEDIN_CLIENT_SECRET`, `TIKTOK_CLIENT_KEY`, `TIKTOK_CLIENT_SECRET`, `TIKTOK_BUSINESS_CLIENT_ID`, `TIKTOK_BUSINESS_CLIENT_SECRET`. Ce fichier exemple contient uniquement des placeholders ou valeurs vides ; ne pas les réutiliser comme secrets. Générer deux valeurs indépendantes, dont une clé AES de 32 octets encodée en base64, hors conversation et hors historique. Utiliser le gestionnaire de secrets Cloudflare autorisé, sans fichier de production exporté.

Régler `PUBLIC_BASE_URL` en HTTPS pour un déploiement distant, les identifiants publics d'applications et les versions d'API à requalifier dans les documentations officielles au moment de la mise en place. Enregistrer les callbacks sur le domaine effectivement choisi : `/oauth/meta/callback`, `/oauth/linkedin/callback`, `/oauth/tiktok/callback/`. Revalider la propriété de média TikTok ; la preuve publique codée pour le domaine historique ne suffit pas. Vérifier les pages légales et les scopes du produit TikTok retenu. N'activer le Cron `* * * * *` qu'après qualification, inventaire des opérations dues et autorisation d'exploitation.

Pour conserver le service existant : ne pas créer un Worker concurrent ni rejouer les files. Demander uniquement les paramètres non secrets nécessaires et un accès approuvé au service cible. Faire d'abord un rapprochement en lecture seule de comptes/cibles et des reçus. Le chiffrement existant dépend de sa clé originale : en changer sans procédure de re-chiffrement rendrait les jetons illisibles. Ce paquet ne fournit aucun mécanisme de rotation ou de migration des secrets.

## Acceptation et preuve attendue

| Test | Attendu | Niveau de preuve |
|---|---|---|
| Manifeste et ZIP | Aucun fichier manquant/supplémentaire, SHA identiques, chemins sûrs | Contrôle effectué pour la livraison, voir `validation` et rapport externe |
| Filtrage secrets | Aucun chemin interdit ni signature de secret retenue ; revue des fixtures et preuve publique TikTok | Contrôle statique, pas une garantie absolue contre toute donnée opaque |
| TypeScript et Vitest | Compilation de types et suite existante passent | Windows, dépendances déjà installées et copiées |
| Python | 8 tests existants réussissent sur 9 ; un PNG miniature de fixture échoue au décodage FFmpeg | Échec conservé sans changer la fixture ; JPEG/WebP passent séparément sur le vrai PNG livré |
| Migrations | Neuf migrations applicables à une base vide, contraintes et tables attendues | SQLite en mémoire ; pas le runtime D1 de production |
| Démo | Validation valide, plan `draft`, soumission refusée avant upload | Exécution hors ligne avec fonctions réseau interdites dans le contrôle |
| Worker local | `/health` répond, routes admin refusées sans autorisation, persistance locale qualifiée | À effectuer ultérieurement sur copie, non exécuté ici |
| Mac | Installation isolée, imports, conversions et tests réussissent | Non testé, hôte non autorisé |
| Fournisseurs | OAuth correct, identité exacte, scopes et paramètres valides | Non testé, aucune connexion faite |
| Publication réelle | Reçu fournisseur et statut correct par plateforme | Hors périmètre de cet export |

Les tests simulant les fournisseurs vérifient le contrat du code ; ils ne prouvent pas que les applications disposent aujourd'hui des accès Meta, LinkedIn ou TikTok. Les états locaux du registre ne les prouvent pas non plus. `awaiting_creator`, `processing`, `submitted` et `published` restent distincts.

## Approbations et exploitation future

L'export autorise sa lecture et sa qualification hors ligne. Il n'autorise pas de nouvelles connexions ni la publication. Présenter et faire approuver la légende exacte, hashtags, mentions, médias, compte et date par plateforme avant toute approbation locale ou écriture externe. Un changement rend l'approbation caduque. Pour une publicité, approbation distincte du budget, ciblage, opérations et heure. Ne jamais transformer les brouillons de démonstration en approbations.

Ne pas rejouer une soumission après un résultat incertain : contrôler d'abord le reçu `api:<id>` et l'état fournisseur. L'idempotence inclut `approved_at` ; recréer une approbation change la clé et peut produire une nouvelle exécution. Les reçus confirmés restent la référence pour éviter les doublons.

## Retour arrière

Pour cet export, aucune production n'a changé : conserver ou supprimer seulement la nouvelle copie de qualification après vérification de son chemin et de son contenu. Ne jamais supprimer la source `C:/stellark/social-publisher`, les files de marque ou le profil utilisateur.

Pour une installation Mac future : arrêter les seuls processus lancés pour cette installation, restaurer le lanceur/skill/registre sauvegardés à leurs chemins exacts, retirer uniquement les nouveaux fichiers identifiés dans l'inventaire d'installation et restaurer les variables du processus. Les secrets Keychain nouvellement créés ne seront retirés qu'avec autorisation et identification exacte ; aucun effacement de trousseau global.

Pour un déploiement cloud futur : documenter avant déploiement la version antérieure du Worker, les bindings, le journal de migrations et une sauvegarde approuvée de D1/R2. Désactiver d'abord l'exécution automatique du nouvel environnement si un incident apparaît, puis examiner les opérations en cours. Revenir au Worker précédent ne restaure pas le schéma ou les données ; une restauration D1 est une opération distincte à approuver. Ne pas déployer cet ancien instantané sur la production actuelle pour « rollback » sans comparaison.

Une annulation locale ne retire pas un objet déjà créé chez un fournisseur. Les routes serveur `/v1/publications/<id>/cancel` et `/v1/advertisements/<id>/cancel` concernent l'état du planificateur et ne garantissent pas l'arrêt d'une opération déjà en cours ; l'annulation d'une publicité ne désactive pas des campagnes déjà matérialisées. Arrêt de dépense ou suppression de posts demandent des actions fournisseur distinctes et autorisées. Aucun rollback ne peut garantir d'effacer une publication déjà vue.

## Livrables et limites restantes

L'inventaire exact des fichiers du paquet est `manifest.json`. Les empreintes d'origine et changements de configuration sont dans `inventory/source-inventory.json`. La procédure et les prompts n'ajoutent pas de fonctionnalités métier. Les résultats réellement exécutés sont dans `validation/results.json` et les sorties de contrôle associées. Le ZIP et son empreinte externe font foi pour le transfert ; les identifiants Library confirmés sont remis séparément après sauvegarde.

Restent à faire dans un futur périmètre autorisé : qualifier le Mac et son runtime, installer les dépendances depuis le réseau sur la cible, décider du service existant ou d'un environnement distinct, fournir les seules files et ressources de marque nécessaires, configurer les secrets sans les exporter, revalider les autorisations fournisseur et tester toute exécution réelle. Aucun de ces points n'est présenté comme accompli.
