# Adresse sans achat de domaine — vérification du 28 octobre 2026

## Option retenue dans la CLI

`cloud-config --workers-subdomain <SOUS_DOMAINE_REEL_DU_COMPTE>` construit l'origine HTTPS `https://<nom-worker>.<sous-domaine>.workers.dev`. Aucun domaine personnalisé n'est imposé. Cette commande prépare un fichier local ; elle ne réserve rien, ne modifie aucun DNS et ne crée aucun accès. Un nouveau `.com` indépendant n'est pas inclus.

Cloudflare fournit ce routage avec le compte Workers et le nom du Worker. La documentation destine `workers.dev` aux usages personnels/hobby non critiques et recommande une route ou un domaine propre pour la production ; aucune garantie de production critique n'est donc promise ici. [Documentation workers.dev](https://developers.cloudflare.com/workers/configuration/routing/workers-dev/).

L'adresse sans achat ne garantit pas un coût d'exploitation nul. Le plan Free a des limites de requêtes et de CPU ; les quotas de compte sont partagés entre les Workers, donc le duplicata ne donne pas un quota indépendant. D1 et R2 ont leurs propres allocations et conditions. Vérifier le compte et les consommations avant activation, sans achat ni acceptation de facturation implicites. [Tarification Workers](https://developers.cloudflare.com/workers/platform/pricing/), [limites Workers](https://developers.cloudflare.com/workers/platform/limits/).

## URL réellement produites par cet instantané

Le code `src/oauth.ts`, fonction `callbackUrl`, construit les retours à partir de `PUBLIC_BASE_URL`. Pour une origine `https://publisher.compte.workers.dev` :

| Intégration présente | Retour à enregistrer exactement | Exigences et limites de validation |
|---|---|---|
| Instagram Login / Meta Facebook | `https://publisher.compte.workers.dev/oauth/meta/callback` | Faire correspondre l'URI de l'application et celle du code ; vérifier l'application Meta, ses domaines et ses scopes dans la console autorisée. Pas de connexion réelle effectuée. |
| LinkedIn organisation | `https://publisher.compte.workers.dev/oauth/linkedin/callback` | URI autorisée correspondante et produit/scopes disponibles pour l'application ; HTTPS retenu par la configuration. Aucun consentement ni test distant effectué. |
| TikTok Content Posting `creator_inbox_draft` | `https://publisher.compte.workers.dev/oauth/tiktok/callback/` | URI HTTPS absolue, statique et enregistrée ; conserver le slash terminal du code. Sans paramètres ou fragment dans l'URI enregistrée. |
| TikTok Business Organic / publicité | même chemin TikTok | Produit Business distinct : requalifier dans son portail les règles de l'application et l'URL d'autorisation fournie. Les règles Content Posting ne prouvent pas à elles seules l'accès Business. |

Meta documente l'égalité de l'URI OAuth enregistrée et de l'URI utilisée. Les extraits officiels ont été retrouvés ; la lecture intégrale des pages a été limitée par une réponse 429 ou une page inaccessible lors de cet export. Le domaine de la nouvelle application et son acceptation de `workers.dev` restent à contrôler dans la console, sans les déclarer acquis. [Instagram OAuth](https://developers.facebook.com/documentation/instagram-platform/reference/oauth-authorize), [sécurité Facebook Login](https://developers.facebook.com/documentation/facebook-login/security).

LinkedIn exige une URI enregistrée correspondante et les permissions de l'application ; le retour et l'échange doivent rester cohérents. L'absence d'achat de domaine ne dispense pas de ces contrôles. [Flux OAuth LinkedIn](https://learn.microsoft.com/en-us/linkedin/shared/authentication/authorization-code-flow).

TikTok Login Kit web exige une URI HTTPS statique enregistrée et correspondante. Le nouveau sous-domaine et le slash exact devront être enregistrés dans le bon produit. [TikTok Login Kit web](https://developers.tiktok.com/docs/en/login-kit-web).

## Médias et propriété du domaine

Le Worker sert les médias par des URL `/media/<id>/<public_token>` sous `PUBLIC_BASE_URL`. Ces URL sont destinées aux téléchargements fournisseurs pendant leur durée de vie, pas à être placées derrière une connexion utilisateur interactive.

Pour TikTok Content Posting en `PULL_FROM_URL`, la documentation impose un domaine ou préfixe d'URL vérifié, HTTPS, sans redirection et accessible pendant le téléchargement. Une propriété de préfixe peut éviter de contrôler le DNS de `workers.dev`, mais **l'acceptation du préfixe de cette nouvelle application n'a pas été testée**. Le code expose une preuve publique TikTok historique fixe dans `router.ts` : elle ne vérifie pas le duplicata. Une nouvelle preuve fournie par le portail nécessitera d'être servie au chemin exact par une adaptation explicitement autorisée ; aucun endpoint générique de chargement de preuve n'est fourni. [Guide de transfert TikTok](https://developers.tiktok.com/docs/en/content-posting-api-media-transfer-guide).

Le portail Business Organic est distinct et ses règles de vérification média restent à confirmer pour le produit et l'application concernés. La lecture publique de son portail ne permet pas de valider leurs droits actuels. Aucun changement DNS, application, propriété ou preuve de domaine n'a été effectué.

## Webhooks et contrôle d'accès

L'inventaire de `src/router.ts` ne contient pas de récepteur webhook social. Cet instantané exécute des tâches planifiées et interroge les statuts fournisseurs ; les callbacks OAuth sont des retours de connexion, pas des webhooks de publication. Il n'y a donc aucun nouvel abonnement webhook à créer pour reprendre ce code tel quel.

Si un produit fournisseur impose ensuite un webhook, il faudra définir et implémenter son URL HTTPS, sa vérification de challenge/signature et son traitement dans un périmètre distinct. Ne pas déclarer une route existante compatible sans code et test correspondant.

Ne pas ajouter un écran Cloudflare Access à toutes les routes : cela peut empêcher les retours OAuth et les téléchargements médias des fournisseurs. Les routes administratives conservent l'authentification du moteur. La question du domaine gratuit n'autorise aucun nouveau réglage d'accès. L'URL réelle, son certificat, l'acceptation par chaque console et les téléchargements fournisseurs devront être vérifiés après un futur déploiement autorisé.
