// Propriétaire : Dev 2 (complété par Dev 1 sur la branche integration-screenpipe). Pont « dès que » des pipes screenpipe.
// screenpipe accepte dans pipe.md un déclencheur `custom` en langage naturel, mais ne l'évalue jamais
// (screenpipe-core, pipes/mod.rs : « future: matched via embedding similarity »). Ce pont lit les pipes,
// fait traduire chaque déclencheur par Claude en règle déterministe, vérifie les accès dont elle a besoin,
// rejoue des essais sans Claude, puis PROPOSE le branchement : rien ne tourne avant le clic « Valider ».
// Un déclencheur modifié dans screenpipe est retraduit ; une pipe retirée arrête sa règle. Au lancement, la pipe est
// revérifiée, puis reçoit en contexte (run_context) son déclencheur et des nombres de l'événement, jamais son texte.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { executeurs, lancerPipe } from "./actions";
import { demanderJSON } from "./claude";
import { config } from "./config";
import { Moteur, regleCorrespond } from "./moteur";
import { sp } from "./screenpipe";
import { nombre } from "./sources/web";
import type { Bus, Condition, Evenement, Regle } from "./types";

/**
 * Événements que le moteur reçoit réellement, avec les champs de leurs données (null : données libres).
 * contexte : les champs que reçoit la pipe lancée, des nombres seulement. Jamais un texte venu de l'extérieur (corps ou
 * objet d'un mail, page relevée, transcription, titre de visio) : l'agent d'une pipe a bash et curl.
 */
export const EVENEMENTS: Record<string, { champs: string[] | null; sens: string; contexte: string[] }> = {
  "web/valeur_changee": { champs: ["nom", "url", "valeur", "valeurTexte", "ancienne"], sens: "une valeur relevée sur une page ou une API surveillée change ; nom = nom de la source, valeur = nouvelle valeur (nombre), ancienne = valeur précédente", contexte: ["valeur", "ancienne"] },
  "mail/mail_recu": { champs: ["expediteur", "objet", "corps"], sens: "un mail arrive dans un dossier IMAP surveillé", contexte: [] },
  "screenpipe/meeting_started": { champs: ["meeting_id", "app", "title", "detection_source"], sens: "une visio commence", contexte: ["meeting_id"] },
  // Vérifié en réel : meeting_ended n'a ni app ni title (docs/SCREENPIPE.md).
  "screenpipe/meeting_ended": { champs: ["meeting_id", "duration_secs", "meeting_end", "transcript_segments"], sens: "une visio se termine (sans app ni titre)", contexte: ["meeting_id", "duration_secs", "transcript_segments"] },
  "appel/visio_terminee": { champs: ["meetingId", "app", "nbLignes", "transcription"], sens: "fin de visio vue par le copilote, avec l'appli et la transcription", contexte: ["meetingId", "nbLignes"] },
  "webhook/*": { champs: null, sens: "toute donnée envoyée à POST /api/evenements avec la source webhook", contexte: [] },
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

/** Paramètres de la règle d'une pipe : la pipe, et les champs « contexte » de son événement, qu'elle recevra. */
function paramsPipe(pipe: string, desQue: Regle["desQue"]): Record<string, unknown> {
  const contexte = EVENEMENTS[`${desQue.source}/${desQue.type}`]?.contexte ?? [];
  return contexte.length ? { pipe, evenement: Object.fromEntries(contexte.map((c) => [c, `{{${c}}}`])) } : { pipe };
}

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
      // Les synchronisations passent une à la fois : un Claude lent ne les bloque pas plus de 45 s.
      delaiMs: 45_000,
      nouvellesTentatives: 1,
    });
  } catch (e: any) {
    return { ...base, motif: `traduction impossible : ${e.message}` };
  }
  if (!t.possible) return { ...base, statut: "refusee", motif: t.motif_refus || "déclencheur non géré" };
  const [source, type] = t.evenement.split("/") as [Regle["desQue"]["source"], string];
  if (!EVENEMENTS[t.evenement]) return { ...base, statut: "refusee", motif: `événement « ${t.evenement} » non géré` };
  const desQue: Regle["desQue"] = { source, type, ...(t.si.length ? { si: t.si } : {}) };
  const regle: Regle = {
    id: idReglePipe(pipe),
    nom: `${titre || pipe} — dès que (pipe screenpipe)`,
    active: false,
    desQue,
    alors: { mode: "fixe", action: "pipe.lancer", params: paramsPipe(pipe, desQue) },
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

/** Champs de l'événement que la règle d'une pipe lui transmet (clés de params.evenement). */
function champsTransmis(r: Regle): string[] {
  const e = r.alors.mode === "fixe" ? r.alors.params.evenement : undefined;
  return e && typeof e === "object" ? Object.keys(e) : [];
}
/** Ce que la pipe reçoit à chaque lancement, dit à l'humain avant qu'il valide. */
const transmis = (r: Regle) => {
  const champs = champsTransmis(r);
  return champs.length ? `le déclencheur et les nombres ${champs.join(", ")} de l'événement` : "le déclencheur seul, rien de l'événement";
};
const conditionsTexte = (si: Condition[] = []) => si.map((c) => `${c.champ} ${c.op} ${c.valeur}`).join(" et ");
/** La règle en une ligne : « dès que web/valeur_changee si nom egal Casque audio → lancer la pipe, en envoyant à son modèle … ». */
const resumeRegle = (r: Regle) => {
  const si = conditionsTexte(r.desQue.si);
  return `dès que ${r.desQue.source}/${r.desQue.type}${si ? ` si ${si}` : ""} → lancer la pipe, en envoyant à son modèle ${transmis(r)}`;
};
const lirePipes = async () => (await sp<{ data?: { config?: ConfigPipe }[] }>("/pipes")).data ?? [];

/** Ce qu'un humain a validé pour une pipe : le texte de son déclencheur et la règle qui en est née, à l'identique. */
type Validation = { texte: string; desQue: Regle["desQue"]; alors: Regle["alors"] };
/** La règle est-elle exactement celle que l'humain a validée (même desQue, même alors) ? Posée ou modifiée sans lui : non. */
const estValidee = (r: Regle, v: Partial<Validation> | undefined) =>
  !!v?.desQue && JSON.stringify([r.desQue, r.alors]) === JSON.stringify([v.desQue, v.alors]);

// Validations humaines (pipe → Validation), gardées sur disque pour survivre aux redémarrages. Lues et écrites sans
// await : brancher enregistre la validation et arme la règle d'un seul geste, qu'aucune synchronisation ni aucun
// lancement ne peut couper (sinon ils verraient la règle armée sans sa validation, et la désarmeraient).
const fichierValides = () => process.env.FICHIER_PIPES_DES_QUE ?? "data/pipes-des-que.json";
/** Une entrée de l'ancien format (le texte seul) ne vaut pour aucune règle : la pipe est désarmée, puis reproposée. */
function lireValides(): Record<string, Partial<Validation>> {
  const brut = existsSync(fichierValides()) ? (JSON.parse(readFileSync(fichierValides(), "utf8")) as Record<string, unknown>) : {};
  return Object.fromEntries(Object.entries(brut).map(([k, v]) => [k, (typeof v === "string" ? { texte: v } : v) as Partial<Validation>]));
}
function ecrireValidation(pipe: string, v: Validation) {
  const valides = { ...lireValides(), [pipe]: v };
  mkdirSync(dirname(fichierValides()), { recursive: true });
  writeFileSync(fichierValides(), JSON.stringify(valides, null, 2) + "\n");
}
// Déclencheurs déjà traités pendant cette session (proposés ou refusés) : pas de nouvel appel à Claude tant qu'ils ne changent pas.
const traites = new Map<string, string>();

export type EtatPipe = Pick<RapportPipe, "declencheur" | "acces" | "essais" | "motif"> & {
  statut: Exclude<RapportPipe["statut"], "deja"> | "branchee";
  regle?: string;
  actionId?: string;
};
// Dernier rapport de chaque pipe, et l'action proposée pour elle : affichés sous le déclencheur dans screenpipe.
const etats = new Map<string, EtatPipe>();

/** État de chaque pipe « dès que » (GET /api/pipes/etat). La décision prise depuis et la règle validée active l'emportent sur le rapport. */
export async function etatPipes(moteur: Moteur): Promise<Record<string, EtatPipe>> {
  const res: Record<string, EtatPipe> = {};
  for (const [nom, e] of etats) {
    const a = e.actionId ? moteur.actions.get(e.actionId) : undefined;
    if (!a || a.statut === "proposee") res[nom] = e;
    else if (a.statut === "refusee") res[nom] = { ...e, statut: "refusee", motif: "branchement refusé", actionId: undefined };
    else if (a.statut === "echec") res[nom] = { ...e, statut: "erreur", motif: a.erreur, actionId: undefined };
    else res[nom] = { ...e, actionId: undefined }; // validée : la règle active, ci-dessous, dit « branchée »
  }
  const valides = lireValides();
  for (const r of moteur.regles.filter((r) => r.id.startsWith("pipe-des-que-") && r.active)) {
    const nom = r.id.slice("pipe-des-que-".length);
    // Armée sans validation (règle posée ou modifiée à la main) : jamais « branchée » ; la synchronisation l'arrête.
    if (estValidee(r, valides[nom])) res[nom] = { declencheur: valides[nom]!.texte ?? "", statut: "branchee", regle: resumeRegle(r) };
  }
  return res;
}

/** Validation humaine : l'action « pipe.brancher », validée dans la page, active la règle traduite. */
executeurs["pipe.brancher"] = (params, bus) =>
  brancher(params, bus).catch((e) => {
    traites.delete(String(params.pipe ?? "")); // la synchronisation suivante repropose ce déclencheur
    throw e;
  });

async function brancher(params: Record<string, unknown>, bus: Bus) {
  if (!(bus instanceof Moteur)) throw new Error("pipe.brancher : moteur attendu");
  const pipe = String(params.pipe ?? "");
  const regle = params.regle as Regle | undefined;
  // Paramètres exactement ceux que la traduction produit pour cet événement : la pipe, et les nombres de son contexte.
  if (!regle?.desQue || regle.id !== idReglePipe(pipe) || regle.alors?.mode !== "fixe" || regle.alors.action !== "pipe.lancer" || JSON.stringify(regle.alors.params) !== JSON.stringify(paramsPipe(pipe, regle.desQue))) {
    throw new Error("règle de pipe invalide");
  }
  // Vérifié au moment de brancher : le déclencheur a pu changer, ou la pipe disparaître, depuis la proposition.
  const cfg = (await lirePipes()).find((p) => p.config?.name === pipe)?.config;
  const texte = texteDeclencheur(cfg?.trigger?.custom);
  if (!cfg || cfg.enabled === false || texte !== params.declencheur) {
    throw new Error("déclencheur modifié ou pipe retirée depuis la proposition : rien n'est branché");
  }
  // Validation enregistrée, puis règle armée, sans await entre les deux.
  ecrireValidation(pipe, { texte, desQue: regle.desQue, alors: regle.alors });
  bus.regles = [...bus.regles.filter((r) => r.id !== regle.id), { ...regle, active: true }];
  await bus.sauverRegles();
  bus.diffuser(bus.etat());
  return { branchee: regle.id };
}

/** Ce que la pipe reçoit de l'événement : les champs de la règle validée qui sont des nombres. Ni texte, ni autre clé. */
function nombresTransmis(r: Regle, evenement: unknown): Record<string, number> {
  const donnees = evenement && typeof evenement === "object" ? (evenement as Record<string, unknown>) : {};
  return Object.fromEntries(
    champsTransmis(r).flatMap((c) => {
      const v = donnees[c];
      const n = typeof v === "number" ? v : typeof v === "string" && v.trim() ? nombre(v) : null;
      return n !== null && Number.isFinite(n) ? [[c, n]] : [];
    }),
  );
}

/**
 * Lancement par une règle du pont : la pipe est revérifiée. Retirée, désactivée, déclencheur modifié depuis la validation,
 * ou règle différente de celle validée : elle ne part pas et sa règle s'arrête. Sinon elle reçoit en run_context son
 * déclencheur et les nombres listés par la règle validée. Hors moteur, ou sans règle du pont active : l'exécuteur d'origine.
 */
const lancerHorsPont = executeurs["pipe.lancer"]!;
executeurs["pipe.lancer"] = async (params, bus) => {
  if (!(bus instanceof Moteur) || typeof params.pipe !== "string") return lancerHorsPont(params, bus);
  const pipe = params.pipe;
  const regle = bus.regles.find((r) => r.active && r.id === idReglePipe(pipe));
  if (!regle) return lancerHorsPont(params, bus);
  const v = lireValides()[pipe]; // au même instant que la règle (voir lireValides)
  const cfg = (await lirePipes()).find((p) => p.config?.name === pipe)?.config;
  const texte = texteDeclencheur(cfg?.trigger?.custom);
  const ecart =
    !cfg || cfg.enabled === false || texte !== v?.texte
      ? "pipe retirée, désactivée ou déclencheur modifié depuis la validation"
      : estValidee(regle, v)
        ? ""
        : "règle différente de celle validée";
  if (ecart) {
    bus.regles = bus.regles.map((r) => (r === regle ? { ...r, active: false } : r));
    await bus.sauverRegles();
    traites.delete(pipe); // reproposée à la synchronisation suivante, même si son texte redevient celui validé
    etats.set(pipe, { declencheur: texte, statut: "retiree", motif: ecart });
    bus.journaliser("alerte", `règle « ${regle.id} » arrêtée au lancement : ${ecart}`);
    bus.diffuser(bus.etat());
    throw new Error(`${ecart} : non lancée`);
  }
  return lancerPipe(pipe, { run_context: { source: "des-que", condition: texte, evenement: nombresTransmis(regle, params.evenement) } });
};

/**
 * Synchronisation, appelée toutes les minutes (main.ts) et par la route API. D'abord, sans attendre Claude, elle arrête
 * la règle de toute pipe retirée, désactivée, sans déclencheur, au déclencheur modifié, ou dont la règle n'est pas celle
 * validée. Puis, pour chaque pipe à déclencheur custom : déjà validée et inchangée → rien ; nouvelle ou modifiée →
 * traduction, accès, essais, puis action à valider.
 */
async function synchroniser(moteur: Moteur): Promise<RapportPipe[]> {
  const pipes = await lirePipes();
  const rapports: RapportPipe[] = [];
  // Pipes actives à déclencheur custom, avec leur texte actuel.
  const presentes = new Map<string, string>();
  for (const p of pipes) {
    const nom = String(p.config?.name ?? "");
    const texte = texteDeclencheur(p.config?.trigger?.custom);
    if (nom && texte && p.config?.enabled !== false) presentes.set(nom, texte);
  }
  let reglesChangees = false;
  const desactiver = (regle: Regle, motif: string) => {
    moteur.regles = moteur.regles.map((r) => (r === regle ? { ...r, active: false } : r));
    traites.delete(regle.id.slice("pipe-des-que-".length)); // reproposée ensuite, même si son texte n'a pas changé
    reglesChangees = true;
    moteur.journaliser("alerte", `règle « ${regle.id} » arrêtée : ${motif}`);
  };

  // Désarmer avant de traduire, et sauvegarder : pendant les appels à Claude, aucune de ces règles ne peut partir.
  // Validations et règles lues au même instant (voir lireValides).
  const valides = lireValides();
  const retirees: string[] = [];
  for (const regle of moteur.regles.filter((r) => r.id.startsWith("pipe-des-que-") && r.active)) {
    const nom = regle.id.slice("pipe-des-que-".length);
    const texte = presentes.get(nom);
    if (texte === undefined) {
      desactiver(regle, "pipe retirée, désactivée ou sans déclencheur dans screenpipe");
      retirees.push(nom);
    } else if (valides[nom]?.texte !== texte) desactiver(regle, "déclencheur modifié dans screenpipe, à revalider");
    else if (!estValidee(regle, valides[nom])) desactiver(regle, "règle différente de celle validée, à revalider");
  }
  if (reglesChangees) await moteur.sauverRegles();

  for (const p of pipes) {
    const cfg = p.config ?? {};
    const nom = String(cfg.name ?? "");
    const texte = texteDeclencheur(cfg.trigger?.custom);
    if (!nom || !texte) continue;
    if (cfg.enabled === false) {
      // Affichée sous son déclencheur dans screenpipe ; sa règle, s'il y en avait une, est déjà arrêtée.
      etats.set(nom, { declencheur: texte, statut: "retiree", motif: "pipe désactivée dans screenpipe" });
      continue;
    }
    const titre = String(cfg.title ?? nom);
    const regle = moteur.regles.find((r) => r.id === idReglePipe(nom));
    const v = lireValides()[nom]; // relue : un branchement a pu être validé pendant la traduction d'une autre pipe
    if ((regle?.active && v?.texte === texte && estValidee(regle, v)) || traites.get(nom) === texte) {
      rapports.push({ pipe: nom, titre, declencheur: texte, statut: "deja" });
      continue;
    }
    traites.delete(nom); // traduction en échec : revenir ensuite à l'ancien texte le retraduit, au lieu de « déjà traité »
    const r = await traduireDeclencheur(nom, titre, texte, cfg);
    rapports.push(r);
    etats.set(nom, { declencheur: texte, statut: r.statut as EtatPipe["statut"], regle: r.regle && resumeRegle(r.regle), acces: r.acces, essais: r.essais, motif: r.motif });
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
      `Envoyé au modèle de la pipe à chaque lancement : ${transmis(r.regle!)}. Jamais le texte d'un mail, d'une page ou d'une transcription.`,
    ].join("\n");
    const action = moteur.creerAction({
      nom: "pipe.brancher",
      params: { text: `Brancher la pipe « ${titre} » : ${resumeRegle(r.regle!)}`, pipe: nom, declencheur: texte, regle: r.regle },
      preuve,
    });
    etats.get(nom)!.actionId = action.id;
    moteur.journaliser("info", `pipe « ${nom} » traduite : branchement à valider`);
  }

  // Rapports et états des règles arrêtées plus haut faute de pipe : après les traductions, comme avant.
  for (const nom of retirees) {
    rapports.push({ pipe: nom, titre: nom, declencheur: "", statut: "retiree" });
    if (etats.get(nom)?.statut !== "retiree") etats.set(nom, { declencheur: "", statut: "retiree", motif: "déclencheur retiré ou pipe supprimée dans screenpipe" });
  }
  // Une pipe sortie de la liste est retraduite si elle revient, même avec le même texte.
  for (const nom of traites.keys()) if (!presentes.has(nom)) traites.delete(nom);
  moteur.diffuser(moteur.etat());
  return rapports;
}

// Un passage à la fois (minuterie de main.ts et route API) : sinon deux traductions et deux propositions pour la même pipe.
let file: Promise<unknown> = Promise.resolve();
export function synchroniserAutomatiquement(moteur: Moteur): Promise<RapportPipe[]> {
  const passage = file.then(() => synchroniser(moteur));
  file = passage.catch(() => {});
  return passage;
}
