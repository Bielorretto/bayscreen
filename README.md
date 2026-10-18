# Obay Screen

**Des agents screenpipe qui démarrent au bon moment.**

Projet du hackathon screenpipe « Build Agents That Remember » (42 Paris, 16–18 oct. 2026).

## L'idée

Une pipe screenpipe tourne d'habitude à heure fixe : toutes les X minutes, elle se réveille, cherche
l'information et, le plus souvent, ne trouve rien. Avec Obay Screen, on écrit sa condition en français
dans le chat de screenpipe :

> Dès que j'ai fini ma rédaction dans Pages (au moins 1 minute), vérifie toutes mes sources et envoie-moi un rapport.

Un moteur local traduit la phrase en règle, la surveille en continu, et lance la pipe au moment exact où
la condition se réalise, avec le contexte en main (quel document, quel expéditeur). Aucun code n'est écrit
par tâche : la même mécanique sert pour n'importe quelle phrase.

## Vérifié en réel (18/10)

| Cas | Phrase écrite dans le chat | Résultat |
| --- | --- | --- |
| Journaliste | « Dès que j'ai fini ma rédaction dans Pages, vérifie toutes mes sources » | à la sortie de Pages, l'agent ouvre chaque lien et signale chiffres faux et liens morts |
| Papiers administratifs | « Dès que j'ouvre un document administratif, remplis-le avec mes infos, sans rien soumettre ni signer » | Haiku reconnaît le formulaire, la pipe remplit 20 champs sur 21 depuis la fiche ; la date manquante reste vide |

Le cas « relance d'un recruteur qui n'a pas rappelé » (mail + délai) passe avec un faux screenpipe
(`bun scripts/essai-briques.ts`), pas encore en réel.

## Comment ça marche

```
chat screenpipe ──► pipe.md (trigger.custom : la phrase, mot pour mot)
                          │
                          ▼  toutes les minutes : GET /pipes
              src/pipes-des-que.ts ── Claude Sonnet ──► règle (JSON par schéma), vérifiée et testée
                          │
événements screenpipe ───►│  appli active (OCR, 3 s), /ws/events (visios), mails IMAP, pages web
                          ▼
                 src/moteur.ts : conditions simples, sans IA
                          ▼
                 src/briques.ts : sens (Haiku) · session · délai · contexte · anti-répétition
                          ▼
              POST /pipes/:id/run { run_context } ──► l'agent de la pipe fait la tâche, suivi jusqu'au bout
```

Les briques que Claude assemble à partir de la phrase :

| Brique | Exemple |
| --- | --- |
| **Événement** | appli active, mail reçu, valeur d'une page web, visio, webhook |
| **Sens** | une question oui/non posée à Claude Haiku : « est-ce un document administratif ? » ; filtre d'appli gratuit avant, réponses en cache, texte de l'écran en secours |
| **Session** | « au moins N min dans Pages, puis on la quitte » |
| **Délai** | « s'il ne rappelle pas sous 5 jours » : annulé par un nouvel événement de la même personne |
| **Contexte** | l'appli, le nom du document, l'expéditeur : texte nettoyé, une ligne, jamais le corps d'un mail |

Le moteur évalue les règles en local ; Claude n'intervient qu'à la traduction (une fois par phrase) et
pour les questions de sens (une fois par document, grâce au cache).

## Démarrer

Prérequis : macOS, [Bun](https://bun.sh) 1.3+, l'appli screenpipe qui tourne, une clé Claude.

```sh
bun install
cp .env.example .env        # SCREENPIPE_LOCAL_API_KEY et ANTHROPIC_API_KEY
bun run start               # moteur sur http://127.0.0.1:4300
```

- Clé screenpipe : `screenpipe auth token`, ou l'appli : Réglages > Confidentialité.
- **Apprendre les « dès que » au chat de screenpipe** (sinon il répond que ses tâches tournent à intervalle fixe) :

  ```sh
  mkdir -p ~/.screenpipe/pi-chat/.pi/skills/des-que
  cp screenpipe-correctif/skill-des-que/SKILL.md ~/.screenpipe/pi-chat/.pi/skills/des-que/
  ```

  puis ouvrir une nouvelle conversation dans le chat et y écrire sa phrase « Dès que… ». La pipe est
  branchée dans la minute (journal du moteur : « branchée automatiquement »).
- `pi-subagents` : à partir de 0.71, cette extension fait échouer toutes les pipes de screenpipe ; le moteur la
  ramène tout seul à 0.70.0 au démarrage et avant chaque lancement.
- Fichiers de démo fictifs (article à sources, formulaire Cerfa vierge, fiche) : voir `demo/LISEZMOI.md`.

## Sécurité

- Tout reste local : le moteur n'écoute que 127.0.0.1 ; aucune clé n'est écrite ni journalisée.
- Les textes lus (écran, mails, pages) sont des données non fiables : Claude n'en suit aucune instruction,
  et l'agent de la pipe n'en reçoit que des références nettoyées (appli, document, expéditeur, objet).
- Les pipes de démo ne soumettent, ne signent et n'envoient rien en votre nom.

## Fichiers principaux

| Fichier | Rôle |
| --- | --- |
| `src/pipes-des-que.ts` | le pont : lit les pipes, fait traduire les phrases, branche et lance |
| `src/briques.ts` | sens (Haiku), session, délai, contexte, anti-répétition |
| `src/moteur.ts` | règles et conditions, actions, journal |
| `src/screenpipe.ts`, `src/sources/*` | client screenpipe ; sources appli active, mail, web |
| `src/claude.ts` | appels à Claude (JSON par schéma) |
| `src/fixes/pi-subagents.ts` | contournement du bug d'extension de screenpipe |
| `screenpipe-correctif/` | skill du chat, correctifs proposés à screenpipe |
| `scripts/essai-briques.ts` | les 3 cas de bout en bout, vraie traduction, faux screenpipe |
| `docs/SCREENPIPE.md` | référence de l'API screenpipe vérifiée dans son code |

## État

- `bun test` sur cette branche : les tests des briques passent ; 40 tests du pont échouent, ceux réparés
  sur `main` (fusion de `main` sans conflit, pas encore faite).
- Limites connues : un redémarrage du moteur oublie les sessions et délais en cours ; screenpipe ne capture
  une fenêtre peu changeante qu'environ toutes les 30 s, d'où une précision d'environ 30 s sur les durées.

*screenpipe · Claude (Sonnet pour traduire, Haiku pour juger) · Bun*
