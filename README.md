# Dès que

Projet du hackathon screenpipe « Build Agents That Remember » (42 Paris, 16–18 oct. 2026).

## L'idée

screenpipe enregistre en continu ce qui se passe sur un ordinateur (écran, audio,
réunions) et le rend interrogeable par une API locale. Il donne une mémoire aux agents.
Nous lui ajoutons des réflexes : **dès que X arrive, fais Y.**

Trois briques, par ordre de priorité :

1. **A. Le moteur « dès que »**. Des événements arrivent : une visio se termine, une
   valeur change sur une page web, un mail arrive. Des règles décident quoi faire : soit
   une action fixe, prévue d'avance, soit une action proposée par Claude, que
   l'utilisateur valide d'un clic. Les actions partent vers Slack, Telegram, un webhook
   ou un pipe screenpipe.
2. **B. L'ouverture**. On relit la mémoire screenpipe pour repérer les tâches qui se
   répètent, on montre quelles applis externes sont branchées, et un clic transforme une
   tâche repérée en règle du moteur.
3. **C. Le copilote de visio**. Seulement pendant une visio, dire « OK Claude » au micro
   réveille l'assistant. Il a toute la transcription de l'appel en contexte : on lui pose
   une question (« qu'a promis Marc ? »), ou on lui demande une action (« envoie le récap
   sur Slack »), qui passe par le moteur avec validation.

## Architecture

```
screenpipe (/ws/events) ─┬─► copilote.ts ── question ──► assistant.ts ──► Claude
                         │        │ (visio, micro, « OK Claude »)          │
page web, mail, webhook ─┴─► moteur.ts ◄── fin de visio, demandes ─────────┘
                                 │  règles (regles.json) : fixe ou Claude
                                 ▼
                             actions.ts ──► Slack, Telegram, webhook, pipe screenpipe
                                 │
                serveur.ts ◄─────┘──► page (public/index.html) : valider, refuser, suivre
```

## Démarrer

Prérequis : [Bun](https://bun.sh) 1.3 ou plus récent, screenpipe qui tourne sur la
machine, une clé Claude.

```sh
bun install
cp .env.example .env      # puis remplir les deux clés
bun test                  # doit être vert
bun run dev               # http://127.0.0.1:4300
```

- Clé screenpipe : `screenpipe auth token` (ou l'appli : Réglages > Confidentialité).
- Clé Claude : console Claude, dans `ANTHROPIC_API_KEY`.
- `.env` n'est jamais commité ; aucune clé ne doit apparaître dans la vidéo.

Tester sans rien brancher : `bun run evt web valeur_changee '{"nom":"cours","valeur":120,"valeurTexte":"120","ancienne":"90"}'`
déclenche la règle d'exemple et affiche une notification dans la page.

## Travailler à deux avec Claude Code

1. Ouvrir le dossier dans VS Code, ouvrir un terminal, lancer `claude`.
   Claude Code lit automatiquement `CLAUDE.md`, qui importe `docs/SCREENPIPE.md`.
2. Commencer chaque session par son rôle, par exemple :
   - Dev 1 : « Je suis Dev 1. Lis docs/PLAN.md et attaque la phase 1 : la source mail.
     Vérifie d'abord le format réel de GET /connections/imap/messages. »
   - Dev 2 : « Je suis Dev 2. Lis docs/PLAN.md et attaque la phase 1 : teste le mode ia
     avec la vraie clé, puis l'exécuteur Slack ou Telegram. »
3. Chaque fichier a un propriétaire (tableau dans `CLAUDE.md`) : vos deux sessions ne
   touchent jamais le même fichier. `src/types.ts` ne change qu'à deux.
4. Git : une branche par développeur (`dev1`, `dev2`), petits commits, fusion à chaque
   critère « Fini quand ». Les fichiers étant séparés, les fusions sont triviales.

## Fichiers

| Fichier | Rôle | Propriétaire |
| --- | --- | --- |
| `src/types.ts` | le contrat : Evenement, Regle, Action, messages vers la page | commun |
| `src/config.ts`, `src/main.ts` | configuration, branchement des modules | commun |
| `src/screenpipe.ts` | client de l'API screenpipe et du flux d'événements | Dev 1 |
| `src/moteur.ts` | règles, conditions, création et exécution des actions, journal | Dev 1 |
| `src/copilote.ts` | visio seulement, micro seul, phrase d'appel, fin de question | Dev 1 |
| `src/sources/web.ts` | sondage d'une page web | Dev 1 |
| `src/claude.ts` | appels à Claude (JSON par schéma) | Dev 2 |
| `src/actions.ts` | exécuteurs : notifier, Slack, Telegram, webhook, pipe | Dev 2 |
| `src/assistant.ts` | réponse aux questions de visio, demandes d'action | Dev 2 |
| `src/serveur.ts`, `public/index.html` | serveur local et page | Dev 2 |
| `regles.json`, `sources.exemple.json` | règles et sources d'exemple | — |
| `docs/PLAN.md`, `docs/SCREENPIPE.md` | plan de nuit, référence screenpipe vérifiée | — |

## État du squelette

Fonctionne et testé : moteur et règles fixes, validation, page en direct, simulation
d'événements, détection « OK Claude » en visio (tests unitaires). Écrit mais pas
encore éprouvé faute de clés : appels à Claude, connexion réelle à screenpipe,
exécuteurs Slack, Telegram et pipe. À faire : source mail, brique B.
