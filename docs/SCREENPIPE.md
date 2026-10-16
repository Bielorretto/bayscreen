# screenpipe : ce qu'on utilise (vérifié dans le code)

Vérifié dans le dépôt screenpipe/screenpipe au commit d7886d6 (16 oct. 2026), en lisant
le code, **pas testé en conditions réelles**. En cas de doute, le comportement réel gagne :
le noter ici.

## Accès

- Base : `http://localhost:3030`. Le serveur n'écoute que la machine locale.
- Authentification activée par défaut : **toute** requête, même locale, porte
  `Authorization: Bearer <clé>` ; sinon **403**. Exemptées : `/health` et quelques autres.
  Pour un WebSocket : `?token=<clé>` (ou cookie `screenpipe_auth`).
- La clé : `screenpipe auth token`, ou l'appli : Réglages > Confidentialité.
- L'aide de l'option `--api-auth` affirme que les requêtes locales sont toujours admises :
  c'est faux dans le code actuel.

## Événements en direct : WebSocket `/ws/events?token=<clé>`

Chaque message est `{ "name": string, "data": object }`. Images retirées sauf `?images=true`.

| name | data (champs utiles) | Usage |
| --- | --- | --- |
| `meeting_started` | `meeting_id`, `app`, `title`, `detection_source` | ouvre la session du copilote |
| `meeting_ended` | `meeting_id` (ou `id`), `app`, `title` | ferme la session, récap |
| `meeting_transcript_delta` | `meeting_id`, `item_id`, `delta`, `replace`, `device_type` (`"input"` = micro, `"output"` = son des autres), `captured_at` | texte provisoire : détection rapide de la phrase d'appel. Si `replace`, le texte remplace le précédent du même `item_id` |
| `meeting_transcript_final` | `meeting_id`, `item_id`, `transcript`, `speaker_name`, `device_type`, `captured_at` | texte définitif d'un passage |
| `workflow_event` | `event_type`, … | vient d'un classifieur cloud désactivé par défaut ; peu utile cette nuit |

- La transcription en direct des réunions est activée par défaut et utilise le moteur de
  transcription choisi par l'utilisateur. **Délai à mesurer en phase 0.**
- Sur une installation récente de l'appli, l'audio n'est enregistré **que pendant une
  réunion détectée** ; pour tester : `POST /meetings/start` puis `POST /meetings/stop`.
- **Danger** : ce WebSocket accepte aussi des messages entrants et les republie sur le bus
  interne de screenpipe, ce qui peut déclencher ses pipes. On n'y envoie rien.

## Routes REST utiles

| Besoin | Route |
| --- | --- |
| Santé | `GET /health` |
| Chercher dans la mémoire | `GET /search?q=&content_type=&limit=&start_time=&end_time=&app_name=` ; `content_type` vaut `all`, `ocr`, `audio`, `input`, `accessibility` ou `memory` |
| Résumé d'activité | `GET /activity-summary` |
| Visio en cours ? | `GET /meetings/status` → `{ active, active_meeting_id, meeting_app, detection_source, … }` |
| Liste des visios | `GET /meetings` |
| Transcription d'une visio | `GET /meetings/:id/transcript` → segments `{ item_id, device_type, … }` |
| Simuler une visio | `POST /meetings/start` `{ app?, title? }` · `POST /meetings/stop` |
| Ranger un récap | `POST /meetings/:id/summary` `{ summary, title? }` (summary non vide) |
| Applis externes (« ouverture ») | `GET /connections` (≈ 60 intégrations : Slack, Notion, Linear, Jira, Telegram, ntfy, n8n, Make, IMAP…) |
| Envoyer sur Slack | `POST /connections/slack/send` `{ text, channel?, instance? }` |
| Envoyer sur Telegram | `POST /connections/telegram/send` `{ text, instance? }` |
| Lire des mails | `GET /connections/imap/messages` (paramètres à vérifier) |
| Autre appli connectée | `/connections/:id/proxy/<chemin de l'API>` : screenpipe ajoute l'authentification |
| Pipes screenpipe | `GET /pipes`, `POST /pipes/install`, `POST /pipes/:id/enable`, `POST /pipes/:id/run`, `GET /pipes/:id/logs` |

## Limites à connaître

- Appli en formule gratuite : l'API ne remonte que **24 h** d'historique, `/raw_sql`
  répond 403, 2 pipes personnels au plus. La ligne de commande n'a pas ces limites.
- La découverte automatique de workflows de screenpipe exige la formule Business :
  la brique B fait la sienne.
- Le déclencheur vocal intégré aux pipes relit la transcription toutes les 30 s : trop
  lent pour réveiller un assistant. La brique C détecte elle-même sur les deltas.
- Licence screenpipe : usage personnel, éducatif ou évaluation (7 jours) gratuits ;
  usage commercial sous licence. On ne copie pas son code dans ce projet.
