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

**Mise à jour (17/10 au soir, décisions d'équipe)** : les actions d'une règle s'exécutent désormais sans validation, mais seulement les actions permises par la règle, vers les **destinations fixées par la règle**, jamais choisies par Claude (`CLAUDE.md`, 0514f19). Exception gardée : **le copilote de visio garde la validation**, car il lit une transcription non fiable et Claude y choisit l'action.

## Catalogue par famille d'événement

| Famille | Exemple de phrase | État |
|---|---|---|
| **Mail** (IMAP) | *« dès qu'Etto m'envoie un mail »*, *« ...un mail contient 'urgent' »* | **Validé en réel** |
| **Valeur externe** (API publique, auto-créée) | *« dès que le bitcoin dépasse 50000 »*, *« ...le taux EUR/USD dépasse 1,10 »* | **Validé en réel** (CoinGecko, cours lu en direct) |
| **Page surveillée** | *« dès que le prix du casque dépasse 100 »* | **Validé en réel** |
| **Visio** (début/fin, copilote) | *« dès qu'une réunion se termine, envoie le compte-rendu »* | **Validé en réel** (réveil à la voix + citations) |
| **Mémoire de l'écran** (copilote) | *« OK Claude, quel était le prix du casque audio ? »* | **Validé en réel** (18/10 : question posée naturellement, réponse citée en 2,1 s, avec l'heure et l'appli où l'information a été vue) |
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

## Classement B2C / B2B (18/10)

Les cas ci-dessus, rangés par public, avec leur état. On ne montre jamais un cas « à construire » comme s'il marchait.

| Public | Cas | État |
|---|---|---|
| B2C | **« Tu te souviens du prix ? »** : le copilote retrouve un prix vu à l'écran, cité avec l'heure et l'appli | Validé en réel |
| B2C | **Le prix qui baisse** : « dès que le casque passe sous 100 € » | Validé en réel |
| B2C | **La source qui se crée seule** : « dès que le bitcoin dépasse 50000 » | Validé en réel |
| B2C | **L'administratif** : « dès que je l'ouvre, remplis-le » | À construire |
| B2C | **La relance promise** : « relance après 5 jours de silence » | À construire (version quotidienne jouable) |
| B2B | **Le commercial en visio** : « OK Claude, quel prix j'avais donné pour ce devis ? », puis envoi sur Slack validé d'un clic | Validé en réel |
| B2B | **Le mail qui compte**, avec le rappel de ce qu'on avait vu sur le dossier | Validé (chaîne mail) ; souvenirs joints à répéter |
| B2B | **La veille marché** : « dès que le taux EUR/USD dépasse 1,10 » | Validé (même mécanisme que le bitcoin) |
| B2B | **Le support client**, **le journaliste** | Jouables |
| B2B | **La mémoire collective** | À construire (la vision) |

## Le fil de la vidéo (18/10)

Pour la vidéo, un fil unique construit **uniquement sur des cas validés en réel** ; les trois démos cibles ci-dessous restent la suite.

1. **L'accroche** : « screenpipe se souvient, mais il ne réagit à rien. On lui a donné des réflexes. »
2. **La veille** : une commerciale fictive (Léa, Atelier Lumen) prépare un devis à 1 290 € HT.
3. **En visio** : « OK Claude, quel prix j'avais donné pour ce devis ? » → réponse en ~2 s avec la citation de l'écran ; puis « envoie le récap sur Slack » → carte à valider, un clic.
4. **Un réflexe en une phrase** : « dès que le casque passe sous 100 € » dans « Add trigger → Dès que… », puis la notification en direct.
5. **Le mail avec son contexte** (si répété avant, sinon coupé).
6. **La vision** : la mémoire collective, annoncée comme « demain ».

Données fictives seulement, aucune clé à l'écran, accord des personnes filmées. Démo de secours : la vidéo, la question tapée dans la page, et l'événement envoyé à la main (`bun run evt web valeur_changee …`).

## Les trois démos cibles (pour la vidéo)

1. **Le journaliste** — « dès que j'écris mon enquête sur Word, source ce que je dis » : l'écran devient la source du déclencheur ET du contenu, la fiche de vérification cite les sources vues à l'écran.
2. **La relance à J+5** — « dès qu'on me dit qu'ils reviennent vers moi, relance après 5 jours de silence » : le compte à rebours (à construire en version élégante).
3. **Le document administratif** — « dès que je l'ouvre, remplis-le » : les données viennent de l'historique, le formulaire du navigateur pilotable, la validation avant l'envoi.

## Limites connues (17/10)

- **Bug screenpipe** : l'extension `pi-subagents` (réinstallée par l'app à chaque redémarrage) est incompatible avec le `pi-ai` embarqué et tue l'agent des pipes. **Contournée** : notre moteur la retire avant chaque lancement de pipe et au démarrage (`src/fixes/pi-subagents.ts`).
- **Le profil d'économie d'énergie** de screenpipe coupe la capture sur batterie — trois fois ce soir. Si l'écran n'est plus capturé, les déclencheurs « application active » et « texte à l'écran » deviennent sourds.
- L'app doit être **installée dans `/Applications`** (elle tournait depuis l'image disque : état qui se coince, mises à jour bloquées).
- Les tests de branchement (`pipes-des-que.test.ts`) encodent l'ancienne règle « tout se valide » : à mettre à jour pour la règle « pipe fraîche = branchée seule ».

## Ajouts du 18/10

- **Mémoire de l'écran corrigée** (0693616) : une question posée naturellement (« quel était le prix… ») ne trouvait rien. Les mots interrogatifs prenaient la place des mots utiles, et l'audio, capté en permanence, occupait les 10 résultats de la recherche. La recherche ne porte plus que sur le texte d'écran.
- **Règles communes et règles locales** (ebb5e60) : `regles.json` ne contient que les règles communes et n'est plus réécrit par le moteur ; les pipes et règles propres à une machine vont dans `regles.local.json`, hors git. Migration à faire une fois avant de tirer (message REGLES-LOCALES du canal d'équipe).
- **La mémoire voit tout**, presse-papiers compris : pour la démo, session propre et données fictives.
- **Les tests de branchement rouges** (40 sur 107) laissent aussi sans vérification les garanties de sécurité du pont (la pipe ne reçoit jamais le texte d'un mail, une pipe retirée n'est plus lancée) : ils échouent dès l'étape du clic, avant de les vérifier.
