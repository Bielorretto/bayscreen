// Propriétaire : Dev 2. Les exécuteurs : ce que le moteur sait faire dans le monde extérieur.
// Ajouter un exécuteur = ajouter une entrée ici, puis l'autoriser dans les règles.

import { screenpipe, texteBrut } from "./screenpipe";
import type { Bus } from "./types";

export type Executeur = (params: Record<string, unknown>, bus: Bus) => Promise<unknown>;

/** POST /pipes/:id/run ; corps : { run_context } facultatif (sinon « {} »). Sert aussi au pont « dès que » (pipes-des-que.ts). */
export async function lancerPipe(pipe: string, corps?: { run_context?: Record<string, unknown> }) {
  const r = (await screenpipe.lancerPipe(pipe, corps)) as Record<string, unknown> | null;
  // screenpipe répond 200 même quand le pipe échoue : l'erreur est dans le corps.
  if (r && typeof r === "object" && "error" in r) throw new Error(String(r.error).slice(0, 300));
  return r;
}

function texte(params: Record<string, unknown>, cle = "text"): string {
  const v = params[cle] ?? params.texte ?? params.message;
  if (typeof v !== "string" || !v.trim()) throw new Error(`paramètre « ${cle} » manquant`);
  return v;
}

/** Une page web et rien d'autre : http ou https (ni file:, ni javascript:, ni option de commande). */
function urlWeb(v: unknown): URL | null {
  try {
    const url = new URL(String(v));
    return url.protocol === "http:" || url.protocol === "https:" ? url : null;
  } catch {
    return null;
  }
}

export const executeurs: Record<string, Executeur> = {
  /**
   * Toujours disponible : notification dans l'appli screenpipe (et dans le journal).
   * Bouton facultatif : params.lien (page http ou https) et params.libelle. Le type « link » est ouvert
   * par screenpipe lui-même : c'est le seul bouton fiable dans son panneau natif.
   */
  notifier: async (params, bus) => {
    const message = texte(params);
    bus.journaliser("alerte", `Notification : ${message}`);
    const demande = params.lien != null && String(params.lien).trim() !== "";
    const lien = demande ? urlWeb(params.lien) : null;
    // Un lien invalide n'empêche pas l'information de passer : la notification part sans bouton.
    if (demande && !lien) bus.journaliser("alerte", "notification : lien ignoré (page http ou https attendue)");
    await screenpipe.notifier({
      pipe_name: "des-que",
      title: "Dès que",
      body: texteBrut(message),
      autoDismissMs: 0,
      ...(lien && { actions: [{ id: "ouvrir", label: String(params.libelle ?? "").replace(/\s+/g, " ").trim().slice(0, 40) || "Ouvrir", type: "link" as const, url: lien.href }] }),
    });
    return { affiche: true, ...(lien && { lien: lien.href }) };
  },

  /** Message Discord par le webhook rangé dans screenpipe ; sert quand on valide depuis la page ou l'API. */
  "discord.envoyer": async (params) => screenpipe.discordEnvoyer({ content: texte(params, "content") }),

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

  /** Ouvre une page dans le navigateur par défaut. http ou https seulement : jamais file:, javascript: ni une option de `open`. */
  ouvrir: async (params) => {
    const url = urlWeb(params.url);
    if (!url) throw new Error("paramètre « url » : page http ou https attendue");
    // Environnement minimal : un navigateur lancé par open hériterait sinon des clés du .env.
    const env = Object.fromEntries(
      ["PATH", "HOME", "DISPLAY", "WAYLAND_DISPLAY", "XDG_RUNTIME_DIR", "DBUS_SESSION_BUS_ADDRESS"].flatMap((k) => (process.env[k] ? [[k, process.env[k]!]] : [])),
    );
    const p = Bun.spawn([process.platform === "darwin" ? "open" : "xdg-open", url.href], { env, stdin: "ignore", stdout: "ignore", stderr: "ignore" });
    if ((await p.exited) !== 0) throw new Error(`ouverture de la page → code ${p.exitCode}`);
    return { ouverte: url.href };
  },

  /** Lance un pipe screenpipe existant (POST /pipes/:id/run), sans contexte. */
  "pipe.lancer": async (params) => {
    if (typeof params.pipe !== "string") throw new Error("paramètre « pipe » manquant");
    return lancerPipe(params.pipe);
  },

  // TODO Dev 2 : "mail.repondre", "notion.creer", "linear.creer" via /connections/:id/proxy/...
};

export const nomsExecuteurs = () => Object.keys(executeurs);
