// Propriétaire : Dev 2. Les exécuteurs : ce que le moteur sait faire dans le monde extérieur.
// Ajouter un exécuteur = ajouter une entrée ici, puis l'autoriser dans les règles.

import { screenpipe } from "./screenpipe";
import type { Bus } from "./types";

export type Executeur = (params: Record<string, unknown>, bus: Bus) => Promise<unknown>;

function texte(params: Record<string, unknown>, cle = "text"): string {
  const v = params[cle] ?? params.texte ?? params.message;
  if (typeof v !== "string" || !v.trim()) throw new Error(`paramètre « ${cle} » manquant`);
  return v;
}

export const executeurs: Record<string, Executeur> = {
  /** Toujours disponible : affiche une notification dans la page (et dans le journal). */
  notifier: async (params, bus) => {
    const message = texte(params);
    bus.journaliser("alerte", `Notification : ${message}`);
    return { affiche: true };
  },

  /** Message Slack via la connexion Slack de screenpipe (la connecter dans l'appli d'abord). */
  "slack.envoyer": async (params) =>
    screenpipe.slackEnvoyer({
      text: texte(params),
      channel: typeof params.channel === "string" ? params.channel : undefined,
    }),

  /** Message Telegram via la connexion Telegram de screenpipe. */
  "telegram.envoyer": async (params) => screenpipe.telegramEnvoyer({ text: texte(params) }),

  /** POST JSON vers une URL (n8n, Make, un serveur à vous…). */
  webhook: async (params) => {
    const url = params.url;
    if (typeof url !== "string" || !url.startsWith("http")) throw new Error("paramètre « url » invalide");
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(params.corps ?? params),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) throw new Error(`webhook → ${res.status}`);
    return { statut: res.status };
  },

  /** Lance un pipe screenpipe existant (POST /pipes/:id/run). */
  "pipe.lancer": async (params) => {
    if (typeof params.pipe !== "string") throw new Error("paramètre « pipe » manquant");
    return screenpipe.lancerPipe(params.pipe);
  },

  // TODO Dev 2 : "mail.repondre", "notion.creer", "linear.creer" via /connections/:id/proxy/...
};

export const nomsExecuteurs = () => Object.keys(executeurs);
