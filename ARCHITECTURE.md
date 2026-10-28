# Architecture reprise

```text
CLI installateur (Python standard)
  └─ instance dédiée
     ├─ bin/social-publisher → profil HOME propre à l'instance
     ├─ service/ → Python CLI + source Worker
     ├─ home/.codex/skills/social-publisher/ → moteur de file
     ├─ home/.codex/social-publisher/registry.json → registre canonique
     ├─ projects/demo/ → brouillon sans compte connecté
     ├─ docs/ → architecture, procédures, prompts et preuves
     └─ installation.json → reçu d'installation et empreintes

Après configuration et déploiement autorisés :
CLI → HTTPS Worker distinct → D1 distinct + R2 distinct → fournisseurs
                         └─ Cron désactivé par défaut
```

L'agent cloud et le Mac sont des clients de préparation/soumission. Le Worker exécute les publications ; il ne dépend pas d'un Mac allumé. Les fichiers de marque et les secrets ne sont pas copiés par l'installateur. Le registre de l'instance est distinct du profil utilisateur existant.

Le moteur applicatif est celui de l'existant. L'installateur et les documents de tête sont nouveaux. Le détail des contrats, divergences et limites est dans [document.md](document.md).
