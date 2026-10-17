// Propriétaire : Dev 2 (complété par Dev 1 sur la branche integration-screenpipe). Pont « dès que » des pipes screenpipe.
// screenpipe accepte dans pipe.md un déclencheur `custom` en langage naturel, mais ne l'évalue jamais
// (screenpipe-core, pipes/mod.rs : « future: matched via embedding similarity »). Ce pont lit les pipes,
// fait traduire chaque déclencheur par Claude en règle déterministe, vérifie les accès dont elle a besoin,
// rejoue des essais sans Claude, puis PROPOSE le branchement : rien ne tourne avant le clic « Valider ».
// Un déclencheur modifié dans screenpipe est retraduit ; une pipe retirée arrête sa règle.

import { executeurs } from "./actions";
import { demanderJSON } from "./claude";
import { config } from "./config";
import { Moteur, regleCorrespond } from "./moteur";
import { sp } from "./screenpipe";
import type { Condition, Evenement, Regle } from "./types";

/** Événements que le moteur reçoit réellement, avec les champs de leurs données (null : données libres). */
export const EVENEMENTS: Record<string, { champs: string[] | null; sens: string }> = {
  "web/valeur_changee": { champs: ["nom", "url", "valeur", "valeurTexte", "ancienne"], sens: "une valeur relevée sur une page ou une API surveillée change ; nom = nom de la source, valeur = nouvelle valeur (nombre), ancienne = valeur précédente" },
  "mail/mail_recu": { champs: ["expediteur", "objet", "corps"], sens: "un mail arrive dans un dossier IMAP surveillé" },
  "screenpipe/meeting_started": { champs: ["meeting_id", "app", "title", "detection_source"], sens: "une visio commence" },
  // Vérifié en réel : meeting_ended n'a ni app ni title (docs/SCREENPIPE.md).
  "screenpipe/meeting_ended": { champs: ["meeting_id", "duration_secs", "meeting_end", "transcript_segments"], sens: "une visio se termine (sans app ni titre)" },
  "appel/visio_terminee": { champs: ["meetingId", "app", "nbLignes", "transcription"], sens: "fin de visio vue par le copilote, avec l'appli et la transcription" },
  "webhook/*": { champs: null, sens: "toute donnée envoyée à POST /api/evenements avec la source webhook" },
};

const SCHEMA_TRADUCTION = {
  type: "object",
  properties: {
    possible: { type: "boolean", description: "false si aucun événement géré ne couvre le déclencheur" },
    evenement: { type: "string", enum: Object.keys(EVENEMENTS), description: "source/type de l'événement choisi" },
    si: {
      type: "array",
      items: {
        type: "object",
        properties: {
          champ: { type: "string", description: "champ des données de l'événement" },
          op: { type: "string", enum: ["egal", "contient", "superieur", "inferieur"] },
          valeur: { type: "string", description: "valeur à comparer (nombre ou texte, en chaîne)" },
        },
        required: ["champ", "op", "valeur"],
        additionalProperties: false,
      },
    },
    essais: {
      type: "array",
      description: "3 à 5 événements de test, au moins un qui doit déclencher et un qui ne doit pas",
      items: {
        type: "object",
        properties: {
          donnees_json: { type: "string", description: "données de l'événement, en JSON" },
          attendu: { type: "boolean", description: "true si la règle doit se déclencher" },
          pourquoi: { type: "string" },
        },
        required: ["donnees_json", "attendu", "pourquoi"],
        additionalProperties: false,
      },
    },
    motif_refus: { type: "string", description: "explication courte si possible=false, sinon chaîne vide" },
  },
  required: ["possible", "evenement", "si", "essais", "motif_refus"],
  additionalProperties: false,
};

type Essai = { donnees_json: string; attendu: boolean; pourquoi: string };
type Traduction = { possible: boolean; evenement: string; si: Condition[]; essais: Essai[]; motif_refus: string };
type ConfigPipe = { name?: string; title?: string; description?: string; enabled?: boolean; trigger?: { custom?: unknown; events?: string[] } };
type Source = { type: string; nom?: string; url?: string; mailbox?: string };

export type Acces = { acces: string; ok: boolean; detail: string };
export type RapportPipe = {
  pipe: string;
  titre: string;
  declencheur: string;
  statut: "a_valider" | "deja" | "refusee" | "erreur" | "retiree";
  regle?: Regle;
  acces?: Acces[];
  essais?: string[];
  motif?: string;
};

/** Le déclencheur « dès que » d'une pipe : une chaîne ou une liste de chaînes. */
export function texteDeclencheur(custom: unknown): string {
  if (typeof custom === "string") return custom.trim();
  if (Array.isArray(custom)) return custom.filter((x) => typeof x === "string" && x.trim()).join(" ; ").trim();
  return "";
}

/** Id de la règle d'une pipe : une règle par pipe. */
export const idReglePipe = (pipe: string) => `pipe-des-que-${pipe}`;

async function lireSources(): Promise<Source[]> {
  const f = Bun.file(config.fichierSources);
  return (await f.exists()) ? ((await f.json()) as Source[]) : [];
}

/** Ce dont la règle a besoin pour se déclencher un jour : champs réels, source configurée, screenpipe joignable, pipe active. */
export async function verifierAcces(regle: Regle, pipe: ConfigPipe): Promise<Acces[]> {
  const { source, type, si = [] } = regle.desQue;
  const ev = EVENEMENTS[`${source}/${type}`];
  const inconnus = ev?.champs ? si.map((c) => c.champ).filter((c) => !ev.champs!.includes(c)) : [];
  const res: Acces[] = [
    {
      acces: "champs de l'événement",
      ok: !!ev && inconnus.length === 0,
      detail: !ev ? `${source}/${type} non géré` : inconnus.length ? `absents de ${source}/${type} : ${inconnus.join(", ")}` : ev.champs ? "tous présents" : "données libres",
    },
  ];
  const sources = await lireSources();
  if (source === "web") {
    const nom = si.find((c) => c.champ === "nom" && c.op === "egal")?.valeur;
    const noms = sources.filter((s) => s.type === "web").map((s) => String(s.nom));
    res.push({
      acces: "source web",
      ok: nom !== undefined && noms.includes(String(nom)),
      detail: nom === undefined ? "la règle doit viser une source par son nom (nom egal …)" : noms.includes(String(nom)) ? `« ${nom} » surveillée` : `« ${nom} » absente de ${config.fichierSources} (surveillées : ${noms.join(", ") || "aucune"})`,
    });
  } else if (source === "mail") {
    const n = sources.filter((s) => s.type === "mail").length;
    res.push({ acces: "source mail", ok: n > 0, detail: n ? `${n} dossier(s) IMAP surveillé(s)` : `aucune source mail dans ${config.fichierSources}` });
  } else if (source === "screenpipe" || source === "appel") {
    res.push({ acces: "événements screenpipe", ok: !!config.screenpipeCle, detail: config.screenpipeCle ? "clé screenpipe présente" : "clé screenpipe absente" });
  }
  res.push({ acces: "pipe screenpipe", ok: pipe.enabled !== false, detail: pipe.enabled === false ? "désactivée dans screenpipe" : "active" });
  return res;
}

/** Rejoue les essais proposés par Claude, sans Claude : c'est le moteur qui dit si la règle part. */
export function rejouerEssais(regle: Regle, essais: Essai[]): { ok: boolean; lignes: string[] } {
  const lignes: string[] = [];
  let ok = essais.some((e) => e.attendu) && essais.some((e) => !e.attendu);
  if (!ok) lignes.push("il faut au moins un essai qui déclenche et un qui ne déclenche pas");
  for (const e of essais) {
    let donnees: Record<string, unknown>;
    try {
      donnees = JSON.parse(e.donnees_json);
    } catch {
      ok = false;
      lignes.push(`ÉCHEC essai illisible : ${e.donnees_json.slice(0, 80)}`);
      continue;
    }
    const evt: Evenement = { id: "essai", source: regle.desQue.source, type: regle.desQue.type, date: new Date().toISOString(), donnees };
    const obtenu = regleCorrespond({ ...regle, active: true }, evt);
    if (obtenu !== e.attendu) ok = false;
    lignes.push(`${obtenu === e.attendu ? "OK" : "ÉCHEC"} ${e.attendu ? "déclenche" : "ne déclenche pas"} : ${e.donnees_json} (${e.pourquoi})`);
  }
  return { ok, lignes };
}

/** Traduit le déclencheur d'une pipe, vérifie les accès et rejoue les essais. Ne branche rien. */
export async function traduireDeclencheur(pipe: string, titre: string, declencheur: string, cfg: ConfigPipe): Promise<RapportPipe> {
  const base: RapportPipe = { pipe, titre, declencheur, statut: "erreur" };
  const sources = await lireSources();
  let t: Traduction;
  try {
    t = await demanderJSON<Traduction>({
      systeme:
        "Tu traduis le déclencheur « dès que » d'une pipe screenpipe en règle déterministe du moteur. " +
        "Choisis l'événement géré qui correspond, et des conditions sur ses champs seulement. Pour une source web, " +
        "vise la source par « nom egal <nom exact> » parmi les sources surveillées. Si rien ne couvre le déclencheur " +
        "(appli active, texte à l'écran, phrase prononcée, source absente…), réponds possible=false avec un motif clair. " +
        "Traduction fidèle : n'élargis jamais le déclencheur. Ajoute des essais qui distinguent bien les deux cas.",
      contenu:
        `Pipe : ${titre} (id ${pipe})\nDescription : ${cfg.description || "(aucune)"}\nDéclencheur à traduire : « ${declencheur} »\n\n` +
        `Événements gérés :\n${Object.entries(EVENEMENTS).map(([k, v]) => `- ${k} : ${v.sens} ; champs : ${v.champs?.join(", ") ?? "libres"}`).join("\n")}\n\n` +
        `Sources surveillées :\n${sources.map((s) => (s.type === "web" ? `- web « ${s.nom} » (${s.url})` : `- ${s.type} ${s.mailbox ?? ""}`)).join("\n") || "(aucune)"}`,
      schema: SCHEMA_TRADUCTION,
    });
  } catch (e: any) {
    return { ...base, motif: `traduction impossible : ${e.message}` };
  }
  if (!t.possible) return { ...base, statut: "refusee", motif: t.motif_refus || "déclencheur non géré" };
  const [source, type] = t.evenement.split("/") as [Regle["desQue"]["source"], string];
  if (!EVENEMENTS[t.evenement]) return { ...base, statut: "refusee", motif: `événement « ${t.evenement} » non géré` };
  const regle: Regle = {
    id: idReglePipe(pipe),
    nom: `${titre || pipe} — dès que (pipe screenpipe)`,
    active: false,
    desQue: { source, type, ...(t.si.length ? { si: t.si } : {}) },
    alors: { mode: "fixe", action: "pipe.lancer", params: { pipe } },
    validation: "auto",
  };
  const acces = await verifierAcces(regle, cfg);
  const essais = rejouerEssais(regle, t.essais);
  const manques = acces.filter((a) => !a.ok).map((a) => `${a.acces} : ${a.detail}`);
  if (manques.length || !essais.ok) {
    return { ...base, statut: "refusee", regle, acces, essais: essais.lignes, motif: [...manques, ...(essais.ok ? [] : ["essais en échec"])].join(" ; ") };
  }
  return { ...base, statut: "a_valider", regle, acces, essais: essais.lignes };
}

const conditionsTexte = (si: Condition[] = []) => si.map((c) => `${c.champ} ${c.op} ${c.valeur}`).join(" et ");

// Déclencheurs validés par un humain (pipe → texte), gardés sur disque pour survivre aux redémarrages.
const fichierValides = () => process.env.FICHIER_PIPES_DES_QUE ?? "data/pipes-des-que.json";
async function lireValides(): Promise<Record<string, string>> {
  const f = Bun.file(fichierValides());
  return (await f.exists()) ? ((await f.json()) as Record<string, string>) : {};
}
// Déclencheurs déjà traités pendant cette session (proposés ou refusés) : pas de nouvel appel à Claude tant qu'ils ne changent pas.
const traites = new Map<string, string>();

/** Validation humaine : l'action « pipe.brancher », validée dans la page, active la règle traduite. */
executeurs["pipe.brancher"] = async (params, bus) => {
  if (!(bus instanceof Moteur)) throw new Error("pipe.brancher : moteur attendu");
  const pipe = String(params.pipe ?? "");
  const regle = params.regle as Regle | undefined;
  if (!regle || regle.id !== idReglePipe(pipe) || regle.alors.mode !== "fixe" || regle.alors.action !== "pipe.lancer" || regle.alors.params.pipe !== pipe) {
    throw new Error("règle de pipe invalide");
  }
  bus.regles = [...bus.regles.filter((r) => r.id !== regle.id), { ...regle, active: true }];
  await bus.sauverRegles();
  const valides = await lireValides();
  valides[pipe] = String(params.declencheur ?? "");
  await Bun.write(fichierValides(), JSON.stringify(valides, null, 2) + "\n");
  bus.diffuser(bus.etat());
  return { branchee: regle.id };
};

/**
 * Synchronisation, appelée toutes les minutes (main.ts) et par la route API. Pour chaque pipe à déclencheur custom :
 * déjà validée et inchangée → rien ; nouvelle ou modifiée → traduction, accès, essais, puis action à valider.
 * Une pipe retirée, désactivée ou sans déclencheur arrête sa règle.
 */
export async function synchroniserAutomatiquement(moteur: Moteur): Promise<RapportPipe[]> {
  const pipes = (await sp<{ data?: { config?: ConfigPipe }[] }>("/pipes")).data ?? [];
  const valides = await lireValides();
  const rapports: RapportPipe[] = [];
  const presentes = new Set<string>();
  let reglesChangees = false;
  const desactiver = (regle: Regle, motif: string) => {
    moteur.regles = moteur.regles.map((r) => (r.id === regle.id ? { ...r, active: false } : r));
    reglesChangees = true;
    moteur.journaliser("alerte", `règle « ${regle.id} » arrêtée : ${motif}`);
  };

  for (const p of pipes) {
    const cfg = p.config ?? {};
    const nom = String(cfg.name ?? "");
    const texte = texteDeclencheur(cfg.trigger?.custom);
    if (!nom || !texte || cfg.enabled === false) continue;
    presentes.add(nom);
    const titre = String(cfg.title ?? nom);
    const regle = moteur.regles.find((r) => r.id === idReglePipe(nom));
    if ((regle?.active && valides[nom] === texte) || traites.get(nom) === texte) {
      rapports.push({ pipe: nom, titre, declencheur: texte, statut: "deja" });
      continue;
    }
    if (regle?.active) desactiver(regle, "déclencheur modifié dans screenpipe, à revalider");
    const r = await traduireDeclencheur(nom, titre, texte, cfg);
    rapports.push(r);
    if (r.statut === "erreur") {
      moteur.journaliser("erreur", `pipe « ${nom} » : ${r.motif}`);
      continue; // réessayé à la prochaine synchronisation
    }
    traites.set(nom, texte);
    if (r.statut === "refusee") {
      moteur.journaliser("alerte", `pipe « ${nom} » non branchée : ${r.motif}`);
      continue;
    }
    const preuve = [
      `Déclencheur écrit dans screenpipe : « ${texte} »`,
      `Accès : ${r.acces!.map((a) => `${a.acces} ${a.ok ? "OK" : "MANQUE"} (${a.detail})`).join(" ; ")}`,
      `Essais rejoués par le moteur :\n${r.essais!.join("\n")}`,
    ].join("\n");
    const si = conditionsTexte(r.regle!.desQue.si);
    moteur.creerAction({
      nom: "pipe.brancher",
      params: { text: `Brancher la pipe « ${titre} » : dès que ${r.regle!.desQue.source}/${r.regle!.desQue.type}${si ? ` si ${si}` : ""} → lancer la pipe`, pipe: nom, declencheur: texte, regle: r.regle },
      preuve,
    });
    moteur.journaliser("info", `pipe « ${nom} » traduite : branchement à valider`);
  }

  for (const regle of moteur.regles.filter((r) => r.id.startsWith("pipe-des-que-") && r.active)) {
    const nom = regle.id.slice("pipe-des-que-".length);
    if (presentes.has(nom)) continue;
    desactiver(regle, "pipe retirée, désactivée ou sans déclencheur dans screenpipe");
    rapports.push({ pipe: nom, titre: nom, declencheur: "", statut: "retiree" });
  }
  if (reglesChangees) await moteur.sauverRegles();
  moteur.diffuser(moteur.etat());
  return rapports;
}
