// Commun : branchement des modules. À modifier à deux, et rarement.

import { repondre } from "./assistant";
import { config, verifierConfig } from "./config";
import { Copilote } from "./copilote";
import { Moteur } from "./moteur";
import { synchroniserAutomatiquement } from "./pipes-des-que";
import { ecouterEvenements, screenpipe } from "./screenpipe";
import { demarrerServeur } from "./serveur";
import { surveillerMails, type SourceMail } from "./sources/mail";
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

// Sources déclarées dans sources.json (voir sources.exemple.json).
const fichierSources = Bun.file(config.fichierSources);
if (await fichierSources.exists()) {
  for (const s of (await fichierSources.json()) as (SourceWeb | SourceMail)[]) {
    if (s.type === "web") surveillerPage(s, moteur);
    if (s.type === "mail") surveillerMails(s, moteur);
  }
}

// Pont « dès que » : surveillance automatique des pipes screenpipe. L'utilisateur
// crée sa pipe dans l'app avec un déclencheur « dès que » (trigger.custom) : elle est
// traduite et branchée toute seule, sans action de personne côté moteur.
if (config.screenpipeCle) {
  const sonderPipes = () =>
    synchroniserAutomatiquement(moteur).catch((e) =>
      moteur.journaliser("alerte", `surveillance des pipes screenpipe : ${e.message}`),
    );
  setTimeout(sonderPipes, 10_000); // premier passage juste après le démarrage
  setInterval(sonderPipes, 60_000); // puis au rythme du scan de screenpipe
}

if (config.screenpipeCle) {
  try {
    const statut = await screenpipe.statutVisio();
    if (statut.active && statut.activeMeetingId) copilote.ouvrir(statut.activeMeetingId, statut.meetingApp ?? undefined);
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

