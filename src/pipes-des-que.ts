// Propriétaire : Dev 2. Pont « dès que » pour les pipes screenpipe.
// screenpipe accepte dans pipe.md un déclencheur `custom` en langage naturel,
// mais ne l'évalue jamais. Ce pont lit les pipes, traduit leur déclencheur
// une seule fois en règle du moteur (Claude, schéma strict), et la pipe part
// à l'événement via l'exécuteur pipe.lancer.

import { demanderJSON } from "./claude";
import type { Moteur } from "./moteur";
import { sp } from "./screenpipe";
import type { Condition, Regle } from "./types";

/** Événements que le moteur reçoit réellement aujourd'hui, par source. */
export const TYPES_PAR_SOURCE: Record<string, string[]> = {
  web: ["valeur_changee"],
  mail: ["mail_recu"],
  webhook: ["*"],
  screenpipe: ["meeting_started", "meeting_ended", "workflow_event", "connection_trigger"],
  appel: ["visio_terminee"],
};

/** Forme des données de chaque événement, pour que Claude choisisse les bons champs de condition. */
const FORMES: Record<string, string> = {
  "web/valeur_changee": "{ nom, valeur (nombre), valeurTexte, ancienne, url } — émis quand une valeur change sur une page surveillée",
  "mail/mail_recu": "{ expediteur, objet, corps } — émis à chaque nouveau mail d'un dossier surveillé",
  "screenpipe/meeting_started": "{ meeting_id, app } — début d'une visio",
  "screenpipe/meeting_ended": "{ meeting_id, app } — fin d'une visio",
  "appel/visio_terminee": "{ meetingId, app, nbLignes } — fin de visio côté copilote",
  "webhook/*": "toute donnée envoyée à POST /api/evenements avec source webhook",
};

const SCHEMA_TRADUCTION = {
  type: "object",
  properties: {
    possible: { type: "boolean", description: "false si le déclencheur ne correspond à aucun événement géré" },
    source: { type: "string", description: "source de l'événement choisi" },
    type: { type: "string", description: "type d'événement choisi, ou * pour webhook" },
    si: {
      type: "array",
      items: {
        type: "object",
        properties: {
          champ: { type: "string", description: "chemin dans les données de l'événement, ex. valeur, objet, expediteur, app" },
          op: { type: "string", enum: ["egal", "contient", "superieur", "inferieur"] },
          valeur: { type: "string", description: "valeur à comparer (nombre ou texte, en chaîne)" },
        },
        required: ["champ", "op", "valeur"],
        additionalProperties: false,
      },
    },
    motif_refus: { type: "string", description: "explication courte si possible=false, sinon chaîne vide" },
  },
  required: ["possible", "source", "type", "si", "motif_refus"],
  additionalProperties: false,
};

type Traduction = { possible: boolean; source: string; type: string; si: Condition[]; motif_refus: string };

export type PipeAvecDesQue = {
  config?: { name?: string; title?: string; description?: string; enabled?: boolean; trigger?: { custom?: unknown; events?: string[] } };
};

/** Le déclencheur « dès que » d'une pipe : une chaîne ou une liste de chaînes. */
export function texteDeclencheur(custom: unknown): string {
  if (typeof custom === "string") return custom.trim();
  if (Array.isArray(custom)) return custom.filter((x) => typeof x === "string" && x.trim()).join(" ; ").trim();
  return "";
}

export type RapportPipe = {
  pipe: string;
  titre: string;
  declencheur: string;
  statut: "branchee" | "deja" | "refusee" | "erreur";
  regle?: Regle;
  motif?: string;
};

/** Id de la règle créée pour une pipe (idempotence : une traduction par pipe). */
export const idReglePipe = (pipe: string) => `pipe-des-que-${pipe}`;

/** Traduit le déclencheur « dès que » d'une pipe en règle du moteur. */
export async function traduireDeclencheur(
  pipe: string,
  titre: string,
  declencheur: string,
  description: string,
): Promise<RapportPipe> {
  const base: RapportPipe = { pipe, titre, declencheur, statut: "erreur" };
  let t: Traduction;
  try {
    t = await demanderJSON<Traduction>({
      systeme:
        "Tu traduis le déclencheur d'une pipe screenpipe en règle du moteur « dès que ». " +
        "Choisis l'événement géré qui correspond le mieux. Si le déclencheur demande quelque chose " +
        "qu'aucun événement ne couvre (changement d'application active, texte à l'écran, phrase prononcée…), " +
        "réponds possible=false avec un motif clair. Traduction fidèle : n'élargis jamais le déclencheur.",
      contenu:
        `Pipe : ${titre} (id ${pipe})\nDescription : ${description || "(aucune)"}\n` +
        `Déclencheur à traduire : « ${declencheur} »\n\n` +
        `Événements gérés :\n${Object.entries(FORMES).map(([k, v]) => `- ${k} : ${v}`).join("\n")}`,
      schema: SCHEMA_TRADUCTION,
    });
  } catch (e: any) {
    return { ...base, statut: "erreur", motif: `traduction impossible : ${e.message}` };
  }
  if (!t.possible) return { ...base, statut: "refusee", motif: t.motif_refus || "déclencheur non géré" };
  if (!(t.source in TYPES_PAR_SOURCE)) return { ...base, statut: "refusee", motif: `source « ${t.source} » non gérée` };
  if (!TYPES_PAR_SOURCE[t.source].includes(t.type)) {
    return { ...base, statut: "refusee", motif: `type « ${t.type} » non géré pour ${t.source}` };
  }
  return {
    ...base,
    statut: "branchee",
    regle: {
      id: idReglePipe(pipe),
      nom: `${titre || pipe} — dès que (déclencheur de pipe screenpipe)`,
      active: true,
      desQue: {
        source: t.source as Regle["desQue"]["source"],
        type: t.type,
        ...(t.si.length ? { si: t.si } : {}),
      },
      alors: { mode: "fixe", action: "pipe.lancer", params: { pipe } },
      validation: "auto",
    },
  };
}

/** Pipes screenpipe qui portent un déclencheur « dès que » (trigger.custom en langage naturel). */
export async function listerPipesAvecDesQue(): Promise<PipeAvecDesQue[]> {
  const r = await sp<{ data?: PipeAvecDesQue[] }>("/pipes");
  return (r.data ?? []).filter((p) => texteDeclencheur(p.config?.trigger?.custom).length > 0);
}

/** Synchronise toutes les pipes à déclencheur custom ; les règles déjà présentes ne sont pas retraduites. */
export async function synchroniserPipes(reglesExistantes: Regle[]): Promise<RapportPipe[]> {
  const pipes = await listerPipesAvecDesQue();
  const rapports: RapportPipe[] = [];
  for (const p of pipes) {
    const nom = String(p.config?.name ?? "");
    if (!nom) continue;
    const declencheur = texteDeclencheur(p.config?.trigger?.custom);
    const titre = String(p.config?.title ?? nom);
    if (reglesExistantes.some((r) => r.id === idReglePipe(nom))) {
      rapports.push({ pipe: nom, titre, declencheur, statut: "deja" });
      continue;
    }
    if (p.config?.enabled === false) {
      rapports.push({ pipe: nom, titre, declencheur, statut: "refusee", motif: "pipe désactivée dans screenpipe" });
      continue;
    }
    rapports.push(await traduireDeclencheur(nom, titre, declencheur, String(p.config?.description ?? "")));
  }
  return rapports;
}

/**
 * Synchronisation complète, appliquée au moteur : c'est la fonction appelée
 * automatiquement (surveillance périodique dans main.ts) comme par la route API.
 * Rien ne se passe sans être journalisé : branchement, refus ou erreur.
 */
export async function synchroniserAutomatiquement(moteur: Moteur): Promise<RapportPipe[]> {
  const rapports = await synchroniserPipes(moteur.regles);
  for (const r of rapports) {
    if (r.statut === "branchee" && r.regle) {
      moteur.regles = [...moteur.regles.filter((x) => x.id !== r.regle!.id), r.regle];
      moteur.journaliser(
        "info",
        `pipe « ${r.pipe} » branchée automatiquement : dès que ${r.regle.desQue.source}/${r.regle.desQue.type} → pipe.lancer`,
      );
    } else if (r.statut === "refusee") {
      moteur.journaliser("alerte", `pipe « ${r.pipe} » non branchée : ${r.motif ?? "?"}`);
    } else if (r.statut === "erreur") {
      moteur.journaliser("erreur", `pipe « ${r.pipe} » : ${r.motif ?? "erreur inconnue"}`);
    }
  }
  if (rapports.some((r) => r.statut === "branchee")) await moteur.sauverRegles();
  moteur.diffuser(moteur.etat());
  return rapports;
}
