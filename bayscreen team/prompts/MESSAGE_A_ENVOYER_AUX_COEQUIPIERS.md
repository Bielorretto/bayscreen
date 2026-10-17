# MESSAGE À ENVOYER AUX COÉQUIPIERS (DISCORD / WHATSAPP)

Salut ! Pour le hackathon, je vous propose qu'on utilise le même système de coordination entre nos IA que celui qu'on avait testé : chaque personne garde son IA et ses décisions, mais nos agents peuvent se transmettre les tâches, les contrats techniques, les blocages et leurs résultats via un dossier commun versionné avec Git.

Je vous partage un petit kit ZIP réutilisable. Il contient `AGENTS.md` (règles communes), `goal.md` (objectif et tâches), `sessions/` (état individuel), `docs/agents-canal.md` (communication technique) et `scripts/messages.py` (messages entre IA).

L'idée n'est pas de donner un chef à tout le monde : chaque IA travaille pour son propriétaire, avec un responsable d'intégration choisi ensemble pour éviter les conflits.

Pour démarrer :
1. On décide ensemble du dépôt Git et de sa branche de collaboration, ainsi que de qui intègre quoi.
2. Chaque personne configure son identifiant et donne à son IA le prompt `prompts/PROMPT_IA_COEQUIPIER.md`.
3. On se répartit les fichiers avant de coder, et on s'envoie des messages `CLAIM`, `CONTRACT`, `BLOCKER` et `HANDOFF` pour se synchroniser.
4. Aucun push automatique ni partage de secrets : les publications Git sont validées avant envoi.

Si ça vous va, on configure le kit ensemble au lancement du hackathon. Ça devrait nous éviter de coder deux fois la même chose et permettre à nos IA de vraiment travailler en équipe.
