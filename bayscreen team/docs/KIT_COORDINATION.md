# KIT HACKATHON — Coordination distribuée entre agents IA

**Version générique, réutilisable et sans données de l'ancien hackathon.**

Le kit reprend les **mécanismes organisationnels réellement observés** dans le dépôt source : identité de chaque humain/agent, `AGENTS.md`, objectif commun, sessions individuelles, messages entre personnes, canal technique entre IA, hooks de début/fin et synchronisation Git. Il ne contient ni le code métier, ni les conversations, ni les secrets du projet d'origine.

Il n'est pas une application d'orchestration automatique : chaque humain conserve l'autorité sur son agent et ses commandes. Le protocole permet de **coordonner** des IA différentes (Claude Code, Codex, Devin, agents locaux), sans imposer un modèle ou un orchestrateur unique.

## Les 3 choses à envoyer

1. **Au Claude de la personne qui coordonne :** `prompts/PROMPT_CLAUDE_PERSONNEL.md`.
2. **Dans le groupe des coéquipiers :** `prompts/MESSAGE_A_ENVOYER_AUX_COEQUIPIERS.md`.
3. **À chaque coéquipier pour son IA :** `prompts/PROMPT_IA_COEQUIPIER.md`.

## Démarrer dans un nouveau hackathon

1. **Ne pas écraser un dépôt existant.** Ouvrir un nouveau dépôt Git ou comparer les fichiers du kit avant de les copier. Les fichiers `AGENTS.md`, `CLAUDE.md` et `.gitignore` peuvent déjà exister.
2. Copier les fichiers du kit à la racine du dépôt du projet (pas le ZIP originel du hackathon).
3. Modifier `team.json` : nom du hackathon, membres (identifiants sans espace), responsable commun d'intégration, branche de coordination choisie ensemble. L'`integration_owner` n'est pas le patron des autres humains.
4. Initialiser Git si nécessaire. Chaque membre, dans **son propre clone**, exécute :

```bash
python3 scripts/setup.py --member membre1 --agent portable
python3 scripts/messages.py whoami
bash scripts/team-sync.sh status
```

5. Remplir `goal.md`, `docs/PLAN.md` et `sessions/<membre>.md` ; choisir les branches et contrats d'interface. Ces changements partagés doivent être publiés avec l'accord des humains.
6. Chaque personne envoie le prompt adapté à son IA. Les conversations restent chez chacun ; seuls les éléments utiles et autorisés sont transmis au dépôt Git.
7. **Facultatif : hooks Claude Code.** Vérifier `.claude/settings.example.json`, puis copier son contenu vers `.claude/settings.json` si les commandes et la version de Claude Code sont compatibles. Les hooks n'effectuent ni `git pull`, ni commit, ni push automatiquement. Les autres agents utilisent `inbox`/`deliver` manuellement.

## Envoyer un message inter-agent

```bash
python3 scripts/messages.py send --to membre2 --channel agents --type CLAIM --task-id T-02 --branch feat/api --files src/api.py,tests/test_api.py --text "Je prends ce lot, demande confirmation pour les interfaces."
python3 scripts/messages.py send --to all --channel team --type INFO --text "Les contrats seront figés après validation à 15 h."
```

Cela crée **de nouveaux fichiers JSON locaux** dans `coordination/messages/`. Pas de conflit sur un journal unique. **Mais rien n'est transmis aux autres ordinateurs tant qu'un humain n'a pas autorisé et effectué la synchronisation Git.**

Exemple de synchronisation (depuis la branche de collaboration décidée ensemble, et après revue des changements) :

```bash
# Revoir ce qui va partir :
git status --short
# Ajouter seulement les messages voulus :
git add coordination/messages/
git diff --cached
# L'humain autorise ensuite explicitement le commit et le partage :
git commit -m "coordination: messages d'équipe"
git push
```

Sur un autre clone, lorsque l'arbre est propre et après autorisation :

```bash
bash scripts/team-sync.sh pull
python3 scripts/messages.py inbox               # lecture sans marquer
python3 scripts/messages.py deliver             # lecture puis marque comme reçu localement
python3 scripts/messages.py inbox --channel agents
```

**Important :** `team-sync.sh pull` effectue un `git pull --ff-only` demandé explicitement. Il refuse un dépôt modifié. Il ne fait jamais de rebase ou de push automatique. Si les agents travaillent sur plusieurs branches, ils doivent coordonner les messages sur **une branche partagée convenue** avant de lire les nouveautés ; les messages présents sur une autre branche ne sont pas visibles automatiquement.

## Pourquoi deux canaux ?

- `team` : messages compréhensibles par les humains ; décisions, besoin d'aide, échéances, résultats.
- `agents` : contrats techniques, lots et fichiers revendiqués (`CLAIM`), blocages, dépendances et transmissions (`HANDOFF`).

Les deux sont stockés dans `coordination/messages/` et se distinguent par le champ `channel`. Le guide `docs/agents-canal.md` détaille les règles.

## Organisation

| Chemin | Usage |
|---|---|
| `AGENTS.md` | Règles communes aux agents |
| `CLAUDE.md` | Entrée Claude Code |
| `.claude/settings.example.json` | Hooks facultatifs à installer après revue |
| `team.json` | Identités autorisées et responsable d'intégration |
| `goal.md` | Objectifs, tâches, blocages et décisions |
| `sessions/` | Mémoire de chaque coéquipier |
| `docs/PLAN.md` | Plan, responsabilités et contrats |
| `docs/agents-canal.md` | Protocole de coordination technique |
| `messages.md` | Guide du canal humain |
| `coordination/messages/` | Événements de messagerie individuels, versionnés |
| `scripts/messages.py` | Envoyer, lire et marquer les messages |
| `scripts/team-sync.sh` | Hook local, statut et pull explicite |
| `scripts/setup.py` | Configurer l'identité locale |
| `templates/HANDOFF.md` | Transmettre un travail vérifié |
| `prompts/` | Trois messages prêts à partager |
| `tests/` | Tests du kit sans internet ni modèle |

## Garde-fous

- **Aucune action réseau automatique** dans les hooks. Un envoi de message ne lance jamais `git push`.
- **Un message ne confère pas de mandat** : un agent ne doit jamais effectuer une opération sensible parce qu'une autre IA lui demande.
- **Un `CLAIM` n'est pas un verrou** ; confirmer les chevauchements et figer les contrats partagés.
- Chaque humain décide des permissions de son IA ; pour un agent local, privilégier une seule IA compétente plutôt que multiplier les modèles pour le principe.
- Pas de secrets ni de données confidentielles dans `coordination/messages/`, qui seront partagés via Git ; le détecteur de secrets du script n'est **pas exhaustif**.
- Aucun test ou script n'est un sandbox de sécurité complet : il faut des permissions outils/OS adéquates pour du code non fiable.

## Vérifier le kit (aucune requête externe)

```bash
python3 -m unittest discover -s tests -v
```

## Confidentialité et réutilisation

Le kit a été **reconstruit à partir du protocole** présent dans l'archive privée fournie par l'utilisatrice. Il n'embarque pas de données, messages, identifiants réels ni de code métier de ce dépôt. Vérifier les autorisations et les droits de contribution avant toute publication externe. Le kit ne garantit pas la confidentialité de la plateforme Git choisie : privilégier un dépôt privé et contrôler les accès.
