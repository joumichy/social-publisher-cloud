# Prompt de qualification cloud — futur périmètre distinct (nouveau)

Lis `document.md`, le code et le lockfile. La livraison initiale autorisait l'export uniquement. Sans nouvelle autorisation de création de ressources ou de modification du service, prépare les paramètres et reste hors ligne.

Fais choisir explicitement entre conserver le service existant et créer un environnement de test distinct. Pour le premier, commence par un rapprochement en lecture seule des identités, modes TikTok, migrations et reçus, sans extraire de jetons. Pour le second, utilise des noms, D1 vide et R2 distincts avec autorisation de ressources et de coûts. Ne cible jamais la production avec les scripts de cet instantané. Requalifie les versions de plateforme, scopes, callbacks et propriété de domaine avec les documentations officielles au moment de l'exécution.

La configuration livrée n'a pas de Cron actif, ne contient aucun identifiant OAuth opérationnel, et utilise un UUID D1 nul. Ne copie pas l'URL du README historique. Configure les secrets uniquement via le gestionnaire sécurisé autorisé. La clé de chiffrement d'une base existante ne peut pas être remplacée arbitrairement.

Vérifie les routes locales, refus d'authentification, bindings et neuf migrations avant toute proposition de déploiement. Conserve `creator_inbox_draft` et `direct_publish` comme contrats distincts ; `awaiting_creator` ne veut pas dire publié. Ne lance pas d'OAuth ou d'appel fournisseur de mutation, ne réactive pas le Cron et n'envoie aucun média sans demande spécifique. Les budgets publicitaires et l'exécution de publication restent hors périmètre.

Avant une mutation ultérieure autorisée, prépare un plan de rollback tenant compte du Worker, D1, R2, de la clé de chiffrement et des opérations fournisseur déjà créées. Rends les vérifications, preuves, écarts et limites sans prétendre qualifier les plateformes grâce aux seuls mocks.
