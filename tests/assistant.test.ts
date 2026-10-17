import { expect, test } from "bun:test";
import { repondre } from "../src/assistant";
import type { Souvenir } from "../src/screenpipe";
import type { Bus, MessageUI } from "../src/types";

function busFactice() {
  const messages: MessageUI[] = [];
  const journal: string[] = [];
  const bus: Bus = {
    emettre: async () => {},
    creerAction: (a) => a as any,
    diffuser: (m) => messages.push(m),
    journaliser: (_, message) => journal.push(message),
  };
  return { bus, messages, journal };
}

const devis: Souvenir = { quand: "2026-10-16T15:02:11+02:00", appli: "Figma", fenetre: "Devis Camille", extrait: "Total HT : 1 200 €" };
const reponse = { reponse: "1 200 €, vu dans Figma hier à 15 h", citations: ["Total HT : 1 200 €"], action_demandee: false, action: "", params_json: "{}" };

test("la question cherche dans la mémoire de l'écran et Claude la reçoit, datée et située", async () => {
  const { bus, messages } = busFactice();
  let demande: { contenu: string } | undefined;
  let cherche: { texte: string; depuisMinutes?: number } | undefined;
  await repondre(bus, 7, "quel prix j'avais vu pour le devis ?", [], {
    memoire: async (texte, o) => ((cherche = { texte, depuisMinutes: o?.depuisMinutes }), [devis]),
    demander: (async (o: { contenu: string }) => ((demande = o), reponse)) as any,
  });
  expect(cherche).toEqual({ texte: "quel prix j'avais vu pour le devis ?", depuisMinutes: 24 * 60 });
  expect(demande?.contenu).toContain("[2026-10-16 15:02, Figma — Devis Camille] Total HT : 1 200 €");
  expect(messages.at(-1)).toMatchObject({ type: "reponse", reponse: reponse.reponse, citations: reponse.citations });
});

test("sans mémoire (screenpipe en panne), l'assistant répond quand même avec la transcription", async () => {
  const { bus, messages, journal } = busFactice();
  let demande: { contenu: string } | undefined;
  await repondre(bus, 7, "qu'a dit Marc ?", [{ date: "2026-10-17T10:00:00Z", qui: "Marc", micro: false, texte: "Je livre lundi" }], {
    memoire: async () => {
      throw new Error("screenpipe injoignable");
    },
    demander: (async (o: { contenu: string }) => ((demande = o), reponse)) as any,
  });
  expect(demande?.contenu).not.toContain("Mémoire de l'écran");
  expect(demande?.contenu).toContain("Marc : Je livre lundi");
  expect(journal.some((l) => l.includes("mémoire screenpipe indisponible"))).toBe(true);
  expect(messages.at(-1)).toMatchObject({ type: "reponse" });
});
