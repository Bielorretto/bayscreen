# Vidéo de démo « Dès que »

Fichiers fictifs uniquement (domaines `.example`, ISS publique). Les commandes se lancent depuis la racine du dépôt.

## Préparer (une fois, puis avant chaque prise)

```bash
cp scripts/demo-video/sources.exemple.json scripts/demo-video/sources.json
cp scripts/demo-video/regles.local.exemple.json scripts/demo-video/regles.local.json
```

Ces deux copies sont ignorées par git. Le moteur réécrit `regles.local.json` quand on clique « Créer la règle » : recopier avant de refaire une prise.

## Lancer

Terminal 1, page de démo (boutique du casque, distance de l'ISS) :

```bash
bun scripts/page-demo.ts
```

Terminal 2, moteur :

```bash
D=scripts/demo-video && PORT=4300 SCREENPIPE_LOCAL_API_URL=http://localhost:3030 FICHIER_REGLES=regles.json FICHIER_REGLES_LOCALES=$D/regles.local.json FICHIER_SOURCES=$D/sources.json FICHIER_TACHES=$D/taches.json FICHIER_PIPES_DES_QUE=/tmp/des-que-pipes-demo.json bun src/main.ts
```

Puis `bash scripts/demo-video/prix.sh 129` : remet le prix, et la première fois macOS demande d'autoriser le contrôle de Chrome.

Écran partagé : à gauche Chrome sur `http://127.0.0.1:4310` (la boutique), à droite `http://127.0.0.1:4300` (Dès que). Ne pas filmer les terminaux ni le Journal : la source `app_active` y écrit les vrais titres de fenêtres.

## Tourner

| # | À l'écran | Action | Voix off |
|---|---|---|---|
| 1 | Page Dès que | aucune | « Dès que, c'est la mémoire de screenpipe qui passe à l'action : *dès que X, fais Y*. » |
| 2 | Règles armées | faire défiler | « Plusieurs déclencheurs tournent en même temps : une boutique, la position de l'ISS… » |
| 3 | Casque | `bash scripts/demo-video/prix.sh 95` (hors champ) | « Le prix tombe à 95 €… » Notification en 2 à 5 s. |
| 4 | ISS | attendre la notification | « …et dès que l'ISS passe au-dessus de l'Europe, je suis prévenu. » |
| 5 | Propositions | « Ce qu'on peut automatiser » → Actualiser → Créer la règle | « *Propose-moi des automatisations* : il les tire de ce que j'ai fait. » |
| 6 | Fin | arrêter l'enregistrement, `prix.sh 129` | aucune |

## Règles ISS

L'ISS fait le tour de la Terre en 93 min environ, donc plusieurs règles se déclenchent à chaque tour :

- passage de l'équateur, vers le nord et vers le sud ;
- passage à la latitude de Paris ;
- distance de Paris sous 4 000 km, puis sous 2 000 km ;
- distance de Bordeaux sous 1 500 km ;
- distance de Paris sous 1 000 km : ouvre la carte.

Les seuils sont en x,5 (3 999,5 km…) : les comparaisons sont strictes, et une distance arrondie pile sur le seuil ne franchirait rien.

La règle du casque (`exemple-seuil`) vient de `regles.json`.
