# Publication du paquet

Destination publique créée à la demande de John Allou : [joumichy/social-publisher-cloud](https://github.com/joumichy/social-publisher-cloud).

Le dépôt publie le paquet de sources et sa documentation, avec configuration neutralisée et démonstration sans compte connecté. Il ne contient pas l'installation personnelle en fonctionnement, ses files de contenu, ses jetons, ses données D1/R2 ou ses profils navigateur. La création de ce dépôt ne déploie pas un Worker.

`manifest.json` permet de vérifier les octets du paquet, y compris après clonage : `.gitattributes` désactive la conversion automatique des fins de ligne. Le dossier Git local est exclu de la vérification de répertoire et n'entre pas dans le ZIP de transfert. L'empreinte externe du ZIP et le commit Git confirmé sont remis dans le compte rendu de livraison.

Aucun droit d'accès Cloudflare ou social n'est accordé par cette publication du code. Les étapes futures de connexion et de déploiement restent décrites dans les guides. Aucun fichier secret ne doit être ajouté au dépôt public.
