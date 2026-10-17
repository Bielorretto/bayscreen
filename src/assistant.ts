// Propriétaire : Dev 2. Brique C, côté réponse : Claude répond à une question posée
// pendant la visio, avec toute la transcription en contexte, et peut proposer une action.

import { config } from "./config";
import { demanderJSON } from "./claude";
import type { Bus, LigneTranscription } from "./types";

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

export async function repondre(bus: Bus, meetingId: number, question: string, transcription: LigneTranscription[]) {
  bus.diffuser({ type: "question", meetingId, question });
  const texte = transcription.map((l) => `[${l.date.slice(11, 19)}] ${l.qui} : ${l.texte}`).join("\n") || "(transcription vide pour l'instant)";

  try {
    const r = await demanderJSON<ReponseAssistant>({
      modele: config.modeleRapide,
      effort: "low",
      maxTokens: 1024,
      systeme:
        "Tu es l'assistant d'une visio en cours. Réponds à la question de l'utilisateur en t'appuyant uniquement " +
        "sur la transcription fournie ; si elle ne permet pas de répondre, dis-le. Réponse courte, lisible d'un coup d'œil. " +
        `Si l'utilisateur demande explicitement une action, remplis action parmi : ${ACTIONS_COPILOTE.join(", ")}.`,
      contenu: `Transcription de la visio :\n${texte}\n\nQuestion de l'utilisateur : ${question}`,
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
