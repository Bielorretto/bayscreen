// Commun : branchement des modules. À modifier à deux, et rarement.

import { repondre } from "./assistant";
import { config, verifierConfig } from "./config";
import { Copilote } from "./copilote";
import { Moteur } from "./moteur";
import { ecouterEvenements, screenpipe } from "./screenpipe";
import { demarrerServeur } from "./serveur";
import { surveillerPage, type SourceWeb } from "./sources/web";

/** Événements screenpipe transmis au moteur de règles (les autres ne servent qu'au copilote). */
const TYPES_POUR_LE_MOTEUR = new Set(["meeting_started", "meeting_ended", "workflow_event", "connection_trigger"]);

const moteur = new Moteur(config.fichierRegles);
await moteur.charger();

const copilote = new Copilote(moteur, config.phrasesAppel, (meetingId, question, transcription) =>
  repondre(moteur, meetingId, question, transcription),
);

const serveur = demarrerServeur(moteur, copilote);
console.log(`des-que : http://127.0.0.1:${serveur.port}`);

const manques = verifierConfig();
if (manques.length) moteur.journaliser("alerte", `.env incomplet : ${manques.join(", ")}`);

// Sources web déclarées dans sources.json (voir sources.exemple.json).
const fichierSources = Bun.file(config.fichierSources);
if (await fichierSources.exists()) {
  for (const s of (await fichierSources.json()) as SourceWeb[]) {
    if (s.type === "web") surveillerPage(s, moteur);
  }
}

if (config.screenpipeCle) {
  try {
    const statut = await screenpipe.statutVisio();
    if (statut.active && statut.active_meeting_id) copilote.ouvrir(statut.active_meeting_id, statut.meeting_app ?? undefined);
  } catch (e: any) {
    moteur.journaliser("erreur", `screenpipe injoignable : ${e.message}`);
  }

  ecouterEvenements(
    (brut) => {
      copilote.traiter(brut);
      if (TYPES_POUR_LE_MOTEUR.has(brut.name)) {
        moteur.emettre({
          id: crypto.randomUUID(),
          source: "screenpipe",
          type: brut.name === "workflow_event" ? String(brut.data?.event_type ?? brut.name) : brut.name,
          date: new Date().toISOString(),
          donnees: brut.data ?? {},
        });
      }
    },
    (connecte, detail) => moteur.journaliser(connecte ? "info" : "alerte", `screenpipe /ws/events : ${connecte ? "connecté" : detail}`),
  );
}

// TODO Dev 1 : source « mail » (GET /connections/imap/messages, à sonder ; voir docs/SCREENPIPE.md)
