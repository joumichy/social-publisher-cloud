# Retour arrière

Dashboard : arrêter le seul processus local démarré pour cette instance avec Ctrl+C. Il n’existe aucun LaunchAgent ni service à désinstaller. Les modifications de file sont des données de travail : les sauvegarder avant tout retrait d’instance. Les imports locaux peuvent rester dans `dashboard-media/` même après fermeture d’un éditeur ; ne pas supprimer automatiquement les médias. Les changements d’un paquet privé ou d’une version Git ne restaurent pas les files personnelles éditées.

```sh
python3 social_publisher_setup.py rollback-plan --prefix '<CHEMIN_INSTANCE>'
```

Le CLI vérifie le reçu et les empreintes initiales puis affiche les fichiers modifiés ou manquants. Il ne supprime rien. Examiner aussi les fichiers ajoutés depuis l'installation et toute donnée de travail ; arrêter uniquement les processus de cette instance, puis retirer seulement le dossier neuf identifié, avec l'autorisation requise. Aucun profil utilisateur existant n'a été remplacé par l'installateur.

La suppression locale n'arrête pas un Worker et ne supprime pas D1/R2 ni les objets fournisseurs. Une intervention cloud demande son propre inventaire et son autorisation. Le retour à une version précédente du Worker ne restaure pas les données et schémas. Les annulations du planificateur ne retirent pas une publicité déjà matérialisée ou un post publié. Voir les limites détaillées de `document.md`.
