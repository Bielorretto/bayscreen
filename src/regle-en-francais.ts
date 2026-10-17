// Propriétaire : Dev 2. « Écris ta règle en français » : Claude traduit une phrase en règle du moteur.
// Rien n'est posé ici : la page montre la règle et les essais rejoués, puis l'utilisateur clique « Créer »
// (POST /api/regles). Les essais sont rejoués par le moteur, sans Claude, comme pour le pont des pipes.

import { demanderJSON } from "./claude";
import { EVENEMENTS, rejouerEssais } from "./pipes-des-que";
import type { Condition, Regle } from "./types";

/** Ce qu'une règle écrite en français peut faire : des messages. Rien qui ouvre une page, appelle une URL ou lance une pipe. */
export const ACTIONS_REGLE = ["notifier", "slack.envoyer", "telegram.envoyer", "discord.envoyer"];
export const MAX_PHRASE = 500;

const SCHEMA = {
  type: "object",
  properties: {
    possible: { type: "boolean", description: "false si aucun événement géré ne couvre la phrase" },
    motif_refus: { type: "string", description: "explication courte si possible=false, sinon chaîne vide" },
    nom: { type: "string", description: "nom court de la règle, 60 caractères au plus" },
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
    mode: { type: "string", enum: ["fixe", "ia"], description: "fixe : le message est écrit d'avance ; ia : Claude rédige le message à chaque événement" },
    action: { type: "string", enum: ACTIONS_REGLE },
    message: { type: "string", description: "mode fixe : le message, avec {{champ}} pour insérer un champ de l'événement ; mode ia : chaîne vide" },
    consigne: { type: "string", description: "mode ia : ce que Claude doit rédiger à chaque événement ; mode fixe : chaîne vide" },
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
  },
  required: ["possible", "motif_refus", "nom", "evenement", "si", "mode", "action", "message", "consigne", "essais"],
  additionalProperties: false,
};

type Traduction = {
  possible: boolean;
  motif_refus: string;
  nom: string;
  evenement: string;
  si: Condition[];
  mode: "fixe" | "ia";
  action: string;
  message: string;
  consigne: string;
  essais: { donnees_json: string; attendu: boolean; pourquoi: string }[];
};

export type RegleTraduite = { ok: true; regle: Regle; essais: string[] } | { ok: false; motif: string; essais?: string[] };

/** Traduit une phrase en règle, vérifie champs et action, rejoue les essais. Ne pose rien. */
export async function traduireRegle(phrase: string, demander: typeof demanderJSON = demanderJSON): Promise<RegleTraduite> {
  const t = await demander<Traduction>({
    systeme:
      "Tu traduis une règle « dès que X, fais Y » écrite en français par l'utilisateur en règle déterministe du moteur. " +
      "Choisis l'événement géré qui correspond, et des conditions sur ses champs seulement. Traduction fidèle : n'élargis " +
      "jamais la règle. Si rien ne couvre la phrase, réponds possible=false avec un motif clair. Action : un message à " +
      "l'utilisateur (notifier) ou sur Slack, Telegram ou Discord. Ajoute des essais qui distinguent bien les deux cas.",
    contenu:
      `Phrase de l'utilisateur : « ${phrase} »\n\nÉvénements gérés :\n` +
      Object.entries(EVENEMENTS)
        .map(([k, v]) => `- ${k} : ${v.sens} ; champs : ${v.champs?.join(", ") ?? "libres"}`)
        .join("\n"),
    schema: SCHEMA,
    delaiMs: 30_000,
    nouvellesTentatives: 1,
  });
  if (!t.possible) return { ok: false, motif: t.motif_refus || "règle non gérée" };
  // Revérifié ici : le schéma ne suffit pas à garantir ce que le moteur saura évaluer.
  const evt = EVENEMENTS[t.evenement];
  if (!evt) return { ok: false, motif: `événement « ${t.evenement} » non géré` };
  const inconnu = evt.champs && t.si.find((c) => !evt.champs!.includes(c.champ));
  if (inconnu) return { ok: false, motif: `champ « ${inconnu.champ} » absent de l'événement ${t.evenement}` };
  if (!ACTIONS_REGLE.includes(t.action)) return { ok: false, motif: `action « ${t.action} » non permise` };
  const texte = (t.mode === "ia" ? t.consigne : t.message).trim();
  if (!texte) return { ok: false, motif: t.mode === "ia" ? "consigne vide" : "message vide" };

  const [source, type] = t.evenement.split("/") as [Regle["desQue"]["source"], string];
  const regle: Regle = {
    id: `fr-${crypto.randomUUID().slice(0, 8)}`,
    nom: (t.nom.trim() || phrase).slice(0, 80),
    active: true,
    desQue: { source, type, ...(t.si.length ? { si: t.si } : {}) },
    alors:
      t.mode === "ia"
        ? { mode: "ia", consigne: texte, actionsPermises: [t.action] }
        : { mode: "fixe", action: t.action, params: { [t.action === "discord.envoyer" ? "content" : "text"]: texte } },
    // Une notification à soi part seule ; un message vers d'autres attend toujours le clic.
    validation: t.mode === "fixe" && t.action === "notifier" ? "auto" : "demander",
  };
  const essais = rejouerEssais(regle, t.essais);
  if (!essais.ok) return { ok: false, motif: "les essais rejoués par le moteur ne correspondent pas à la phrase", essais: essais.lignes };
  return { ok: true, regle, essais: essais.lignes };
}
