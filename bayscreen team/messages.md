# Canal humain (guide)

Les vrais messages sont écrits comme fichiers JSON individuels dans `coordination/messages/`, avec `--channel team`. Ils sont versionnables par Git et listables par `python3 scripts/messages.py inbox --channel team`.

Exemple :

```bash
python3 scripts/messages.py send --to all --channel team --type INFO --text "La démo est prévue à 17 h; merci de figer les contrats à 15 h."
```

**Important :** la commande enregistre le message **localement**. Pour qu'une autre machine le reçoive, le fichier doit être ajouté, commité et partagé sur la branche de coordination **avec l'autorisation requise**. Les hooks du kit ne poussent jamais automatiquement.
