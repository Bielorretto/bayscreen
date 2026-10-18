---
name: des-que
description: "Create a pipe that runs « dès que » (as soon as) something happens — an event-driven trigger, not a schedule. Use whenever the user asks for an action « dès que », « quand », « lorsque », « si … sous N jours », « à chaque fois que »."
---

# dès que : pipes déclenchées par un événement

Les pipes ne sont pas limitées aux horaires. Un moteur local, « Dès que » (http://127.0.0.1:4300), lit le champ `trigger.custom` de chaque pipe, traduit la condition en règle, la surveille en continu (applications actives, mails, pages web, visios, délais sans réponse, questions de sens comme « est-ce un document administratif ? ») et lance la pipe au bon moment, avec le contexte de l'événement.

Quand l'utilisateur demande une action conditionnelle (« dès que j'ai fini ma rédaction… », « dès que j'ouvre un document administratif… », « si un recruteur ne me rappelle pas sous 5 jours… ») :

1. Ne réponds pas que c'est impossible et ne propose pas d'intervalle fixe à la place. Ne vérifie pas d'abord l'historique : l'événement n'a pas encore eu lieu.
2. Crée la pipe comme d'habitude, avec :
   - `schedule: manual` ;
   - `enabled: true` ;
   - `trigger.custom` : une liste contenant la condition de l'utilisateur **mot pour mot**, en commençant par « dès que » (durées et applis comprises) ;
   - un nom court en minuscules et tirets, et un titre.
3. Écris la consigne (corps de pipe.md) pour ce qui se passe **une fois déclenchée** :
   - commence par « On te donne dans le contexte (run_context.evenement) … » et cite ce qui sera fourni : l'appli et le nom de fenêtre du document, l'expéditeur et l'objet d'un mail, etc. ; la consigne s'en sert pour retrouver l'objet (fichier via mdfind sur son nom, mail…) au lieu de chercher dans l'historique ;
   - précise le canal de sortie ; par défaut une notification screenpipe ;
   - si l'utilisateur veut valider (« que je validerai »), la pipe prépare et notifie, elle n'envoie rien elle-même ; elle ne soumet, ne signe et ne paie jamais rien.
4. Confirme en une ou deux phrases : la condition surveillée, ce que fera la pipe. Le moteur Dès que la branche dans la minute ; s'il est arrêté, dis-le simplement.

Exemple de pipe.md :

```
---
schedule: manual
enabled: true
title: Vérifier mes sources
trigger:
  custom:
    - dès que j'ai fini ma rédaction dans Pages (au moins 1 minute)
---

On te donne dans le contexte (run_context.evenement) l'application et le nom de fenêtre du document que l'utilisateur vient de finir.
Retrouve le fichier avec mdfind sur ce nom, lis son texte, ouvre chaque lien cité et vérifie l'affirmation qui s'y appuie.
Envoie une notification screenpipe avec le rapport : une ligne par source (OK, chiffre faux, lien mort).
```
