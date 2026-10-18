# Obay Screen

**Des agents screenpipe qui démarrent au bon moment.**

Projet réalisé pendant le hackathon screenpipe « Build Agents That Remember » (42 Paris, 16–18 oct. 2026).
Dans le code, le moteur s'appelle encore « Dès que ».

## L'idée

[screenpipe](https://screenpi.pe) enregistre ce qui se passe sur l'ordinateur (écran, audio, visios) et fait
tourner des agents, les *pipes*. Mais une pipe démarre à heure fixe ou à la main : elle se réveille toutes
les X minutes, cherche l'information et, le plus souvent, ne trouve rien. Son champ « déclencheur
personnalisé » existe, mais screenpipe ne l'évalue pas.

Obay Screen comble ce manque. On écrit sa condition en français dans le chat de screenpipe :

> Dès que j'ai fini ma rédaction dans Pages (au moins 1 minute), vérifie toutes mes sources et envoie-moi un rapport.

Le moteur traduit la phrase en règle, la surveille en local et lance la pipe au moment exact où la condition
se réalise, avec le contexte en main (quel document, quel expéditeur). Aucun code n'est écrit par tâche.

screenpipe fournit la mémoire et l'agent ; Obay Screen lui donne des réflexes.

## Vérifié en réel (18 oct.)

| Cas | Phrase écrite dans le chat | Résultat |
| --- | --- | --- |
| Journaliste | « Dès que j'ai fini ma rédaction dans Pages, vérifie toutes mes sources » | à la sortie de Pages, l'agent ouvre chaque lien et signale chiffres faux, affirmations invérifiables et liens morts |
| Papiers administratifs | « Dès que j'ouvre un document administratif, remplis-le avec mes infos, sans rien soumettre ni signer » | Claude Haiku reconnaît le formulaire ; la pipe remplit 20 champs sur 21 depuis la fiche, la date manquante reste vide |
| Démo du pitch | « Dès que la fenêtre « Obay Screen · Cas 2 : papiers administratifs » s'affiche, ouvre le formulaire, attends 3 secondes et remplis-le » | arrivée sur la slide → formulaire ouvert vide puis rempli, environ 17 s plus tard |

Le cas « relancer un recruteur qui n'a pas rappelé sous 5 jours » (mail + délai) passe avec un faux screenpipe
(`bun scripts/essai-briques.ts`), pas encore en réel.

## Comment ça marche

```
chat screenpipe ──► pipe.md (trigger.custom : la phrase, mot pour mot, grâce à la skill « des-que »)
                          │
                          ▼  toutes les minutes : GET /pipes
              src/pipes-des-que.ts ── Claude Sonnet ──► règle (JSON par schéma), vérifiée, essais rejoués
                          │
événements screenpipe ───►│  appli active (toutes les 3 s), visios (/ws/events), mails IMAP, pages web, webhooks
                          ▼
                 src/moteur.ts : conditions simples, en local, sans IA
                          ▼
                 src/briques.ts : sens (Haiku) · session · délai · contexte · anti-répétition
                          ▼
              POST /pipes/:id/run { run_context } ──► l'agent screenpipe fait la tâche ; exécution suivie jusqu'au bout
```

Les briques que Claude assemble à partir de la phrase :

| Brique | Exemple |
| --- | --- |
| **Événement** | appli active, mail reçu, valeur d'une page web, début ou fin de visio, webhook |
| **Sens** | une question oui/non posée à Claude Haiku : « est-ce un document administratif ? » ; filtre d'appli gratuit avant, cache après, texte de l'écran en secours, boîtes de dialogue ignorées |
| **Session** | « au moins N min dans Pages, puis on la quitte » |
| **Délai** | « s'il ne rappelle pas sous 5 jours » : annulé par un nouvel événement de la même personne |
| **Contexte** | l'appli, le nom du document, l'expéditeur : texte nettoyé, une ligne, jamais le corps d'un mail |

Claude n'intervient qu'à la traduction (une fois par phrase) et pour les questions de sens (une fois par
document, grâce au cache). Tout le reste est évalué en local.

## Le reste du moteur

- **Page locale** (http://127.0.0.1:4300) : règles et actions en direct, état des pipes « dès que »,
  simulation d'événements, et **« Écris ta règle en français »** (Claude traduit, le moteur rejoue les essais,
  un clic crée la règle).
- **Règles directes** (`regles.json`) : sans pipe, le moteur exécute lui-même une action fixe ou proposée par
  Claude : notification screenpipe, Slack, Telegram, Discord, webhook (n8n, Make…), ouverture d'une page.
- **Sources** : page ou API web surveillée (garde d'adresse, DNS compris), dossier IMAP, appli active.
- **Copilote de visio** (`src/copilote.ts`, `src/assistant.ts`) : pendant une visio seulement, dire
  « OK Claude » au micro réveille un assistant qui répond avec la transcription de l'appel et la mémoire de
  l'écran en contexte.

## Démarrer

Prérequis : macOS, [Bun](https://bun.sh) 1.3+, l'appli screenpipe qui tourne, une clé Claude.

```sh
bun install
cp .env.example .env        # SCREENPIPE_LOCAL_API_KEY et ANTHROPIC_API_KEY
bun run start               # moteur et page sur http://127.0.0.1:4300
```

1. **Clé screenpipe** : `screenpipe auth token`, ou l'appli : Réglages > Confidentialité.
2. **Apprendre les « dès que » au chat de screenpipe** (sinon il répond que ses tâches tournent à intervalle fixe) :

   ```sh
   mkdir -p ~/.screenpipe/pi-chat/.pi/skills/des-que
   cp screenpipe-correctif/skill-des-que/SKILL.md ~/.screenpipe/pi-chat/.pi/skills/des-que/
   ```

3. Ouvrir une nouvelle conversation dans le chat de screenpipe et y écrire sa phrase « Dès que… ».
   La pipe est branchée dans la minute (journal du moteur : « branchée automatiquement »).

Fichiers de démo fictifs (article à sources, formulaire, fiche d'infos) : `demo/LISEZMOI.md`.
Tester sans screenpipe : `bun run evt web valeur_changee '{"nom":"cours","valeur":120}'` envoie un faux événement.

## Pièges connus de screenpipe

- **`pi-subagents`** : à partir de 0.71, cette extension fait échouer toutes les pipes au chargement
  (`toToolDeclaration is not a function`). Le moteur la ramène tout seul à 0.70.0, au démarrage et avant chaque
  lancement (`src/fixes/pi-subagents.ts`).
- **Déclencheur et deux-points** : un « : » non protégé dans `trigger.custom` casse le YAML de `pipe.md`, et
  screenpipe refuse la pipe sans prévenir. La skill demande de toujours mettre la phrase entre guillemets.
- **Capture figée** : si screenpipe arrête de capturer l'écran (`/health` : `frame_status: stale`, souvent
  quand le disque est presque plein), plus aucun événement « appli active » n'arrive. Libérer de la place, puis
  relancer screenpipe.
- Une fenêtre peu changeante n'est capturée qu'environ toutes les 30 s : les durées ont une précision
  d'environ 30 s.

## Sécurité

- Tout reste local : le moteur n'écoute que 127.0.0.1 ; aucune clé n'est écrite ni journalisée.
- Les textes lus (écran, mails, pages) sont des données non fiables : Claude n'en suit aucune instruction, et
  l'agent de la pipe n'en reçoit que des références nettoyées (appli, document, expéditeur, objet).
- L'agent screenpipe dispose d'un terminal : les garde-fous sont dans les consignes des pipes (ne rien soumettre,
  signer ni envoyer au nom de l'utilisateur). Prochaine étape : une validation d'un clic avant toute action
  irréversible, que le moteur sait déjà proposer.

## Fichiers

| Fichier | Rôle |
| --- | --- |
| `src/pipes-des-que.ts` | le pont : lit les pipes, fait traduire les phrases, branche et lance |
| `src/briques.ts` | sens (Haiku), session, délai, contexte, anti-répétition |
| `src/moteur.ts` | règles, conditions, actions, journal |
| `src/actions.ts` | exécuteurs : notification, Slack, Telegram, Discord, webhook, ouvrir, lancer une pipe |
| `src/screenpipe.ts`, `src/sources/*` | client screenpipe ; sources appli active, mail, web |
| `src/claude.ts`, `src/regle-en-francais.ts` | appels à Claude (JSON par schéma) ; règle écrite en français |
| `src/copilote.ts`, `src/assistant.ts` | copilote de visio |
| `src/serveur.ts`, `public/index.html` | serveur local et page |
| `src/fixes/pi-subagents.ts` | contournement du bug d'extension de screenpipe |
| `screenpipe-correctif/` | skill du chat ; correctifs proposés à screenpipe (déclencheur « Dès que… » natif dans l'appli) |
| `scripts/essai-briques.ts` | les 3 cas de bout en bout, vraie traduction, faux screenpipe |
| `demo/` | fichiers fictifs pour les démos |
| `docs/SCREENPIPE.md` | référence de l'API screenpipe, vérifiée dans son code |

## État

- `bun test` sur cette branche : 73 tests passent ; 40 tests du pont échouent, ceux réparés sur `main`
  (fusion de `main` sans conflit, pas encore faite).
- Un redémarrage du moteur oublie les sessions et délais en cours.

*screenpipe · Claude (Sonnet pour traduire, Haiku pour juger) · Bun · TypeScript*
