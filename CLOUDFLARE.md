# Duplicata Cloudflare

Le paquet prépare un Worker séparé du Worker historique `stellark-social-publisher`. Les données D1, objets R2 et jetons existants ne sont pas dupliqués. La configuration livrée est neutralisée et ne possède aucun Cron actif. Un nouveau Worker avec base et bucket vides doit être configuré et qualifié avant exploitation.

## Sans achat de domaine

Le CLI accepte `--workers-subdomain <SOUS_DOMAINE_DU_COMPTE>` à la place de `--public-base-url`. Il construit `https://<worker>.<sous-domaine>.workers.dev`, sans achat ni modification DNS. Il faut utiliser le sous-domaine réel du compte, pas en inventer un. Exemple : reprendre la commande `cloud-config` ci-dessous et remplacer l'option `--public-base-url` par `--workers-subdomain mon-compte`. La commande écrit uniquement la configuration locale.

L'adresse est un sous-domaine fourni par Cloudflare, pas la propriété d'un nouveau domaine indépendant. Elle ne rend pas nécessairement tout le service gratuit : quotas partagés du compte Workers, D1, R2 et éventuelles activations restent à examiner. Cloudflare destine `workers.dev` aux projets personnels/hobby non critiques et recommande un domaine ou une route propre pour la production. Voir [DOMAINE-GRATUIT.md](DOMAINE-GRATUIT.md) pour les exigences OAuth et médias, les sources officielles et les validations restantes.

Après l'installation locale et dans un périmètre de création explicitement autorisé, depuis le dossier `service` de l'instance :

```sh
npx --no-install wrangler login
npx --no-install wrangler d1 create social-publisher-cloud-db
npx --no-install wrangler r2 bucket create social-publisher-cloud-media
```

R2 peut demander une activation et une facturation : ne pas les accepter sans autorisation. Noter l'UUID de la nouvelle base. Depuis le dossier du paquet d'origine, créer la configuration de l'instance :

```sh
python3 social_publisher_setup.py cloud-config \
  --prefix "$HOME/Projects/social-publisher-cloud" \
  --worker-name social-publisher-cloud \
  --database-name social-publisher-cloud-db \
  --database-id '<UUID_NOUVELLE_BASE>' \
  --bucket-name social-publisher-cloud-media \
  --public-base-url 'https://social-publisher-cloud.<SOUS_DOMAINE>.workers.dev'
python3 social_publisher_setup.py cloud-plan --prefix "$HOME/Projects/social-publisher-cloud"
```

Les placeholders sont à remplacer ; le CLI rejette l'UUID nul, les noms historiques et l'URL historique. `cloud-config` écrit uniquement `service/wrangler.instance.jsonc`. Il échoue si ce fichier existe déjà. Il ne contacte pas Cloudflare. `cloud-plan` affiche le plan sans exécuter les commandes.

Avant déploiement, dans la nouvelle instance `service` : appliquer les migrations à la **nouvelle base vide** et configurer les secrets concernés par saisie sécurisée :

```sh
npx --no-install wrangler d1 migrations apply social-publisher-cloud-db --remote --config wrangler.instance.jsonc
npx --no-install wrangler secret put ADMIN_API_TOKEN --config wrangler.instance.jsonc
npx --no-install wrangler secret put TOKEN_ENCRYPTION_KEY --config wrangler.instance.jsonc
```

Ne pas écrire de valeurs secrètes dans Git, un prompt ou les arguments. Ajouter de la même façon les secrets des seuls fournisseurs autorisés ; requalifier les scopes, identifiants publics et callbacks sur le nouveau domaine, et les renseigner dans la configuration d'instance. Les pages légales et la preuve publique TikTok historique nécessitent une revue avant nouvel usage.

Depuis le dossier du paquet, déployer uniquement lorsque l'environnement est prêt :

```sh
python3 social_publisher_setup.py deploy \
  --prefix "$HOME/Projects/social-publisher-cloud" \
  --confirm-worker-name social-publisher-cloud
```

Cette commande est une **mutation cloud explicite**, contrairement à `install`, `doctor`, `cloud-config` et `cloud-plan`. Elle invoque le Wrangler local déjà installé et exige le nom exact du Worker. Elle conserve le Cron vide, n'applique aucune migration et ne lit aucun jeton de l'ancien système. Wrangler doit disposer d'une authentification autorisée dans l'exécuteur concerné ; aucune nouvelle autorisation n'est acquise silencieusement par le CLI.

Un déploiement accepté ne qualifie pas OAuth ni une publication. Vérifier ensuite `/health`, les refus d'authentification et les bindings sur le nouveau Worker. Le Cron ne sera activé qu'après une demande d'exploitation distincte. Lire [document.md](document.md) pour les tests et limites.
