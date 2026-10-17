import { expect, test } from "bun:test";
import { config } from "../src/config";
import { texteBrut } from "../src/screenpipe";
import { notificationPour, origineAcceptee, poserRegle, validerOuRefuser } from "../src/serveur";
import type { Action, MessageUI, Regle } from "../src/types";

const req = (headers: Record<string, string>) =>
  new Request("http://127.0.0.1:4300/api/regles", { method: "POST", headers });

test("origineAcceptee : la page et curl passent, un autre site ou un autre nom non", () => {
  expect(origineAcceptee(req({ host: "127.0.0.1:4300" }), 4300)).toBe(true);
  expect(origineAcceptee(req({ host: "localhost:4300", origin: "http://localhost:4300" }), 4300)).toBe(true);
  expect(origineAcceptee(req({ host: "127.0.0.1:4300", origin: "https://exemple.invalid" }), 4300)).toBe(false);
  expect(origineAcceptee(req({ host: "127.0.0.1:4300", origin: "null" }), 4300)).toBe(false);
  expect(origineAcceptee(req({ host: "piege.exemple.invalid:4300" }), 4300)).toBe(false); // DNS rebinding
});

test("origineAcceptee : l'appli screenpipe n'a que l'état des pipes, la synchronisation et Valider / Refuser", () => {
  const depuisScreenpipe = (chemin: string, host = "127.0.0.1:4300") =>
    new Request(`http://127.0.0.1:4300${chemin}`, { method: "POST", headers: { host, origin: "tauri://localhost" } });
  for (const permis of ["/api/pipes/etat", "/api/pipes/synchroniser", "/api/actions/a1/valider", "/api/actions/a1/refuser"])
    expect(origineAcceptee(depuisScreenpipe(permis), 4300)).toBe(true);
  for (const refuse of ["/api/regles", "/api/evenements", "/api/etat", "/api/copilote/question", "/api/actions/a1/valider/x"])
    expect(origineAcceptee(depuisScreenpipe(refuse), 4300)).toBe(false);
  expect(origineAcceptee(depuisScreenpipe("/api/pipes/etat", "piege.exemple.invalid:4300"), 4300)).toBe(false);
});

const action = (a: Partial<Action>): Action => ({
  id: "a1",
  nom: "discord.envoyer",
  params: { content: "Devis n° 42 reçu" },
  statut: "proposee",
  creeeLe: "",
  ...a,
});

test("notificationPour : une proposition reste affichée et mène à la page, où l'on valide", () => {
  const n = notificationPour({ type: "action", action: action({ preuve: "mail de Camille" }) })!;
  expect(n.autoDismissMs).toBe(0);
  expect(n.actions!.map((b) => [b.id, b.type])).toEqual([["valider", "deeplink"], ["refuser", "deeplink"]]);
  const prompt = new URL(n.actions![0]!.url!).searchParams.get("prompt")!;
  expect(n.actions![0]!.url).toStartWith("screenpipe://chat/new?v=1&prompt=");
  expect(prompt).toContain(`curl -s -X POST http://127.0.0.1:${config.port}/api/actions/`);
  expect(prompt).toEndWith("/valider");
  expect(n.body).toContain("Pourquoi");
  expect(notificationPour({ type: "action", action: action({ statut: "executee" }) })).toBeNull();
  expect(notificationPour({ type: "journal", ligne: { date: "", niveau: "info", message: "x" } })).toBeNull();
});

test("notificationPour : une pipe que screenpipe ne lance pas dit comment débloquer, avec un bouton deeplink s'il y en a un", () => {
  const echec = (nom: string, erreur: string) => notificationPour({ type: "action", action: action({ nom, statut: "echec", erreur }) })!;
  const plein = echec("pipe.lancer", "No space left on device (os error 28)");
  expect(plein.body).toBe(`${texteBrut("No space left on device (os error 28)")}\n\nPour débloquer : le disque est plein ; libérez de la place, puis relancez la pipe.`);
  expect(plein.actions).toEqual([{ id: "stockage", label: "Libérer de la place", type: "deeplink", url: "screenpipe://settings?section=storage" }]);
  const ferme = echec("pipe.lancer", "ECONNREFUSED: Unable to connect. Is the computer able to access the url?");
  expect(ferme.body).toEndWith("\n\nPour débloquer : screenpipe ne répond pas ; relancez l'appli screenpipe, puis la pipe.");
  expect(ferme.actions).toBeUndefined();
  // Les autres actions en échec : inchangé.
  expect(echec("discord.envoyer", "webhook → 500")).toEqual({ pipe_name: "des-que", title: "Dès que : discord.envoyer en échec", body: texteBrut("webhook → 500"), priority: "high" });
});

test("validerOuRefuser : depuis l'appli screenpipe, seulement le branchement d'une pipe qui existe", async () => {
  // Faux moteur : rien n'est exécuté, on note seulement les gestes qui passent.
  const gestes: string[] = [];
  const moteur = {
    actions: new Map([
      ["a-pipe", action({ id: "a-pipe", nom: "pipe.brancher" })],
      ["a-discord", action({ id: "a-discord" })],
    ]),
    valider: async (id: string) => void gestes.push(`valider ${id}`),
    refuser: (id: string) => void gestes.push(`refuser ${id}`),
  };
  const geste = (id: string, verbe: string, origin?: string) =>
    validerOuRefuser(new Request(`http://127.0.0.1:4300/api/actions/${id}/${verbe}`, { method: "POST", headers: origin ? { origin } : {} }), moteur, id, verbe);
  for (const [id, verbe] of [["a-discord", "valider"], ["a-discord", "refuser"], ["inconnue", "valider"], ["inconnue", "refuser"]]) {
    const r = await geste(id!, verbe!, "tauri://localhost");
    expect(r.status).toBe(403);
    expect(await r.json()).toHaveProperty("erreur");
  }
  expect(gestes).toEqual([]);
  expect((await geste("a-pipe", "valider", "tauri://localhost")).status).toBe(200);
  expect((await geste("a-pipe", "refuser", "tauri://localhost")).status).toBe(200);
  // Autres origines inchangées : curl du chat screenpipe (sans origine), page du moteur.
  expect((await geste("a-discord", "valider")).status).toBe(200);
  expect((await geste("a-discord", "refuser", "http://127.0.0.1:4300")).status).toBe(200);
  expect(gestes).toEqual(["valider a-pipe", "refuser a-pipe", "valider a-discord", "refuser a-discord"]);
});

test("poserRegle : la règle d'une pipe screenpipe ne se pose pas par l'API, les autres oui", async () => {
  const sauvees: string[][] = [];
  const moteur = {
    regles: [] as Regle[],
    sauverRegles: async () => void sauvees.push(moteur.regles.map((r) => r.id)),
    diffuser: () => {},
    etat: (): MessageUI => ({ type: "etat", regles: [], actions: [], journal: [] }),
  };
  const regle = (id: string): Regle => ({ id, nom: id, active: true, desQue: { source: "mail", type: "mail_recu" }, alors: { mode: "fixe", action: "pipe.lancer", params: { pipe: "alerte-e" } }, validation: "auto" });
  const refus = await poserRegle(moteur, regle("pipe-des-que-alerte-e"));
  expect(refus.status).toBe(403);
  expect(await refus.json()).toHaveProperty("erreur");
  expect(sauvees).toEqual([]);
  expect((await poserRegle(moteur, regle("ma-regle"))).status).toBe(200);
  expect(sauvees).toEqual([["ma-regle"]]);
});
