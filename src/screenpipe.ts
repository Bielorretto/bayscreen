// Propriétaire : Dev 1. Client de l'API locale screenpipe (http://localhost:3030).
// Référence vérifiée dans le code de screenpipe : docs/SCREENPIPE.md

import { config } from "./config";

export class ErreurScreenpipe extends Error {
  constructor(public statut: number, message: string) {
    super(message);
  }
}

/** Appel REST authentifié. Toute route exige la clé, même depuis localhost (sinon 403). */
export async function sp<T = unknown>(chemin: string, init: RequestInit = {}): Promise<T> {
  const url = new URL(chemin, config.screenpipeUrl);
  const res = await fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${config.screenpipeCle}`,
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
    signal: init.signal ?? AbortSignal.timeout(15_000),
  });
  const texte = await res.text();
  if (!res.ok) throw new ErreurScreenpipe(res.status, `screenpipe ${init.method ?? "GET"} ${chemin} → ${res.status} ${texte.slice(0, 300)}`);
  return (texte ? JSON.parse(texte) : null) as T;
}

export const screenpipe = {
  sante: () => sp("/health"),

  /** content_type : all | ocr | audio | input | accessibility | memory */
  chercher: (p: { q?: string; content_type?: string; limit?: number; start_time?: string; end_time?: string; app_name?: string }) => {
    const qs = new URLSearchParams(Object.entries(p).filter(([, v]) => v !== undefined).map(([k, v]) => [k, String(v)]));
    return sp<any>(`/search?${qs}`);
  },

  resumeActivite: (qs = "") => sp<any>(`/activity-summary${qs}`),

  /** En camelCase (vérifié, 0.4.52) : { active, manual, manualActive, activeMeetingId, stoppableMeetingId, meetingApp, detectionSource } */
  statutVisio: () =>
    sp<{ active: boolean; activeMeetingId: number | null; meetingApp: string | null; detectionSource: string | null }>("/meetings/status"),

  /** Tableau nu en camelCase (vérifié) : { id, meetingId, itemId, deviceType, speakerName, transcript, capturedAt, ... } */
  transcriptionVisio: (id: number) => sp<any[]>(`/meetings/${id}/transcript`),

  /** Pour tester sans vraie visio. Corps : { app?, title?, attendees? } */
  demarrerVisio: (corps: { app?: string; title?: string } = { app: "test", title: "Visio de test" }) =>
    sp("/meetings/start", { method: "POST", body: JSON.stringify(corps) }),
  arreterVisio: () => sp("/meetings/stop", { method: "POST", body: "{}" }),

  /** Range un récap sur la visio. Corps : { summary, title? } ; summary ne doit pas être vide. */
  enregistrerResume: (id: number, corps: { summary: string; title?: string }) =>
    sp(`/meetings/${id}/summary`, { method: "POST", body: JSON.stringify(corps) }),

  /** Applis externes disponibles et branchées (« l'ouverture vers l'extérieur »). */
  connexions: () => sp<any>("/connections"),

  slackEnvoyer: (corps: { text: string; channel?: string; instance?: string }) =>
    sp("/connections/slack/send", { method: "POST", body: JSON.stringify(corps) }),

  telegramEnvoyer: (corps: { text: string; instance?: string }) =>
    sp("/connections/telegram/send", { method: "POST", body: JSON.stringify(corps) }),

  /** Discord par webhook (vérifié : 204) : l'URL du webhook reste côté screenpipe. */
  discordEnvoyer: (corps: { content: string }) =>
    sp("/connections/discord/proxy", { method: "POST", body: JSON.stringify(corpsDiscord(corps.content)) }),

  /** IMAP, lecture seule (vérifié) : la liste n'a pas le corps, d'où mail(). 401 si IMAP n'est pas branché. */
  mails: (mailbox: string, limit = 20) =>
    sp<{ messages?: MessageImap[] }>(`/connections/imap/messages?${new URLSearchParams({ mailbox, limit: String(limit) })}`),
  mail: (id: number, mailbox: string) =>
    sp<{ body?: string }>(`/connections/imap/messages/${id}?${new URLSearchParams({ mailbox })}`),

  /** Corps facultatif : run_context, ajouté à la consigne de ce seul passage (bloc « RUN CONTEXT », pipes_api.rs, format_run_context). */
  lancerPipe: (id: string, corps: { run_context?: Record<string, unknown> } = {}) =>
    sp(`/pipes/${encodeURIComponent(id)}/run`, { method: "POST", body: JSON.stringify(corps) }),

  /** Sort d'un lancement, par l'execution_id que renvoie /run : { data: exécution } (get_pipe_execution, lu dans le source de l'appli 2.7.109). */
  executionPipe: (id: string, execution: number) => sp<{ data?: ExecutionPipe }>(`/pipes/${encodeURIComponent(id)}/executions/${execution}`),

  /** Notification dans l'appli screenpipe : sidecar Tauri, port 11435, sans clé (vérifié : 200). Jusqu'à 5 boutons. */
  notifier: async (n: NotificationScreenpipe) => {
    const res = await fetch("http://localhost:11435/notify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(n),
      signal: AbortSignal.timeout(5_000),
    });
    if (!res.ok) throw new ErreurScreenpipe(res.status, `screenpipe POST /notify → ${res.status} ${(await res.text()).slice(0, 300)}`);
  },
};

/**
 * Corps d'un message Discord. Mentionne config.discordMention s'il est valide, et n'autorise aucune
 * autre mention : un texte écrit par Claude d'après un mail ne peut pas alerter @everyone.
 */
export function corpsDiscord(content: string, mention = config.discordMention) {
  const id = /^\d{17,20}$/.test(mention) ? mention : "";
  return { content: id ? `<@${id}> ${content}` : content, allowed_mentions: { parse: [], users: id ? [id] : [] } };
}

const MOTS_VIDES = new Set(["avec", "pour", "dans", "votre", "vous", "nous", "merci", "bonjour", "test", "from", "with", "your", "this", "that",
  // Une question dite en visio : sans eux, « quel était le prix du casque audio ? » prend 2 des 4 places et écarte « audio ».
  "quel", "quelle", "quels", "quelles", "quoi", "combien", "quand", "comment", "pourquoi", "était", "étais", "avait", "avais", "avez", "avons",
  "sont", "sera", "être", "avoir", "fait", "faire", "peux", "peut", "cette", "celui", "celle", "ceux", "elle", "elles", "mais", "donc", "alors", "aussi", "encore", "déjà"]);

/** Mots d'un texte qui ont des chances de figurer sur un écran lié : 4 lettres ou plus, ou un chiffre. */
export function motsCles(texte: string, max = 4): string[] {
  const mots = texte
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((m) => (m.length >= 4 || /\d/.test(m)) && !MOTS_VIDES.has(m));
  return [...new Set(mots)].slice(0, max);
}

export type Souvenir = { quand: string; appli: string; fenetre: string; extrait: string };

/**
 * Ce que screenpipe a montré à l'écran récemment en lien avec un texte (objet de mail…).
 * /search exige tous les mots d'une requête : on cherche mot par mot, puis on garde les écrans
 * qui en contiennent au moins deux. Texte d'écran seulement, jamais l'audio ni la frappe.
 */
export async function souvenirs(
  texte: string,
  o: { depuisMinutes?: number; max?: number } = {},
  chercher: typeof screenpipe.chercher = screenpipe.chercher,
): Promise<Souvenir[]> {
  const mots = motsCles(texte);
  if (!mots.length) return [];
  const depuis = new Date(Date.now() - (o.depuisMinutes ?? 60) * 60_000).toISOString();
  const ecrans = new Map<number, { mots: Set<string>; c: any }>();
  // Texte d'écran seulement (« ocr ») : avec « all », l'audio (capté en permanence) remplit les 10 places. « ocr » porte
  // aussi le texte d'accessibilité ; « accessibility » renverrait les mêmes écrans, sans frame_id. Une requête par mot : une
  // requête en erreur ne fait perdre que les écrans de son mot ; si toutes échouent (screenpipe arrêté, clé refusée),
  // l'erreur remonte, et l'appelant alerte « mémoire screenpipe indisponible ».
  const erreurs: unknown[] = [];
  for (const q of mots) {
    const r = await chercher({ q, content_type: "ocr", limit: 10, start_time: depuis }).catch((e) => (erreurs.push(e), null));
    for (const d of r?.data ?? []) {
      if (!/^(ocr|ui|accessibility)$/i.test(String(d?.type)) || typeof d.content?.frame_id !== "number") continue;
      const e = ecrans.get(d.content.frame_id) ?? { mots: new Set<string>(), c: d.content };
      e.mots.add(q);
      ecrans.set(d.content.frame_id, e);
    }
  }
  if (erreurs.length === mots.length) throw erreurs[0];
  const seuil = Math.min(2, mots.length);
  const fenetresVues = new Set<string>();
  return [...ecrans.values()]
    .filter((e) => e.mots.size >= seuil)
    .sort((a, b) => b.mots.size - a.mots.size)
    .filter(({ c }) => {
      // Un souvenir par fenêtre : un éditeur resté ouvert ne prend pas toutes les places.
      const fenetre = `${c.app_name}|${c.window_name}`;
      if (fenetresVues.has(fenetre)) return false;
      fenetresVues.add(fenetre);
      return true;
    })
    .slice(0, o.max ?? 3)
    .map(({ c }) => {
      const t = String(c.text ?? "").replace(/\s+/g, " ");
      const i = debutExtrait(t, mots);
      // ponytail: un extrait autour des mots trouvés, pas l'écran entier (moins de données privées envoyées)
      return { quand: String(c.timestamp ?? ""), appli: String(c.app_name ?? ""), fenetre: String(c.window_name ?? "").slice(0, 80), extrait: t.slice(Math.max(0, i - 50), i + 350) };
    });
}

/** Là où le plus de mots cherchés se suivent de près ; à égalité, le plus bas sur l'écran (le corps d'une page plutôt que son onglet). */
function debutExtrait(t: string, mots: string[]): number {
  const bas = t.toLowerCase();
  let meilleur = { debut: 0, score: 0 };
  for (const m of mots)
    for (let i = bas.indexOf(m); i >= 0; i = bas.indexOf(m, i + 1)) {
      const proche = bas.slice(i, i + 200);
      const score = mots.filter((x) => proche.includes(x)).length;
      if (score > meilleur.score || (score === meilleur.score && i > meilleur.debut)) meilleur = { debut: i, score };
    }
  return meilleur.debut;
}

/** Texte non fiable (mail, transcription, sortie de Claude) pour un body : en bloc de code, donc ni lien ni image actifs. */
export const texteBrut = (s: unknown, max = 800) => "```\n" + String(s ?? "").replace(/`/g, "'").slice(0, max) + "\n```";

export type BoutonNotification = {
  id: string;
  label: string;
  /**
   * link : ouvre url dans le navigateur ; traité en Rust, il marche aussi dans le panneau natif macOS (native_actions.rs:940-946, vérifié).
   * api : appelle url par un écouteur JS monté seulement dans l'overlay ; dans le panneau natif, clic probablement sans effet (lu, non reproduit).
   * pipe : lance le pipe nommé, context injecté dans sa consigne ; chat : lance prompt dans le chat.
   * dismiss : jamais affiché par le panneau natif (notification_panel.swift:443, vérifié).
   */
  type: "link" | "api" | "pipe" | "chat" | "deeplink" | "dismiss";
  /** api : une route de l'API screenpipe seulement (isLocalApiUrl, vérifié), ex. "/connections/discord/proxy" ; screenpipe ajoute la clé */
  url?: string;
  /** api : POST par défaut ; body est envoyé en JSON */
  method?: string;
  body?: unknown;
  pipe?: string;
  prompt?: string;
  context?: Record<string, unknown>;
};

export type NotificationScreenpipe = {
  title: string;
  /** Obligatoire pour screenpipe. Markdown : y échapper tout texte non fiable (mail, transcription). */
  body: string;
  pipe_name: string;
  priority?: "high" | "normal" | "low";
  /** En millisecondes ; 0 : reste affichée ; 20 000 par défaut (notification_panel.swift:1116, vérifié). timeout_secs est ignoré. */
  autoDismissMs?: number;
  actions?: BoutonNotification[];
};

/**
 * Une exécution de pipe (PipeExecution, pipes/mod.rs ; extrait). status : queued, running, puis completed, failed, cancelled
 * ou timed_out (vérifié). stderr et error_message peuvent contenir ce que la pipe a lu (écran, mails) : texte non fiable.
 */
export type ExecutionPipe = { status: string; stderr: string; error_message: string | null };

export type EvenementBrut = { name: string; data: any };

/** from vaut "Nom <adresse>" ; date en ISO 8601 avec décalage (vérifié). */
export type MessageImap = { id: number; from: string; to: string; subject: string; date: string };

/**
 * Écoute /ws/events (tous les événements internes de screenpipe), avec reconnexion.
 * Attention : ce WebSocket accepte aussi des messages entrants et les republie sur le bus
 * interne de screenpipe, ce qui peut déclencher ses pipes. Ne rien y envoyer sans raison.
 */
export function ecouterEvenements(
  surEvenement: (evt: EvenementBrut) => void,
  surEtat: (connecte: boolean, detail?: string) => void = () => {},
): () => void {
  let ws: WebSocket | null = null;
  let arrete = false;
  let attente = 1_000;

  const ouvrir = () => {
    const url = new URL("/ws/events", config.screenpipeUrl);
    url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
    url.searchParams.set("token", config.screenpipeCle);
    ws = new WebSocket(url);
    ws.onopen = () => {
      attente = 1_000;
      surEtat(true);
    };
    ws.onmessage = (m) => {
      try {
        const evt = JSON.parse(String(m.data)) as EvenementBrut;
        if (evt && typeof evt.name === "string") surEvenement(evt);
      } catch {
        /* message non JSON : ignoré */
      }
    };
    ws.onclose = (e) => {
      surEtat(false, `fermé (${e.code})`);
      if (!arrete) setTimeout(ouvrir, attente);
      attente = Math.min(attente * 2, 30_000);
    };
    ws.onerror = () => ws?.close();
  };

  ouvrir();
  return () => {
    arrete = true;
    ws?.close();
  };
}
