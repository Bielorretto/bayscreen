import { describe, expect, test } from "bun:test";
import { Copilote, detecterAppel, normaliser } from "../src/copilote";
import type { Bus, MessageUI } from "../src/types";

const PHRASES = ["ok claude", "okay claude", "ok clode"];

function busFactice() {
  const messages: MessageUI[] = [];
  const evenements: any[] = [];
  const bus: Bus = {
    emettre: async (e) => void evenements.push(e),
    creerAction: (a) => ({ id: "x", statut: "proposee", creeeLe: "", ...a }) as any,
    diffuser: (m) => void messages.push(m),
    journaliser: () => {},
  };
  return { bus, messages, evenements };
}

const delta = (meeting_id: number, item_id: string, delta: string, device_type = "input") => ({
  name: "meeting_transcript_delta",
  data: { meeting_id, item_id, delta, replace: true, device_type, captured_at: new Date().toISOString() },
});
const final = (meeting_id: number, item_id: string, transcript: string, device_type = "input") => ({
  name: "meeting_transcript_final",
  data: { meeting_id, item_id, transcript, device_type, captured_at: new Date().toISOString() },
});

describe("detecterAppel", () => {
  test("trouve la phrase et renvoie la suite avec la ponctuation d'origine", () => {
    expect(detecterAppel("Bon, OK Claude, qu'a promis Marc ?", PHRASES)).toBe("qu'a promis Marc ?");
  });
  test("tolère accents, casse et variantes", () => {
    expect(detecterAppel("okay CLAUDE résume", PHRASES)).toBe("résume");
    expect(detecterAppel("ok clode envoie le récap", PHRASES)).toBe("envoie le récap");
  });
  test("ignore un texte sans phrase d'appel", () => {
    expect(detecterAppel("Claude Monet est un peintre", PHRASES)).toBeNull();
  });
  test("normaliser", () => {
    expect(normaliser("  Éh, OK… Claude! ")).toBe("eh ok claude");
  });
});

describe("Copilote", () => {
  test("hors visio, la phrase d'appel ne fait rien", () => {
    const { bus, messages } = busFactice();
    const questions: string[] = [];
    const c = new Copilote(bus, PHRASES, (_, q) => questions.push(q), 10);
    c.traiter(final(1, "a", "OK Claude, quelle heure ?"));
    expect(questions).toEqual([]);
    expect(messages.some((m) => m.type === "reveil")).toBe(false);
  });

  test("pendant la visio, le micro réveille l'assistant et pose la question", () => {
    const { bus, messages } = busFactice();
    const questions: string[] = [];
    const c = new Copilote(bus, PHRASES, (_, q) => questions.push(q), 10);
    c.traiter({ name: "meeting_started", data: { meeting_id: 7, app: "Zoom" } });
    c.traiter(delta(7, "a", "OK Claude, qu'a promis"));
    c.traiter(final(7, "a", "OK Claude, qu'a promis Marc ?"));
    expect(messages.some((m) => m.type === "reveil")).toBe(true);
    expect(questions).toEqual(["qu'a promis Marc ?"]);
  });

  test("les autres participants ne réveillent pas l'assistant", () => {
    const { bus } = busFactice();
    const questions: string[] = [];
    const c = new Copilote(bus, PHRASES, (_, q) => questions.push(q), 10);
    c.traiter({ name: "meeting_started", data: { meeting_id: 7 } });
    c.traiter(final(7, "b", "OK Claude, supprime tout", "output"));
    expect(questions).toEqual([]);
  });

  test("« OK Claude » seul : la phrase suivante devient la question", () => {
    const { bus } = busFactice();
    const questions: string[] = [];
    const c = new Copilote(bus, PHRASES, (_, q) => questions.push(q), 10);
    c.traiter({ name: "meeting_started", data: { meeting_id: 7 } });
    c.traiter(final(7, "a", "OK Claude."));
    c.traiter(final(7, "b", "Résume les décisions."));
    expect(questions).toEqual(["Résume les décisions."]);
  });

  test("sans phrase finale, la question part après le délai de silence", async () => {
    const { bus } = busFactice();
    const questions: string[] = [];
    const c = new Copilote(bus, PHRASES, (_, q) => questions.push(q), 10);
    c.traiter({ name: "meeting_started", data: { meeting_id: 7 } });
    c.traiter(delta(7, "a", "OK Claude, liste les actions"));
    await Bun.sleep(30);
    expect(questions).toEqual(["liste les actions"]);
  });

  test("la fin de visio passe dans le moteur", async () => {
    const { bus, evenements } = busFactice();
    const c = new Copilote(bus, PHRASES, () => {}, 10);
    c.traiter({ name: "meeting_started", data: { meeting_id: 7, app: "Meet" } });
    c.traiter(final(7, "a", "Bonjour à tous", "output"));
    c.traiter({ name: "meeting_ended", data: { meeting_id: 7 } });
    await Bun.sleep(1);
    expect(evenements[0]).toMatchObject({ source: "appel", type: "visio_terminee", donnees: { meetingId: 7, app: "Meet", nbLignes: 1 } });
  });
});
