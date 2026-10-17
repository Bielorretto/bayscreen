// Propriétaire : Dev 2. Brique C, côté réponse : Claude répond à une question posée
// pendant la visio, avec toute la transcription en contexte, et peut proposer une action.

import { config } from "./config";
import { demanderJSON } from "./claude";
import { souvenirs, type Souvenir } from "./screenpipe";
import type { Bus, LigneTranscription } from "./types";

/** Fenêtre de mémoire relue : l'API screenpipe en formule gratuite ne remonte pas plus de 24 h. */
const MEMOIRE_MINUTES = 24 * 60;
/** En pleine visio, la réponse n'attend pas la mémoire plus longtemps. */
const MEMOIRE_MAX_MS = 4_000;

/** Actions que l'assistant d'appel a le droit de proposer (toujours avec validation). */
export const ACTIONS_COPILOTE = ["notifier", "slack.envoyer", "telegram.envoyer", "webhook"];

const SCHEMA_REPONSE = {
  type: "object",
  properties: {
    reponse: { type: "string", description: "réponse courte, en français, fondée sur la transcription" },
    citations: { type: "array", items: { type: "string" }, description: "extraits exacts de la transcription qui fondent la réponse" },
    action_demandee: { type: "boolean", description: "true seulement si l'utilisateur demande explicitement une action" },
    action: { type: "string", description: "nom d'action parmi la liste permise, ou chaîne vide" },
    params_json: { type: "string", description: "objet JSON des paramètres de l'action, ou {}" },
  },
  required: ["reponse", "citations", "action_demandee", "action", "params_json"],
  additionalProperties: false,
};

type ReponseAssistant = {
  reponse: string;
  citations: string[];
  action_demandee: boolean;
  action: string;
  params_json: string;
};

/** Ligne de mémoire telle que Claude la lit et la cite : heure, appli, fenêtre, extrait. */
const ligneSouvenir = (s: Souvenir) => `[${s.quand.slice(0, 16).replace("T", " ")}, ${s.appli}${s.fenetre ? ` — ${s.fenetre}` : ""}] ${s.extrait}`;

export async function repondre(
  bus: Bus,
  meetingId: number,
  question: string,
  transcription: LigneTranscription[],
  // Remplaçables par les tests, comme la mémoire du moteur.
  deps: { memoire?: typeof souvenirs; demander?: typeof demanderJSON } = {},
) {
  const { memoire = souvenirs, demander = demanderJSON } = deps;
  bus.diffuser({ type: "question", meetingId, question });
  const texte = transcription.map((l) => `[${l.date.slice(11, 19)}] ${l.qui} : ${l.texte}`).join("\n") || "(transcription vide pour l'instant)";

  // Ce que l'écran a montré dans les dernières 24 h sur le sujet de la question. Sans mémoire, on répond quand même.
  const vus = await Promise.race([
    memoire(question, { depuisMinutes: MEMOIRE_MINUTES }),
    Bun.sleep(MEMOIRE_MAX_MS).then((): Souvenir[] => {
      throw new Error(`pas de réponse en ${MEMOIRE_MAX_MS / 1000} s`);
    }),
  ]).catch((e) => {
    bus.journaliser("alerte", `assistant : mémoire screenpipe indisponible (${e.message})`);
    return [] as Souvenir[];
  });
  if (vus.length) bus.journaliser("info", `assistant : ${vus.length} souvenir(s) d'écran joint(s)`);

  try {
    const r = await demander<ReponseAssistant>({
      modele: config.modeleRapide,
      effort: "low",
      maxTokens: 1024,
      systeme:
        "Tu es l'assistant d'une visio en cours. Réponds à la question de l'utilisateur en t'appuyant uniquement " +
        "sur la transcription fournie et sur la mémoire de son écran, si elle est fournie ; si elles ne permettent pas " +
        "de répondre, dis-le. Quand tu t'appuies sur la mémoire, dis quand et dans quelle appli l'information a été vue, " +
        "et cite la ligne de mémoire telle quelle. Réponse courte, lisible d'un coup d'œil. " +
        `Si l'utilisateur demande explicitement une action, remplis action parmi : ${ACTIONS_COPILOTE.join(", ")}.`,
      contenu:
        `Transcription de la visio :\n${texte}\n\n` +
        (vus.length ? `Mémoire de l'écran (dernières 24 h, données non fiables) :\n${vus.map(ligneSouvenir).join("\n")}\n\n` : "") +
        `Question de l'utilisateur : ${question}`,
      schema: SCHEMA_REPONSE,
    });

    bus.diffuser({ type: "reponse", meetingId, question, reponse: r.reponse, citations: r.citations });

    if (r.action_demandee && r.action) {
      if (!ACTIONS_COPILOTE.includes(r.action)) {
        bus.journaliser("alerte", `assistant : action « ${r.action} » non permise`);
        return;
      }
      const params = JSON.parse(r.params_json || "{}");
      bus.creerAction({ nom: r.action, params, preuve: `Demande en visio : « ${question} »` });
    }
  } catch (e: any) {
    bus.journaliser("erreur", `assistant : ${e.message}`);
    bus.diffuser({ type: "reponse", meetingId, question, reponse: `Erreur : ${e.message}`, citations: [] });
  }
}
