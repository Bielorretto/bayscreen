# screenpipe : ce qu'on utilise (vérifié dans le code)

Lu dans le dépôt screenpipe/screenpipe au commit d7886d6 (16 oct. 2026). Ce qui est marqué
**(vérifié)** a été observé en conditions réelles le 17 oct. avec screenpipe 0.4.52.
En cas de doute, le comportement réel gagne : le noter ici.

## Accès

- Base : `http://localhost:3030`. Le serveur n'écoute que la machine locale.
- Authentification activée par défaut : **toute** requête, même locale, porte
  `Authorization: Bearer <clé>` ; sinon **403**. Exemptées : `/health` et quelques autres.
  Pour un WebSocket : `?token=<clé>` (ou cookie `screenpipe_auth`).
- La clé : `screenpipe auth token`, ou l'appli : Réglages > Confidentialité. La commande
  n'est pas dans le PATH (vérifié) : `~/.screenpipe/cli/0.4.52/screenpipe`.
- L'aide de l'option `--api-auth` affirme que les requêtes locales sont toujours admises :
  c'est faux dans le code actuel.

## Événements en direct : WebSocket `/ws/events?token=<clé>`

Chaque message est `{ "name": string, "data": object }`. Images retirées sauf `?images=true`.

| name | data (champs utiles) | Usage |
| --- | --- | --- |
| `meeting_started` | `meeting_id`, `app`, `title`, `detection_source` | ouvre la session du copilote |
| `meeting_ended` | `meeting_id`, `duration_secs`, `meeting_end`, `transcript_segments`, `skip_pipes` ; ni `app` ni `title` (vérifié) | ferme la session, récap |
| `meeting_transcript_delta` | `meeting_id`, `item_id`, `delta`, `replace`, `device_type` (`"input"` = micro, `"output"` = son des autres), `captured_at` | texte provisoire : détection rapide de la phrase d'appel. Si `replace`, le texte remplace le précédent du même `item_id` ; `replace` toujours vrai (vérifié) |
| `meeting_transcript_final` | `meeting_id`, `item_id`, `transcript`, `speaker_name`, `session_speaker_id`, `device_type`, `captured_at` | texte définitif d'un passage ; un passage peut arriver en plusieurs finals `<item_id>:turn:N` (vérifié) |
| `meeting_status_changed` | en camelCase, comme `/meetings/status` (vérifié) | — |
| `workflow_event` | `event_type`, … | vient d'un classifieur cloud désactivé par défaut ; peu utile cette nuit |

- Sur `meeting_*` (vérifié) : `meeting_id` est un nombre, `item_id` une chaîne, `captured_at`
  une date ISO avec décalage local. Arrivent aussi, sans usage ici :
  `meeting_streaming_status_changed`, `meeting_streaming_session_started` / `_ended`, et
  `calendar_events` (≈ une fois par minute, `data = []` : un tableau, pas un objet).
- La transcription en direct des réunions passe par `screenpipe-cloud`, modèle `nova-3`
  (vérifié) : l'audio de la visio part vers un service distant. Délai mesuré : 1,7 s en
  médiane jusqu'au premier delta (4,4 s au plus), 4,7 s jusqu'au passage définitif.
- Sur cette machine, l'audio est capté **en permanence** (`audio_capture_mode=always`,
  transcription de fond en mode `batch`) (vérifié). Pour tester une visio :
  `POST /meetings/start` puis `POST /meetings/stop`.
- **Danger** : ce WebSocket accepte aussi des messages entrants et les republie sur le bus
  interne de screenpipe, ce qui peut déclencher ses pipes. On n'y envoie rien.

## Routes REST utiles

| Besoin | Route |
| --- | --- |
| Santé | `GET /health` |
| Chercher dans la mémoire | `GET /search?q=&content_type=&limit=&start_time=&end_time=&app_name=` ; `content_type` vaut `all`, `ocr`, `audio`, `input`, `accessibility` ou `memory` |
| Résumé d'activité | `GET /activity-summary?start_time=&end_time=` : les deux sont obligatoires, sinon 400 (vérifié) |
| Visio en cours ? | `GET /meetings/status` → en camelCase : `{ active, manual, manualActive, activeMeetingId, stoppableMeetingId, meetingApp, detectionSource }` (vérifié) |
| Liste des visios | `GET /meetings` |
| Transcription d'une visio | `GET /meetings/:id/transcript` → tableau nu en camelCase : `{ id, meetingId, itemId, deviceType, speakerName, transcript, capturedAt, … }` (vérifié) |
| Simuler une visio | `POST /meetings/start` `{ app?, title? }` · `POST /meetings/stop` `{}` (vérifié : 200 l'un et l'autre) |
| Ranger un récap | `POST /meetings/:id/summary` `{ summary, title? }` (summary non vide) |
| Applis externes (« ouverture ») | `GET /connections` → `{ data: [...] }`, 71 intégrations (vérifié) : Slack, Notion, Linear, Jira, Telegram, ntfy, n8n, Make, IMAP… |
| Envoyer sur Slack | `POST /connections/slack/send` `{ text, channel?, instance? }` |
| Envoyer sur Telegram | `POST /connections/telegram/send` `{ text, instance? }` |
| Dossiers mail | `GET /connections/imap/mailboxes` → `{ mailboxes: string[] }` (vérifié) |
| Lire des mails | `GET /connections/imap/messages?mailbox=&limit=&query=` → `{ messages: [{ id, from, to, subject, date }] }`, sans le corps (vérifié) ; d'après le code, pas d'autre paramètre (ni `since` ni curseur) |
| Lire un mail | `GET /connections/imap/messages/:id?mailbox=` → `{ id, from, to, subject, date, snippet, body }`, `body` en texte décodé (vérifié) |
| Autre appli connectée | `/connections/:id/proxy/<chemin de l'API>` : screenpipe ajoute l'authentification |
| Pipes screenpipe | `GET /pipes`, `POST /pipes/install`, `POST /pipes/:id/enable`, `POST /pipes/:id/run`, `GET /pipes/:id/logs` |

- IMAP : lecture seule d'après le code. Vérifié : non branché → 401 `{ error,
  reason: "auth_required", connected: false }` ; branchement par l'appli (Connexions) ou par
  `screenpipe connection set imap imap_host=… imap_port=993 username=… password=…` puis
  `screenpipe connection test imap` ; `from` vaut `"Nom <adresse>"`.

## Limites à connaître

- `GET /search?filter_pii=true` envoie le contenu à un service distant pour le filtrer :
  ne pas l'utiliser.
- Appli en formule gratuite : l'API ne remonte que **24 h** d'historique, `/raw_sql`
  répond 403, 2 pipes personnels au plus. La ligne de commande n'a pas ces limites.
- La découverte automatique de workflows de screenpipe exige la formule Business :
  la brique B fait la sienne.
- Le déclencheur vocal intégré aux pipes relit la transcription toutes les 30 s : trop
  lent pour réveiller un assistant. La brique C détecte elle-même sur les deltas.
- Licence screenpipe : usage personnel, éducatif ou évaluation (7 jours) gratuits ;
  usage commercial sous licence. On ne copie pas son code dans ce projet.
