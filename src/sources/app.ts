// Propriétaire : Dev 2. Source « application active » : sonde la dernière capture
// OCR de screenpipe (une frame porte l'application et la fenêtre qui sont à
// l'écran) et émet un événement « app_active » quand l'application ou la
// fenêtre active change. Pas de bus, pas de permission nouvelle.

import { sp } from "../screenpipe";
import type { Bus } from "../types";

export type SourceApp = { type: "app"; intervalleSecondes?: number };

type EntreeCapture = { content?: { app_name?: unknown; window_name?: unknown; timestamp?: unknown } };

export function surveillerApp(bus: Bus, s: SourceApp = { type: "app" }): () => void {
  let derniere: string | null = null;
  const tour = async () => {
    try {
      const r = await sp<{ data?: EntreeCapture[] }>("/search?content_type=ocr&limit=3");
      // la frame la plus récente qui porte un nom d'application
      const c = (r?.data ?? []).find((d) => String(d.content?.app_name ?? "").trim())?.content ?? {};
      const app = String(c.app_name ?? "").trim();
      const fenetre = String(c.window_name ?? "").trim();
      if (!app) return;
      const cle = `${app}|${fenetre}`;
      if (cle === derniere) return;
      const premiereLecture = derniere === null;
      derniere = cle;
      bus.journaliser("info", `source « app active » : ${app} — ${fenetre || "(sans fenêtre)"}`);
      if (premiereLecture) return; // comme les autres sources : la valeur initiale ne déclenche rien
      await bus.emettre({
        id: crypto.randomUUID(),
        source: "screenpipe",
        type: "app_active",
        date: new Date().toISOString(),
        donnees: { app, fenetre, capture: String(c.timestamp ?? "") },
      });
    } catch (e: any) {
      bus.journaliser("erreur", `source « app active » : ${e.message}`);
    }
  };
  tour();
  const t = setInterval(tour, Math.max(2, s.intervalleSecondes ?? 3) * 1000);
  return () => clearInterval(t);
}
