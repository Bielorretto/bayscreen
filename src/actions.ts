// Propriétaire : Dev 2. Les exécuteurs : ce que le moteur sait faire dans le monde extérieur.
// Ajouter un exécuteur = ajouter une entrée ici, puis l'autoriser dans les règles.

import { screenpipe, texteBrut, type BoutonNotification } from "./screenpipe";
import type { Bus } from "./types";

export type Executeur = (params: Record<string, unknown>, bus: Bus) => Promise<unknown>;

/**
 * POST /pipes/:id/run ; corps : { run_context } facultatif (sinon « {} »). Sert aussi au pont « dès que » (pipes-des-que.ts).
 * screenpipe répond tout de suite, la pipe tourne ensuite : avec un bus, son sort est suivi à part (suivreExecution).
 */
export async function lancerPipe(pipe: string, corps?: { run_context?: Record<string, unknown> }, bus?: Bus) {
  const r = (await screenpipe.lancerPipe(pipe, corps)) as Record<string, unknown> | null;
  // screenpipe répond 200 même quand le pipe échoue : l'erreur est dans le corps.
  if (r && typeof r === "object" && "error" in r) throw new Error(String(r.error).slice(0, 300));
  // Sans await : ni l'exécuteur ni emettre, qui l'attend (et POST /api/evenements avec lui), n'attendent la fin de la pipe.
  const execution = Number(r?.execution_id);
  if (bus && Number.isSafeInteger(execution) && execution > 0) void suivreExecution(pipe, execution, bus);
  return r;
}

/** Relevé d'une exécution lancée : toutes les 3 s, 15 min au plus (réglable par les tests). */
export const suivi = { pasMs: 3_000, limiteMs: 15 * 60_000 };

/**
 * Relève l'exécution jusqu'à un statut final (queued et running ne le sont pas), ou la limite ; ne lève jamais.
 * completed, ou cancelled (arrêt demandé, neutre pour screenpipe aussi) : une ligne d'info. Autre statut final (failed,
 * timed_out…) : une alerte au journal et UNE notification screenpipe, avec la cause et comment débloquer.
 * stderr et error_message peuvent contenir ce que la pipe a lu (écran, mails) :
 * ils ne vont qu'au corps de la notification, nettoyés (causeLisible), jamais au journal, que GET /api/etat sert à toute requête locale.
 */
async function suivreExecution(pipe: string, execution: number, bus: Bus) {
  const quoi = `pipe « ${pipe} » : exécution ${execution}`;
  try {
    for (const fin = Date.now() + suivi.limiteMs; Date.now() < fin; ) {
      await Bun.sleep(suivi.pasMs);
      const e = (await screenpipe.executionPipe(pipe, execution))?.data;
      if (!e?.status || e.status === "queued" || e.status === "running") continue;
      if (e.status === "completed") return bus.journaliser("info", `${quoi} terminée`);
      if (e.status === "cancelled") return bus.journaliser("info", `${quoi} arrêtée avant la fin (cancelled)`);
      const d = pourDebloquer(`${e.error_message ?? ""}\n${e.stderr ?? ""}`, "execution")!;
      bus.journaliser("alerte", `${quoi} en échec (${e.status}). ${d.texte}`);
      return await screenpipe.notifier({
        pipe_name: "des-que",
        title: `Dès que : la pipe « ${pipe} » n'a pas pu tourner`,
        body: `${texteBrut(causeLisible(e.error_message, e.stderr) || `statut ${e.status}, sans message d'erreur`)}\n\n${d.texte}`,
        priority: "high",
        autoDismissMs: 0,
        ...(d.bouton && { actions: [d.bouton] }),
      });
    }
    bus.journaliser("alerte", `${quoi} toujours en cours après ${Math.round(suivi.limiteMs / 60_000)} min : suivi arrêté`);
  } catch (err: any) {
    bus.journaliser("alerte", `${quoi} : suivi interrompu (${causeLisible(err?.message ?? err)})`);
  }
}

const REGLAGES: BoutonNotification = { id: "reglages", label: "Ouvrir les réglages", type: "deeplink", url: "screenpipe://settings" };
type Deblocage = [RegExp, string, BoutonNotification?];
const COMMUNS: Deblocage[] = [
  [/failed to load extension/i, "l'agent des pipes de screenpipe a une extension de version incompatible ; mettez screenpipe à jour ou ramenez l'extension à une version compatible, puis relancez la pipe."],
  [/not signed in|claude\.ai subscription/i, "dans les réglages IA de screenpipe, créez le préréglage « Claude API », collez-y votre clé, cliquez sur Test, puis sur l'étoile pour en faire le préréglage par défaut.", REGLAGES],
  [/no space left on device|ENOSPC/i, "le disque est plein ; libérez de la place, puis relancez la pipe.", { id: "stockage", label: "Libérer de la place", type: "deeplink", url: "screenpipe://settings?section=storage" }],
  [/api[ _-]?key|credit|quota|billing|usage limit/i, "clé refusée ou crédit épuisé ; vérifiez le préréglage IA dans les réglages de screenpipe (clé, crédit), puis relancez la pipe.", REGLAGES],
];
const REFUS_CONNEXION = /ECONNREFUSED|unable to connect|connection refused/i;
const HISTORIQUE: Deblocage = [/^/, "ouvrez l'historique de la pipe dans screenpipe pour lire l'erreur complète."];
/**
 * Tables fermées, dans l'ordre : le premier motif trouvé dans le texte d'erreur donne le conseil. Un refus de connexion n'y
 * dit pas la même chose : au lancement (POST /run), c'est screenpipe qui ne répond pas ; dans une exécution que screenpipe a
 * rapportée (il répond donc), c'est un service que l'agent de la pipe appelle. Cause inconnue : dans une exécution,
 * l'historique de la pipe a l'erreur complète ; un lancement refusé (pipe déjà en cours, introuvable…) n'y laisse rien,
 * il n'a donc pas de conseil.
 */
const DEBLOCAGES: Record<"lancement" | "execution", Deblocage[]> = {
  lancement: [...COMMUNS, [REFUS_CONNEXION, "screenpipe ne répond pas ; relancez l'appli screenpipe, puis la pipe."]],
  execution: [
    ...COMMUNS,
    [REFUS_CONNEXION, "l'agent de la pipe n'a pas pu joindre un service qu'il appelle (son fournisseur d'IA, Ollama par exemple s'il est arrêté, ou une autre API) ; démarrez ce service ou choisissez un autre préréglage IA dans les réglages de screenpipe, puis relancez la pipe.", REGLAGES],
    HISTORIQUE,
  ],
};

/**
 * « Pour débloquer : … » d'après le texte d'une erreur de pipe : refus de lancement, ou error_message et stderr d'une exécution
 * (depuis = "execution", jamais undefined). Texte fixe : rien du texte d'erreur n'y passe. Bouton deeplink (ouvert par
 * screenpipe en Rust, donc fiable) quand un réglage s'y prête.
 */
export function pourDebloquer(erreur: string, depuis: keyof typeof DEBLOCAGES = "lancement"): { texte: string; bouton?: BoutonNotification } | undefined {
  const d = DEBLOCAGES[depuis].find(([motif]) => motif.test(erreur));
  return d && { texte: `Pour débloquer : ${d[1]}`, bouton: d[2] };
}

/**
 * Première ligne utile (une lettre ou un chiffre) du premier texte qui en a une, pour l'affichage seulement : sur une ligne,
 * 300 caractères au plus, tout ce qui ressemble à une clé masqué. Texte non fiable : jamais vers un modèle ni un shell.
 */
export function causeLisible(...textes: unknown[]): string {
  for (const t of textes) {
    const ligne = String(t ?? "").split(/[\r\n\u2028\u2029]/).find((l) => /[\p{L}\p{N}]/u.test(l));
    if (ligne)
      return ligne
        .slice(0, 1_000) // borne le travail des expressions ci-dessous
        .replace(/[\s\p{C}]+/gu, " ")
        .replace(/\b([\w-]*(?:api[_-]?key|token|secret|password))(["']?\s*[:=]\s*["']?)[^\s"',;&]+/gi, "$1$2[clé masquée]")
        .replace(/\b(bearer)\s+\S+/gi, "$1 [clé masquée]")
        .replace(/\bsk-[\w-]+/g, "[clé masquée]")
        .trim()
        .slice(0, 300);
  }
  return "";
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

  /** Lance un pipe screenpipe existant (POST /pipes/:id/run), sans contexte ; son exécution est suivie à part. */
  "pipe.lancer": async (params, bus) => {
    if (typeof params.pipe !== "string") throw new Error("paramètre « pipe » manquant");
    return lancerPipe(params.pipe, undefined, bus);
  },

  // TODO Dev 2 : "mail.repondre", "notion.creer", "linear.creer" via /connections/:id/proxy/...
};

export const nomsExecuteurs = () => Object.keys(executeurs);
