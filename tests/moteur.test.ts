import { afterAll, describe, expect, spyOn, test } from "bun:test";
import { conditionVraie, Moteur, regleCorrespond, remplir } from "../src/moteur";
import { screenpipe, texteBrut } from "../src/screenpipe";
import type { Evenement, Regle } from "../src/types";

// L'exécuteur notifier écrit dans l'appli screenpipe : pas de vraie notification pendant les tests.
const notif = spyOn(screenpipe, "notifier").mockResolvedValue(undefined);
afterAll(() => notif.mockRestore());

const evt = (donnees: Record<string, unknown>): Evenement => ({
  id: "e1",
  source: "web",
  type: "valeur_changee",
  date: new Date().toISOString(),
  donnees,
});

const regleSeuil: Regle = {
  id: "r1",
  nom: "seuil",
  active: true,
  desQue: { source: "web", type: "valeur_changee", si: [{ champ: "valeur", op: "superieur", valeur: 100 }] },
  alors: { mode: "fixe", action: "notifier", params: { text: "{{nom}} vaut {{valeur}}" } },
  validation: "auto",
};

describe("conditions et correspondance", () => {
  test("opérateurs", () => {
    expect(conditionVraie({ champ: "a.b", op: "egal", valeur: "x" }, { a: { b: "x" } })).toBe(true);
    expect(conditionVraie({ champ: "t", op: "contient", valeur: "URGENT" }, { t: "c'est urgent" })).toBe(true);
    expect(conditionVraie({ champ: "n", op: "inferieur", valeur: 3 }, { n: 2 })).toBe(true);
  });
  test("une règle ne correspond que si source, type et conditions collent", () => {
    expect(regleCorrespond(regleSeuil, evt({ valeur: 120 }))).toBe(true);
    expect(regleCorrespond(regleSeuil, evt({ valeur: 80 }))).toBe(false);
    expect(regleCorrespond({ ...regleSeuil, active: false }, evt({ valeur: 120 }))).toBe(false);
  });
  test("remplir remplace les {{champs}}", () => {
    expect(remplir({ text: "{{nom}} = {{v.x}}" }, { nom: "cours", v: { x: 3 } })).toEqual({ text: "cours = 3" });
  });
});

describe("Moteur", () => {
  test("règle fixe en validation auto : l'action est exécutée", async () => {
    const m = new Moteur("/dev/null");
    m.regles = [regleSeuil];
    const statutsDiffuses: string[] = [];
    m.abonner((msg) => void (msg.type === "action" && statutsDiffuses.push(msg.action.statut)));
    await m.emettre(evt({ nom: "cours", valeur: 120 }));
    const actions = [...m.actions.values()];
    expect(actions).toHaveLength(1);
    expect(actions[0]).toMatchObject({ nom: "notifier", statut: "executee", params: { text: "cours vaut 120" } });
    expect(statutsDiffuses).not.toContain("proposee");
    expect(notif).toHaveBeenLastCalledWith(expect.objectContaining({ pipe_name: "des-que", body: texteBrut("cours vaut 120") }));
  });

  test("règle fixe à valider : l'action attend, puis s'exécute à la validation", async () => {
    const m = new Moteur("/dev/null");
    m.regles = [{ ...regleSeuil, validation: "demander" }];
    await m.emettre(evt({ nom: "cours", valeur: 120 }));
    const [a] = [...m.actions.values()];
    expect(a!.statut).toBe("proposee");
    await m.valider(a!.id);
    expect(a!.statut).toBe("executee");
  });

  test("anti-boucle : un événement screenpipe émis par des-que ne déclenche rien", async () => {
    const m = new Moteur("/dev/null");
    m.regles = [{ ...regleSeuil, desQue: { source: "screenpipe", type: "*" } }];
    await m.emettre({ ...evt({ nom: "x", valeur: 1 }), source: "screenpipe", origine: "des-que" });
    expect(m.actions.size).toBe(0);
    await m.emettre({ ...evt({ nom: "x", valeur: 1 }), source: "screenpipe" });
    expect(m.actions.size).toBe(1);
  });

  test("exécuteur inconnu : l'action passe en échec sans faire tomber le moteur", async () => {
    const m = new Moteur("/dev/null");
    m.regles = [{ ...regleSeuil, alors: { mode: "fixe", action: "nimporte.quoi", params: {} } }];
    await m.emettre(evt({ valeur: 120 }));
    const [a] = [...m.actions.values()];
    expect(a!.statut).toBe("echec");
  });
});
