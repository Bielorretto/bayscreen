// Propriétaire : Dev 2. Les exécuteurs : ce que le moteur sait faire dans le monde extérieur.
// Ajouter un exécuteur = ajouter une entrée ici, puis l'autoriser dans les règles.

import { screenpipe, texteBrut } from "./screenpipe";
import type { Bus } from "./types";

export type Executeur = (params: Record<string, unknown>, bus: Bus) => Promise<unknown>;

function texte(params: Record<string, unknown>, cle = "text"): string {
  const v = params[cle] ?? params.texte ?? params.message;
  if (typeof v !== "string" || !v.trim()) throw new Error(`paramètre « ${cle} » manquant`);
  return v;
}

export const executeurs: Record<string, Executeur> = {
  /** Toujours disponible : notification dans l'appli screenpipe (et dans le journal). */
  notifier: async (params, bus) => {
    const message = texte(params);
    bus.journaliser("alerte", `Notification : ${message}`);
    await screenpipe.notifier({ pipe_name: "des-que", title: "Dès que", body: texteBrut(message), autoDismissMs: 0 });
    return { affiche: true };
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
    let url: URL;
    try {
      url = new URL(String(params.url));
    } catch {
      throw new Error("paramètre « url » invalide");
    }
    if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("paramètre « url » : http ou https seulement");
    // Environnement minimal : un navigateur lancé par open hériterait sinon des clés du .env.
    const env = Object.fromEntries(
      ["PATH", "HOME", "DISPLAY", "WAYLAND_DISPLAY", "XDG_RUNTIME_DIR", "DBUS_SESSION_BUS_ADDRESS"].flatMap((k) => (process.env[k] ? [[k, process.env[k]!]] : [])),
    );
    const p = Bun.spawn([process.platform === "darwin" ? "open" : "xdg-open", url.href], { env, stdin: "ignore", stdout: "ignore", stderr: "ignore" });
    if ((await p.exited) !== 0) throw new Error(`ouverture de la page → code ${p.exitCode}`);
    return { ouverte: url.href };
  },

  /** Lance un pipe screenpipe existant (POST /pipes/:id/run). */
  "pipe.lancer": async (params) => {
    if (typeof params.pipe !== "string") throw new Error("paramètre « pipe » manquant");
    const r = (await screenpipe.lancerPipe(params.pipe)) as Record<string, unknown> | null;
    // screenpipe répond 200 même quand le pipe échoue : l'erreur est dans le corps.
    if (r && typeof r === "object" && "error" in r) throw new Error(String(r.error).slice(0, 300));
    return r;
  },

  // TODO Dev 2 : "mail.repondre", "notion.creer", "linear.creer" via /connections/:id/proxy/...
};

export const nomsExecuteurs = () => Object.keys(executeurs);
