import { expect, test } from "bun:test";
import { config } from "../src/config";
import { notificationPour, origineAcceptee } from "../src/serveur";
import type { Action } from "../src/types";

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
