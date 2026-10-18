# Correctifs screenpipe pour « Dès que »

Ce dossier contient seulement nos correctifs, pas le code de screenpipe. Le dépôt est public, et la
licence de screenpipe n'accorde pas de droit de redistribution ; les modifications appartiennent
à Screenpipe (LICENSE.md, §2 et §6). Les correctifs sont destinés à être proposés à screenpipe.

| Correctif | Ce qu'il fait |
| --- | --- |
| `0001` | Le panneau natif des notifications macOS garde la consigne (`prompt`) et `auto_send` d'un bouton « chat ». |
| `0002` | « Add trigger » propose « Dès que… » : une condition en langage naturel, rangée dans `trigger.custom` de la pipe. Le moteur Dès que la traduit, vérifie les accès, rejoue des essais, puis la branche après « Valider ». |
| `0003` | Retirer une condition prévient le moteur tout de suite ; chaque lecture de son état est bornée dans le temps. |
| `0004` | Une pastille « Event API » sur l'accueil du chat crée en un écran une pipe « Dès que… / Alors… ». |

Appliqués dans l'ordre sur `app-v2.7.109`, ils redonnent exactement le screenpipe modifié d'Abel
(voir « Vérifié » en bas).

## 0. Sans recompiler : avec l'appli screenpipe installée (deux minutes)

Ni correctif ni compilation : le chat de l'appli installée crée lui-même les pipes « dès que », et le moteur les
branche. Vérifié le 18/10 sur les cas journaliste et administratif (`dev2/briques`).

1. **Apprendre les « dès que » au chat** : sans cette skill, il répond que ses tâches tournent à intervalle fixe.

   ```sh
   mkdir -p ~/.screenpipe/pi-chat/.pi/skills/des-que
   cp screenpipe-correctif/skill-des-que/SKILL.md ~/.screenpipe/pi-chat/.pi/skills/des-que/
   ```

   Puis ouvrir une **nouvelle** conversation dans le chat. Une mise à jour de screenpipe peut effacer la skill : la recopier.
2. **`pi-subagents` : automatique.** screenpipe remet cette extension dans ses réglages au lancement de chaque pipe, et à
   partir de 0.71 elle fait échouer toutes les pipes (`toToolDeclaration is not a function`). Le moteur la ramène tout
   seul à 0.70.0, la version que screenpipe fige lui-même depuis (commit amont 91f1a17), au démarrage et avant chaque
   lancement (`src/fixes/pi-subagents.ts`, journal : « pi-subagents ramené de … à 0.70.0 »). S'il n'y arrive pas, il donne
   la commande à taper : `cd ~/.screenpipe/pi-config/npm && bun add --exact pi-subagents@0.70.0`.
3. Lancer le moteur (section 4), puis écrire dans le chat, par exemple : « Dès que j'ai fini ma rédaction dans Pages
   (au moins 1 minute), vérifie automatiquement toutes mes sources et envoie-moi un rapport. » La pipe est branchée dans
   la minute (journal du moteur : « branchée automatiquement »).

## 1. Appliquer et tester (macOS, quelques minutes, sans compiler)

```sh
git clone https://github.com/screenpipe/screenpipe.git && cd screenpipe
git checkout app-v2.7.109
git am /chemin/vers/bayscreen/screenpipe-correctif/000*.patch
cd apps/screenpipe-app-tauri && bun install
bun x vitest run --config vitest.config.ts components/settings/__tests__/pipe-trigger-picker.test.tsx components/chat/event-api-dialog.test.tsx components/chat/summary-cards.test.tsx
bun run test:notification-panel-actions
```

Attendu : `Tests  33 passed (33)`, puis `notification panel actions: 3 checks passed`. Sans le
correctif 0001, le test Swift échoue sur `FAIL: prompt survives the click`.

Si vous avez déjà appliqué 0001, `git am` s'arrête dessus : n'appliquez que les suivants,
`git am /chemin/vers/bayscreen/screenpipe-correctif/000[2-4]*.patch`.

## 2. Compiler l'appli (environ 11 min et 5 Go)

Il faut un Mac Apple Silicon, Rust 1.94.0 en aarch64 (`rust-toolchain.toml` du dépôt), un `cmake`
arm64 et les outils en ligne de commande de Xcode. Depuis `apps/screenpipe-app-tauri`, après le
`bun install` de l'étape 1 :

```sh
export CMAKE_POLICY_VERSION_MINIMUM=3.5
export CMAKE=/chemin/absolu/vers/bayscreen/screenpipe-correctif/cmake-sans-native.sh
bun tauri build --no-bundle --config '{"identifier":"screenpi.pe.dev"}' -- --profile debug-dev
```

- La première tentative d'Abel a échoué dans `whisper-rs-sys` (option `-mcpu` refusée) ; `CMAKE`
  ci-dessus corrige ce point.
- L'identifiant `screenpi.pe.dev` est indispensable : avec celui de l'appli installée, le fork se
  ferme si l'appli tourne, et une réinitialisation de permission toucherait l'appli installée.
  macOS redemande donc les autorisations écran et micro pour ce build.
- Ne cliquez sur aucun bouton de chiffrement dans ce build.

## 3. Lancer l'appli : deux modes

Depuis `apps/screenpipe-app-tauri` :

| Mode | Commande | Données, port de l'API | Ce qui marche |
| --- | --- | --- | --- |
| Isolé (par défaut, sans risque pour vos données) | `./src-tauri/target/debug-dev/screenpipe-app` | `~/.screenpipe-dev`, 3130 | « Add trigger → Dès que… » ; **ne cliquez pas** sur la pastille Event API (voir « Limites connues ») |
| Données réelles (celui d'Abel pour la démo) | quitter d'abord l'appli screenpipe installée, puis `SCREENPIPE_DEV_USE_PROD_DATA=1 ./src-tauri/target/debug-dev/screenpipe-app` | `~/.screenpipe`, 3030 | tout, Event API compris |

- En mode isolé, le journal affiche
  `screenpipe[dev]: isolated from production — data …/.screenpipe-dev, api :3130, focus :11535`.
- Seul le mode données réelles a été essayé de bout en bout, et seulement avec l'installation
  d'Abel. Le mode isolé ne l'a été que d'après le code. Si votre appli installée est plus récente
  que 2.7.109, préférez le mode isolé : ce build n'a jamais tourné sur une base créée par une
  version plus récente.

## 4. Lancer le moteur Dès que

L'appli appelle le moteur à une adresse fixe, `http://127.0.0.1:4300`. Sans lui, elle affiche
« Dès que : moteur injoignable (127.0.0.1:4300) ».

```sh
cd /chemin/vers/bayscreen
bun install
cp .env.example .env
bun src/main.ts            # → http://127.0.0.1:4300
```

Dans `.env`, qui n'est jamais commité :

- `SCREENPIPE_LOCAL_API_URL` : `http://localhost:3130` en mode isolé, `http://localhost:3030` en
  mode données réelles ;
- `SCREENPIPE_LOCAL_API_KEY` : la clé de l'instance lancée (dans l'appli : Réglages > Confidentialité) ;
- `ANTHROPIC_API_KEY` : votre clé Claude.

## 5. Si une pipe échoue au lancement

Avec `pi-subagents` 0.71 ou plus, l'agent des pipes (pi 0.84.1) échoue au chargement, avec
l'erreur `(0, _piAi.toToolDeclaration) is not a function`. Chez Abel, la version est figée :

```sh
cd ~/.screenpipe-dev/pi-config/npm      # en mode données réelles : ~/.screenpipe/pi-config/npm
bun add --exact pi-subagents@0.70.1
```

Puis relancez la pipe.

## 6. Vérifier

1. Dans l'appli : une pipe → « When to run » → « Add trigger » → « Dès que… ».
2. Écrivez par exemple « dès que le prix du casque audio passe sous 80 € », puis « Ajouter ».
3. Sous la pastille s'affiche « Dès que : en attente de traduction », puis « Dès que : à valider »
   avec « accès x/y · essais x/y ».
4. « Valider » : l'état passe à « Dès que : branchée ».

Pour une page dont le prix bouge, voir dans le README la page de démo (`bun scripts/page-demo.ts`,
port 4310) et les sources d'exemple.

## Limites connues

- La pastille Event API écrit en dur dans `~/.screenpipe/pipes`. En mode isolé, la pipe arrive
  donc dans les pipes de l'appli installée, que l'instance isolée ne voit pas.
- Formule gratuite ou plan non vérifié : screenpipe ne charge que 2 pipes personnelles, les
  premières par ordre alphabétique. Event API écrit sa pipe sans passer par screenpipe (pas de
  `POST /pipes/install`), qui ne peut donc pas refuser : une pipe existante peut cesser d'être
  chargée, sans message.
- Le moteur n'accepte que l'origine `tauri://localhost` (build de l'étape 2, macOS ou Linux). Sous
  Windows et en `bun tauri dev`, il refuse l'appli, qui affiche « moteur injoignable ».
- Les textes ajoutés sont en français, sans passer par la traduction de l'appli.
- Sans le moteur, « Dès que… » et Event API restent visibles, mais la condition ne se déclenche jamais.

## Vérifié chez Abel (17/10, 20 h 14)

```
$ git format-patch 4162e6a34..des-que-fork        # 4162e6a34 est le commit de app-v2.7.109
$ git read-tree app-v2.7.109 ; git apply --cached <chaque correctif, dans l'ordre>   (index temporaire)
ok : 0001-fix-notifications-keep-chat-prompt-and-auto_send-in-.patch
ok : 0002-feat-pipes-add-a-native-D-s-que-trigger-backed-by-th.patch
ok : 0003-fix-pipes-re-sync-the-engine-on-removal-and-bound-ea.patch
ok : 0004-feat-chat-Event-API-chip-to-create-a-d-s-que-automat.patch
$ arbre obtenu == arbre de des-que-fork ?
oui, identique
$ bun x vitest run --config vitest.config.ts <les 3 fichiers de test>
 Test Files  3 passed (3)
      Tests  33 passed (33)
$ bun run test:notification-panel-actions
notification panel actions: 3 checks passed
```

Non vérifié : une compilation à partir de ces correctifs sur une autre machine, le mode isolé de
bout en bout, Windows et Linux.
