import { expect, mock, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Regle } from "../src/types";

const dossier = mkdtempSync(join(tmpdir(), "des-que-pipes-"));
process.env.FICHIER_PIPES_DES_QUE = join(dossier, "valides.json");

// Claude et screenpipe simulés : aucun appel réseau.
let appelsClaude = 0;
let traduction: unknown;
const vraiClaude = await import("../src/claude");
mock.module("../src/claude", () => ({ ...vraiClaude, demanderJSON: async () => (appelsClaude++, structuredClone(traduction)) }));
let pipes: { config: Record<string, any> }[] = [];
const vraiScreenpipe = await import("../src/screenpipe");
mock.module("../src/screenpipe", () => ({ ...vraiScreenpipe, sp: async () => ({ data: pipes }) }));

const { config } = await import("../src/config");
const { Moteur } = await import("../src/moteur");
const { executeurs } = await import("../src/actions");
const { rejouerEssais, verifierAcces, synchroniserAutomatiquement, idReglePipe } = await import("../src/pipes-des-que");

config.fichierSources = join(dossier, "sources.json");
await Bun.write(config.fichierSources, JSON.stringify([{ type: "web", nom: "Casque audio", url: "http://127.0.0.1:4310/" }]));

const si = [
  { champ: "nom", op: "egal" as const, valeur: "Casque audio" },
  { champ: "valeur", op: "inferieur" as const, valeur: "90" },
  { champ: "ancienne", op: "superieur" as const, valeur: "90" },
];
const regle: Regle = {
  id: "pipe-des-que-p", nom: "p", active: false,
  desQue: { source: "web", type: "valeur_changee", si },
  alors: { mode: "fixe", action: "pipe.lancer", params: { pipe: "p" } },
  validation: "auto",
};
const declenche = { donnees_json: '{"nom":"Casque audio","valeur":85,"ancienne":"95"}', attendu: true, pourquoi: "passe sous 90" };
const reste = { donnees_json: '{"nom":"Casque audio","valeur":95,"ancienne":"99"}', attendu: false, pourquoi: "reste au-dessus" };

test("essais : rejoués par le moteur, il faut les deux cas et une prédiction juste", () => {
  expect(rejouerEssais(regle, [declenche, reste]).ok).toBe(true);
  expect(rejouerEssais(regle, [{ ...declenche, attendu: false }, reste]).ok).toBe(false);
  expect(rejouerEssais(regle, [declenche]).ok).toBe(false);
});

test("accès : champ absent de l'événement, source web inconnue, cas valide", async () => {
  const fin: Regle = { ...regle, desQue: { source: "screenpipe", type: "meeting_ended", si: [{ champ: "app", op: "contient", valeur: "zoom" }] } };
  expect((await verifierAcces(fin, {}))[0]).toMatchObject({ ok: false, detail: expect.stringContaining("app") });
  const inconnue: Regle = { ...regle, desQue: { ...regle.desQue, si: [{ champ: "nom", op: "egal", valeur: "Bitcoin" }] } };
  expect((await verifierAcces(inconnue, {})).find((a) => a.acces === "source web")?.ok).toBe(false);
  expect((await verifierAcces(regle, {})).every((a) => a.ok)).toBe(true);
});

test("synchronisation : rien de branché sans validation, pas de nouvel appel si inchangé, suivi des modifications", async () => {
  const moteur = new Moteur(join(dossier, "regles.json"));
  const id = idReglePipe("alerte-casque");
  const regleDe = () => moteur.regles.find((r) => r.id === id);
  const aValider = () => [...moteur.actions.values()].filter((a) => a.nom === "pipe.brancher" && a.statut === "proposee");
  traduction = { possible: true, evenement: "web/valeur_changee", si, essais: [declenche, reste], motif_refus: "" };
  pipes = [{ config: { name: "alerte-casque", title: "Alerte casque", enabled: true, trigger: { custom: "dès que le casque passe sous 90 €" } } }];

  expect((await synchroniserAutomatiquement(moteur))[0]!.statut).toBe("a_valider");
  expect(appelsClaude).toBe(1);
  expect(regleDe()).toBeUndefined();
  expect(aValider()).toHaveLength(1);

  await synchroniserAutomatiquement(moteur);
  expect(appelsClaude).toBe(1);
  expect(aValider()).toHaveLength(1);

  await moteur.valider(aValider()[0]!.id);
  expect(regleDe()?.active).toBe(true);
  await synchroniserAutomatiquement(moteur);
  expect(appelsClaude).toBe(1);

  pipes[0]!.config.trigger.custom = "dès que le casque passe sous 80 €";
  expect((await synchroniserAutomatiquement(moteur))[0]!.statut).toBe("a_valider");
  expect(appelsClaude).toBe(2);
  expect(regleDe()?.active).toBe(false);

  await moteur.valider(aValider()[0]!.id);
  pipes = [];
  expect((await synchroniserAutomatiquement(moteur)).map((r) => r.statut)).toEqual(["retiree"]);
  expect(regleDe()?.active).toBe(false);
});

test("refus mémorisé : un déclencheur impossible n'est traduit qu'une fois", async () => {
  const moteur = new Moteur(join(dossier, "regles-refus.json"));
  const avant = appelsClaude;
  traduction = { possible: false, evenement: "webhook/*", si: [], essais: [], motif_refus: "texte à l'écran non géré" };
  pipes = [{ config: { name: "ecran", enabled: true, trigger: { custom: ["dès que je vois « facture » à l'écran"] } } }];
  expect((await synchroniserAutomatiquement(moteur))[0]).toMatchObject({ statut: "refusee", motif: "texte à l'écran non géré" });
  await synchroniserAutomatiquement(moteur);
  expect(appelsClaude).toBe(avant + 1);
});

test("pipe.brancher refuse une règle qui ne lance pas sa pipe", async () => {
  const moteur = new Moteur(join(dossier, "regles-forge.json"));
  const forgee = { ...regle, alors: { mode: "fixe", action: "ouvrir", params: { url: "https://exemple.invalid" } } };
  await expect(executeurs["pipe.brancher"]!({ pipe: "p", regle: forgee }, moteur)).rejects.toThrow("règle de pipe invalide");
});
