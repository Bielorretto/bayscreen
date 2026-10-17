# Correctif screenpipe : bouton « chat » du panneau de notification macOS

Ce dossier contient seulement notre patch, pas le code de screenpipe. Le dépôt est public, et la
licence de screenpipe n'accorde pas de droit de redistribution ; les modifications appartiennent
à Screenpipe (LICENSE.md, §2 et §6). Le patch est destiné à être proposé au fondateur.

## Le bug

Sur macOS, le panneau natif des notifications réencode le bouton cliqué à partir de la structure
Swift `NotificationAction` (`notification_panel.swift`, `onAction` → `JSONEncoder`) avant de le
passer à Rust. Cette structure n'avait ni `prompt` ni `auto_send`. Un bouton `chat` documenté
(SKILL.md de screenpipe-api) ouvrait donc un chat sans sa consigne, et `auto_send: false` était perdu.

Correctif : 2 lignes de Swift, plus un test de régression compilé par `swiftc` seul.

## Appliquer et tester (macOS, une minute, sans compiler l'appli)

```sh
git clone https://github.com/screenpipe/screenpipe.git && cd screenpipe
git checkout app-v2.7.109
git am /chemin/vers/des-que/screenpipe-correctif/0001-*.patch
cd apps/screenpipe-app-tauri
bun run test:notification-panel-actions
```

Attendu : `notification panel actions: 3 checks passed`. Sans le patch, le même test échoue sur
`FAIL: prompt survives the click`.

## Compiler l'appli (facultatif, pour la voir corrigée)

Il faut Rust 1.94.0 en aarch64 (`rust-toolchain.toml` du dépôt), un `cmake` arm64 et les outils
en ligne de commande de Xcode.

```sh
export CMAKE_POLICY_VERSION_MINIMUM=3.5
export CMAKE=/chemin/absolu/vers/des-que/screenpipe-correctif/cmake-sans-native.sh
cd apps/screenpipe-app-tauri && bun install
bun tauri build --no-bundle --config '{"identifier":"screenpi.pe.dev"}' -- --profile debug-dev
```

- Chez Abel, la build a pris environ 11 min. La première tentative a échoué dans `whisper-rs-sys`
  (option `-mcpu` refusée) ; `CMAKE` ci-dessus corrige ce point.
- L'identifiant `screenpi.pe.dev` est indispensable : avec celui de l'appli installée, le fork se
  ferme si l'appli tourne, et une réinitialisation de permission toucherait l'appli installée.
- Lancement : `./src-tauri/target/debug-dev/screenpipe-app`. Le journal doit afficher
  `screenpipe[dev]: isolated from production — data …/.screenpipe-dev, api :3130, focus :11535`.
  Dans le fork, ne cliquer sur aucun bouton de permission ni de chiffrement, et le quitter après l'essai.
