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
