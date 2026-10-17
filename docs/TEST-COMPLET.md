# Test complet de « Dès que »

`bun run test:complet` vérifie les prérequis, puis joue les scènes de la démo et contrôle chaque
résultat par les API. Il lance la page de démo et le moteur s'ils ne tournent pas, puis les arrête.
Durée : environ 1 min. Il ne lit ni n'affiche aucune clé.

```sh
bun run test:complet                 # tout ; la validation Discord se fait à la main, il attend 2 min
bun run test:complet -- --discord    # valide aussi par l'API : envoie VRAIMENT un message Discord
bun run test:complet -- --mail-reel  # attend en plus un vrai mail dans le dossier IMAP (2 min)
```

Le bilan liste chaque vérification (OK, ÉCHEC ou SAUTÉ). Code de sortie : 0 si aucun échec.

## Prérequis

1. **macOS, et l'appli screenpipe installée et ouverte** : version testée app-v2.7.109, enregistrement
   d'écran autorisé. Elle tient les ports 3030 (API) et 11435 (notifications).
2. **Bun 1.4 ou plus** (testé avec 1.4.3), puis `bun install` dans le dépôt.
3. **`.env`**, copié depuis `.env.example` :
   - `SCREENPIPE_LOCAL_API_KEY` : `screenpipe auth token`, ou l'appli : Réglages > Confidentialité ;
   - `ANTHROPIC_API_KEY` : console Claude ;
   - `DISCORD_MENTION`, facultatif : identifiant Discord à mentionner (Discord > Réglages > Avancés >
     Mode développeur, puis clic droit sur la personne > Copier l'identifiant).
4. **`sources.json`** : `cp sources.exemple.json sources.json`. Le script le fait s'il manque.
5. **Discord branché dans screenpipe** : appli > Connexions > Discord, avec l'URL du webhook du salon
   (Discord > Paramètres du salon > Intégrations > Webhooks). `screenpipe connection test discord`
   envoie un vrai message de test.
6. **IMAP branché dans screenpipe**, pour le scénario avec un vrai mail :
   - Gmail avec un mot de passe d'application (compte Google > Sécurité) :
     `screenpipe connection set imap imap_host=imap.gmail.com imap_port=993 username=… password=…`,
     puis `screenpipe connection test imap` ;
   - un libellé Gmail `des-que` (le dossier sondé, voir `sources.json`) et un filtre qui y range
     les mails de test, par exemple ceux envoyés à votre adresse `+desque`.
7. **Ports 4300 et 4310 libres**, ou déjà tenus par le moteur et la page de démo : le script les
   réutilise.
8. **Écran propre** : pour un mail, le moteur envoie à Claude ce que l'écran a montré dans l'heure
   sur les mots de l'objet. Fermez ce qui est privé. Pour que la mémoire cite le devis, ouvrez
   http://127.0.0.1:4310/devis/42 une minute avant.

## Ce que fait chaque étape

| Étape | Ce qui est vérifié |
|---|---|
| 1. Prérequis | clés présentes, screenpipe ouvert, clé acceptée, Discord et IMAP branchés, dossier IMAP présent |
| 2. Tests | `bun test` et `bun run typecheck` |
| 3. Démarrage | page de démo (4310) et moteur (4300), règles chargées |
| 4. Sécurité | un autre site (Origin) et un autre nom (Host) reçoivent 403 |
| 5. Seuil | prix à 129 € puis sous 100 € : action `notifier` exécutée, notification dans screenpipe |
| 6. Mail | mail fictif : Claude propose `discord.envoyer`, notification « Voir et valider » ; puis validation |
| 7. Vrai mail | avec `--mail-reel` : un mail reçu par IMAP donne une proposition |

Valider à la main : cliquez « Voir et valider » dans la notification screenpipe. La page du moteur
s'ouvre : cliquez « Valider ». Le message part sur Discord, et le script le constate.

## Dépannage

| Symptôme | Cause | Que faire |
|---|---|---|
| `.env : manque …` | clé absente | remplir `.env` (prérequis 3) |
| `API screenpipe : réponse 403` | mauvaise clé screenpipe | `screenpipe auth token`, puis `.env` |
| `IMAP non branché ou dossier absent` | IMAP pas configuré, ou libellé absent | prérequis 6 ; le reste du test marche sans IMAP |
| `moteur ne répond pas` | port 4300 pris par autre chose, ou `.env` invalide | lire `data/test-complet-moteur.log` |
| `aucune action en 20 s` au seuil | règle `exemple-seuil` absente, ou source web autre que 4310 | vérifier `regles.json` et `sources.json` |
| action exécutée mais `aucune notification` | screenpipe ignore une notification identique pendant 90 s (`gate.rs:264`) | relancer : le script change le prix à chaque passage |
| `aucune proposition` au mail | clé Claude, ou règle `exemple-mail` absente | lire `data/test-complet-moteur.log` |
| la notification disparaît | une notification plus récente la remplace : le panneau n'en montre qu'une | la retrouver dans la cloche : appli > Automations > icône cloche |
| pas de bouton « Refuser » | screenpipe ne l'affiche jamais | refuser dans la page du moteur |

Pour voir l'envoi Discord côté screenpipe :
`tail -n0 -F ~/.screenpipe/screenpipe-app.$(date -u +%F).log | grep --line-buffered -o "upstream_status=[0-9]*"`
(204 = reçu par Discord).
