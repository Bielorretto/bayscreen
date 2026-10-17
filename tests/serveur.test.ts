import { expect, test } from "bun:test";
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

test("notificationPour : une proposition Discord porte le bouton qui envoie par screenpipe", () => {
  const n = notificationPour({ type: "action", action: action({ preuve: "mail de Camille" }) })!;
  expect(n.actions![0]).toMatchObject({ type: "api", url: "/connections/discord/proxy", method: "POST" });
  expect(n.actions!.at(-1)!.type).toBe("dismiss");
  expect(n.body).toContain("Pourquoi");
  // Une autre action ne se valide pas depuis la notification : seul « Refuser » reste.
  expect(notificationPour({ type: "action", action: action({ nom: "notifier", params: { text: "x" } }) })!.actions).toHaveLength(1);
  expect(notificationPour({ type: "action", action: action({ statut: "executee" }) })).toBeNull();
  expect(notificationPour({ type: "journal", ligne: { date: "", niveau: "info", message: "x" } })).toBeNull();
});
