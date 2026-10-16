# Plan de nuit

Dev 1 tient les **sources, le moteur et la détection en visio** ; Dev 2 tient
**Claude, les exécuteurs, le serveur et la page**. Durées indicatives (≈ 9 h).
On ne passe à la phase suivante que si son critère « Fini quand » est atteint.

## Phase 0 — ensemble, 30 min : tout brancher

- [ ] `.env` rempli (clé screenpipe via `screenpipe auth token`, clé Claude), `bun install`, `bun test` vert
- [ ] `bun run dev`, page ouverte sur http://127.0.0.1:4300, journal : « /ws/events : connecté »
- [ ] Visio de test (vraie visio, ou `POST /meetings/start`) : des `meeting_transcript_delta` arrivent avec `device_type: "input"` ; noter le délai parole → texte
- [ ] Dire « OK Claude » dix fois, noter comment c'est transcrit, mettre les variantes dans `PHRASES_APPEL`
- [ ] Relire `src/types.ts` ensemble et le figer

## Phase 1 — brique A « Dès que », ≈ 3 h

- [ ] Dev 1 : source « mail » (sondage de `GET /connections/imap/messages`, événement `mail_recu`)
- [ ] Dev 1 : source « web » réelle dans `sources.json` (une page dont une valeur bouge)
- [ ] Dev 1 : moteur : conditions, journal, anti-boucle (déjà en place : à éprouver)
- [ ] Dev 2 : exécuteurs réels testés : `notifier`, `slack.envoyer` ou `telegram.envoyer`, `webhook`, `pipe.lancer`
- [ ] Dev 2 : mode « ia » testé avec une vraie clé (proposition, liste permise, validation)
- [ ] Dev 2 : page : règles, actions à valider, journal ; formulaire de création de règle

**Fini quand** : une valeur franchit un seuil sur une page → une notification part ;
un mail arrive → Claude propose un message Slack → on valide → il part.

## Phase 2 — brique B « Ouverture », ≈ 2 h

- [ ] Dev 1 : relire 24 h de mémoire (`/search`, `/activity-summary`), regrouper par appli et fenêtre, repérer les enchaînements répétés
- [ ] Dev 1 : Claude nomme les tâches répétées, chacune avec preuves (heures, extraits) ; tâche sans preuve écartée
- [ ] Dev 2 : `GET /connections` : applis externes disponibles et branchées
- [ ] Dev 2 : page « Ce qu'on peut automatiser » : une carte par tâche, applis concernées, bouton « Créer la règle » (`POST /api/regles`)

**Fini quand** : la page montre au moins trois tâches répétées réelles avec preuves,
et un clic crée une règle qui tourne.

## Phase 3 — brique C « Copilote de visio », ≈ 2 h 30

Le squelette (`src/copilote.ts`, `src/assistant.ts`) gère déjà la garde « visio
seulement », le micro seul, la phrase d'appel, l'attente de fin de phrase et la réponse.

- [ ] Dev 1 : éprouver la détection en vraie visio ; ajuster variantes et délai de silence
- [ ] Dev 1 : récap à `meeting_ended` rangé avec `POST /meetings/:id/summary` (bonus)
- [ ] Dev 2 : panneau qui s'ouvre au réveil (son, mise en évidence ; bonus : notification système)
- [ ] Dev 2 : réponses avec citations ; demande d'action → action à valider → exécutée
- [ ] Bonus : actions repérées toutes seules au fil de la visio

**Fini quand**, pendant une visio de test de 5 minutes : « OK Claude » ouvre le panneau,
une question reçoit une réponse juste, une demande d'action est exécutée après
validation. Hors visio, la phrase ne déclenche rien.

## Phase 4 — ensemble, 1 h : la vidéo

- [ ] Scénario sur données fictives ; aucune clé ni donnée privée à l'écran ; prévenir les personnes filmées
- [ ] Enregistrer A (seuil puis mail), B (page d'automatisation), C (visio en direct)

## Ligne de coupe si la nuit est courte

1. A garde ses deux scénarios, non négociable.
2. C garde la phrase d'appel et les questions ; actions repérées seules et récap sautent.
3. B se réduit à une liste de tâches avec preuves et un bouton « Créer la règle ».
