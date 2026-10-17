# « Dès que X, fais Y » — les cas d'usage

Le produit : l'utilisateur décrit un réflexe métier **en une phrase, dans le chat de l'app screenpipe** (« dès qu'Etto m'envoie un mail, préviens-moi »). Notre moteur traduit le « dès que » en règle, crée au besoin la source qui l'écoute, et déclenche la pipe screenpipe **à la seconde où la réalité se produit** — sans chrono, sans site web, sans clic.

## La chaîne complète (validée en réel)

```
phrase dans le chat screenpipe
→ pipe.md créé par l'agent de screenpipe (déclencheur « custom », en liste)
→ notre moteur : traduction du « dès que » par Claude (règle déterministe + essais rejoués)
→ branchement automatique : la phrase de l'utilisateur vaut validation
→ au besoin : la SOURCE qui écoute est créée aussi (API publique, regex, intervalle)
→ l'événement réel arrive (mail, seuil franchi, application ouverte, visio…)
→ règle → pipe.lancer → l'agent de screenpipe exécute → notification dans l'app
```

## Règles produit (17/10)

1. **Une pipe créée par l'utilisateur se branche seule** — sa phrase dans le chat vaut validation. Seul un déclencheur **modifié après coup** redemande un geste.
2. **Tout vit dans screenpipe** : création, déclenchement, notification. La page web (`127.0.0.1:4300`) n'est jamais une étape obligatoire.
3. Les **actions qui agissent dehors** (envoi, écriture, dépense) se valident toujours — via les boutons de la notification native screenpipe (en cours de câblage).

## Catalogue par famille d'événement

| Famille | Exemple de phrase | État |
|---|---|---|
| **Mail** (IMAP) | *« dès qu'Etto m'envoie un mail »*, *« ...un mail contient 'urgent' »* | **Validé en réel** |
| **Valeur externe** (API publique, auto-créée) | *« dès que le bitcoin dépasse 50000 »*, *« ...le taux EUR/USD dépasse 1,10 »* | **Validé en réel** (CoinGecko, cours lu en direct) |
| **Page surveillée** | *« dès que le prix du casque dépasse 100 »* | **Validé en réel** |
| **Visio** (début/fin, copilote) | *« dès qu'une réunion se termine, envoie le compte-rendu »* | **Validé en réel** (réveil à la voix + citations) |
| **Application active** | *« dès que j'ouvre Word/mon document d'enquête »* | Code en place, règle active — dernier test en attente |
| **Webhook** (le monde pousse vers nous) | *« dès qu'un paiement Stripe arrive »* | Prêt dans le moteur, à éprouver |
| *À venir* : texte à l'écran, presse-papiers, phrase libre hors visio, mémoires d'équipe | — | Roadmap |

## Cas d'usage par métier

### Validés en réel (jouables à la démo)

| Métier | Le cas | La phrase |
|---|---|---|
| Tout métier avec clients | **Le mail qui compte** | *« dès qu'Etto m'envoie un mail, envoie une notification bonjour »* — prouvé de bout en bout |
| Finance / crypto | **Le seuil de marché** | *« dès que le bitcoin dépasse 50000 »* — source inventée seule, vrai cours, déclenché en direct |
| Tout métier en réunions | **La fin de visio** | réveil à la voix, réponse avec citations, compte-rendu à la fin |
| E-commerce / achats | **La page qui bouge** | prix modifié → franchissement de seuil → notification |

### Jouables avec le déclencheur « application active »

| Métier | Le cas | La phrase |
|---|---|---|
| **Journaliste** | *« dès que j'écris mon enquête sur Word, source ce que je dis »* | le déclencheur : Word s'ouvre ; le contenu : lu dans l'écran par screenpipe ; le sourcement : l'historique de recherche du journaliste + le web |
| **Toute démarche administrative** | *« dès que je suis sur un document administratif, remplis-le à ma place »* | formulaire web : rempli par le navigateur pilotable de screenpipe ; les données : celles que l'historique a déjà vues ; validation avant envoi |

### À construire (un maillon)

| Métier | Le cas | Ce qui manque |
|---|---|---|
| Candidat / commercial / RH | **La relance à T+5 si silence** | la minuterie « à T+X si pas de réponse » — la version dégradée (cron natif screenpipe qui vérifie chaque jour) est jouable dès maintenant |
| Support client | *« dès qu'un client dit 'ça remarche pas', retrouve la manip que je lui avais montrée »* | habillage de pipe sur briques existantes |
| Comptabilité | *« dès que le taux EUR/USD dépasse X, préviens-moi »* | validé par le cas crypto, à transposer |
| RH | *« dès qu'un candidat écrit, résume son mail »* | jugement sémantique dans la pipe (prouvé par la règle Discord de Dev 1) |

### La vision B2B : la mémoire collective

> *« Dès qu'on me redemande un chiffre que j'ai eu devant les yeux — ou qu'une personne de ma team l'a eu — donne-le. »*

L'équipe se souvient : chaque membre garde son historique screenpipe **sur sa machine**, la question déclenche une recherche fédérée, la réponse arrive avec **qui l'a vu, quand, où**. Les données ne quittent jamais les machines — seules les réponses ciblées circulent. À construire : le relais inter-moteurs.

## Les trois démos cibles (pour la vidéo)

1. **Le journaliste** — « dès que j'écris mon enquête sur Word, source ce que je dis » : l'écran devient la source du déclencheur ET du contenu, la fiche de vérification cite les sources vues à l'écran.
2. **La relance à J+5** — « dès qu'on me dit qu'ils reviennent vers moi, relance après 5 jours de silence » : le compte à rebours (à construire en version élégante).
3. **Le document administratif** — « dès que je l'ouvre, remplis-le » : les données viennent de l'historique, le formulaire du navigateur pilotable, la validation avant l'envoi.

## Limites connues (17/10)

- **Bug screenpipe** : l'extension `pi-subagents` (réinstallée par l'app à chaque redémarrage) est incompatible avec le `pi-ai` embarqué et tue l'agent des pipes. **Contournée** : notre moteur la retire avant chaque lancement de pipe et au démarrage (`src/fixes/pi-subagents.ts`).
- **Le profil d'économie d'énergie** de screenpipe coupe la capture sur batterie — trois fois ce soir. Si l'écran n'est plus capturé, les déclencheurs « application active » et « texte à l'écran » deviennent sourds.
- L'app doit être **installée dans `/Applications`** (elle tournait depuis l'image disque : état qui se coince, mises à jour bloquées).
- Les tests de branchement (`pipes-des-que.test.ts`) encodent l'ancienne règle « tout se valide » : à mettre à jour pour la règle « pipe fraîche = branchée seule ».
