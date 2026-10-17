// Propriétaire : Dev 1. Brique C, côté détection : suivi de la visio et réveil à la voix.
// L'assistant n'existe que pendant une visio (meeting_started → meeting_ended),
// n'écoute que le micro de l'utilisateur (device_type "input"), et se réveille
// sur une phrase d'appel. La réponse elle-même est produite par assistant.ts (Dev 2).

import type { Bus, LigneTranscription } from "./types";
import type { EvenementBrut } from "./screenpipe";

/** minuscules, sans accents ni ponctuation */
export function normaliser(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/**
 * Cherche une phrase d'appel dans un texte. Renvoie ce qui suit la phrase
 * (avec la ponctuation et la casse d'origine), ou null si aucune phrase n'est trouvée.
 */
export function detecterAppel(texte: string, phrases: string[]): string | null {
  const mots = texte.split(/\s+/).filter(Boolean);
  const motsNorm = mots.map(normaliser);
  for (const phrase of phrases) {
    const cible = normaliser(phrase).split(" ");
    for (let i = 0; i + cible.length <= motsNorm.length; i++) {
      if (cible.every((m, j) => motsNorm[i + j] === m)) {
        return mots
          .slice(i + cible.length)
          .join(" ")
          .replace(/^[\s,.:;!?…-]+/, "");
      }
    }
  }
  return null;
}

type Reveil = { itemId: string; question: string; minuterie?: ReturnType<typeof setTimeout>; attenteSuite: boolean };

export class Copilote {
  visio: { meetingId: number; app?: string } | null = null;
  transcription: LigneTranscription[] = [];
  private provisoire = new Map<string, string>(); // item_id → texte provisoire en cours
  private reveil: Reveil | null = null;

  constructor(
    private bus: Bus,
    private phrases: string[],
    private surQuestion: (meetingId: number, question: string, transcription: LigneTranscription[]) => void,
    private delaiSilenceMs = 2_000,
  ) {}

  ouvrir(meetingId: number, app?: string) {
    this.visio = { meetingId, app };
    this.transcription = [];
    this.provisoire.clear();
    this.reveil = null;
    this.bus.diffuser({ type: "visio", active: true, meetingId, app });
    this.bus.journaliser("info", `visio ouverte (${app ?? "?"}, id ${meetingId}) : assistant à l'écoute`);
  }

  async fermer() {
    if (!this.visio) return;
    const { meetingId, app } = this.visio;
    this.visio = null;
    if (this.reveil?.minuterie) clearTimeout(this.reveil.minuterie);
    this.reveil = null;
    this.bus.diffuser({ type: "visio", active: false, meetingId });
    this.bus.journaliser("info", `visio terminée (id ${meetingId}) : assistant en veille`);
    // Fait passer la fin de visio dans le moteur A (règles « dès qu'une visio se termine »).
    await this.bus.emettre({
      id: crypto.randomUUID(),
      source: "appel",
      type: "visio_terminee",
      date: new Date().toISOString(),
      donnees: { meetingId, app, nbLignes: this.transcription.length, transcription: this.transcription },
    });
  }

  /** À appeler pour chaque événement brut de /ws/events. */
  traiter(evt: EvenementBrut) {
    const d = evt.data ?? {};
    const id: number | undefined = d.meeting_id ?? d.id ?? undefined;

    // Plusieurs détecteurs peuvent annoncer la même visio : on ne repart pas de zéro.
    if (evt.name === "meeting_started" && typeof id === "number") {
      if (this.visio?.meetingId !== id) this.ouvrir(id, d.app ?? undefined);
      return;
    }
    if (evt.name === "meeting_ended" && this.visio && (id === undefined || id === this.visio.meetingId)) return void this.fermer();

    // Tout le reste n'a de sens que pendant une visio, pour cette visio.
    if (!this.visio || d.meeting_id !== this.visio.meetingId) return;

    if (evt.name === "meeting_transcript_delta") {
      const precedent = this.provisoire.get(d.item_id) ?? "";
      const texte = d.replace ? String(d.delta ?? "") : precedent + String(d.delta ?? "");
      this.provisoire.set(d.item_id, texte);
      this.surTexte(d.item_id, texte, d.device_type === "input", false);
    } else if (evt.name === "meeting_transcript_final") {
      this.provisoire.delete(d.item_id);
      const micro = d.device_type === "input";
      const ligne = { date: d.captured_at ?? new Date().toISOString(), qui: d.speaker_name ?? (micro ? "moi" : "autre"), micro, texte: String(d.transcript ?? "") };
      if (ligne.texte.trim()) this.transcription.push(ligne);
      this.bus.diffuser({ type: "transcription", meetingId: this.visio.meetingId, texte: ligne.texte, micro });
      this.surTexte(d.item_id, ligne.texte, micro, true);
    }
  }

  private surTexte(itemId: string, texte: string, micro: boolean, final: boolean) {
    if (!micro || !this.visio) return; // les autres participants ne réveillent jamais l'assistant

    // Réveillé, la phrase d'appel était seule : ce que l'utilisateur dit ensuite est la question.
    if (this.reveil?.attenteSuite && this.reveil.itemId !== itemId) {
      this.reveil.itemId = itemId;
      this.reveil.attenteSuite = false;
    }

    if (!this.reveil) {
      const suite = detecterAppel(texte, this.phrases);
      if (suite === null) return;
      this.reveil = { itemId, question: suite, attenteSuite: false };
      this.bus.diffuser({ type: "reveil", meetingId: this.visio.meetingId });
      this.bus.journaliser("info", "phrase d'appel entendue : assistant réveillé");
    } else if (this.reveil.itemId === itemId) {
      this.reveil.question = detecterAppel(texte, this.phrases) ?? texte;
    } else {
      return;
    }

    if (this.reveil.minuterie) clearTimeout(this.reveil.minuterie);
    if (final) this.terminerQuestion();
    else this.reveil.minuterie = setTimeout(() => this.terminerQuestion(), this.delaiSilenceMs);
  }

  private terminerQuestion() {
    if (!this.reveil || !this.visio) return;
    const question = this.reveil.question.trim();
    if (!question) {
      // « OK Claude » seul : on attend la phrase suivante (8 s maximum).
      this.reveil.attenteSuite = true;
      this.reveil.minuterie = setTimeout(() => (this.reveil = null), 8_000);
      return;
    }
    this.reveil = null;
    this.surQuestion(this.visio.meetingId, question, this.transcription);
  }

  /** Question tapée dans la page : même chemin que la voix, mais seulement pendant une visio. */
  questionTapee(question: string) {
    if (!this.visio) throw new Error("aucune visio en cours");
    this.surQuestion(this.visio.meetingId, question, this.transcription);
  }
}
