// Propriétaire : Dev 1. Source « web » : relit une page à intervalle régulier,
// extrait une valeur avec une expression régulière, émet valeur_changee quand elle change.

import type { Bus } from "../types";

export type SourceWeb = {
  type: "web";
  nom: string;
  url: string;
  /** Expression régulière dont le premier groupe capture la valeur, ex. "Prix\\s*:\\s*([\\d.,]+)" */
  motif: string;
  intervalleSecondes: number;
};

export function nombre(brut: string): number | null {
  const n = Number(brut.replace(/\s/g, "").replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

export function surveillerPage(s: SourceWeb, bus: Bus): () => void {
  const re = new RegExp(s.motif, "i");
  let precedente: string | null = null;

  const tour = async () => {
    try {
      const res = await fetch(s.url, { signal: AbortSignal.timeout(15_000), headers: { "User-Agent": "des-que/0.1" } });
      const html = await res.text();
      const m = html.match(re);
      if (!m?.[1]) {
        bus.journaliser("alerte", `source « ${s.nom} » : motif introuvable dans la page`);
        return;
      }
      const valeur = m[1].trim();
      if (valeur === precedente) return;
      const ancienne = precedente;
      precedente = valeur;
      if (ancienne === null) {
        bus.journaliser("info", `source « ${s.nom} » : valeur initiale ${valeur}`);
        return; // pas d'événement au premier relevé
      }
      await bus.emettre({
        id: crypto.randomUUID(),
        source: "web",
        type: "valeur_changee",
        date: new Date().toISOString(),
        donnees: { nom: s.nom, url: s.url, valeur: nombre(valeur) ?? valeur, valeurTexte: valeur, ancienne },
      });
    } catch (e: any) {
      bus.journaliser("erreur", `source « ${s.nom} » : ${e.message}`);
    }
  };

  tour();
  const t = setInterval(tour, Math.max(5, s.intervalleSecondes) * 1000);
  return () => clearInterval(t);
}
