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

  lancerPipe: (id: string) => sp(`/pipes/${encodeURIComponent(id)}/run`, { method: "POST", body: "{}" }),
};

export type EvenementBrut = { name: string; data: any };

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
