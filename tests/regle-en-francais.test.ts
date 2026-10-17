import { expect, test } from "bun:test";
import { traduireRegle } from "../src/regle-en-francais";

const facture = {
  possible: true,
  motif_refus: "",
  nom: "Facture reçue",
  evenement: "mail/mail_recu",
  si: [{ champ: "objet", op: "contient", valeur: "facture" }],
  mode: "fixe",
  action: "notifier",
  message: "Facture de {{expediteur}} : {{objet}}",
  consigne: "",
  essais: [
    { donnees_json: '{"objet":"Votre facture d\'octobre","expediteur":"EDF"}', attendu: true, pourquoi: "parle de facture" },
    { donnees_json: '{"objet":"Déjeuner jeudi ?","expediteur":"Marc"}', attendu: false, pourquoi: "pas de facture" },
  ],
};
// Faux Claude : renvoie la traduction donnée, et garde la demande pour la vérifier.
const claude = (t: unknown) => (async () => t) as any;

test("une phrase devient une règle : événement, condition, message, essais rejoués par le moteur", async () => {
  const r = await traduireRegle("Dès qu'un mail parle de facture, préviens-moi", claude(facture));
  expect(r.ok).toBe(true);
  if (!r.ok) return;
  expect(r.regle).toMatchObject({
    nom: "Facture reçue",
    active: true,
    desQue: { source: "mail", type: "mail_recu", si: [{ champ: "objet", op: "contient", valeur: "facture" }] },
    alors: { mode: "fixe", action: "notifier", params: { text: "Facture de {{expediteur}} : {{objet}}" } },
    validation: "auto",
  });
  expect(r.regle.id).toStartWith("fr-");
  expect(r.essais.every((l) => l.startsWith("OK"))).toBe(true);
});

test("un message vers d'autres (Slack) attend toujours la validation ; Discord reçoit content", async () => {
  const slack = await traduireRegle("…", claude({ ...facture, action: "slack.envoyer" }));
  expect(slack.ok && slack.regle.validation).toBe("demander");
  const discord = await traduireRegle("…", claude({ ...facture, action: "discord.envoyer" }));
  expect(discord.ok && discord.regle.alors).toMatchObject({ params: { content: facture.message } });
});

test("refusée : action hors liste, champ que l'événement n'a pas, essais qui contredisent la règle, phrase non gérée", async () => {
  expect(await traduireRegle("…", claude({ ...facture, action: "webhook" }))).toMatchObject({ ok: false, motif: "action « webhook » non permise" });
  expect(await traduireRegle("…", claude({ ...facture, si: [{ champ: "montant", op: "superieur", valeur: "100" }] }))).toMatchObject({ ok: false });
  const contredit = await traduireRegle("…", claude({ ...facture, essais: [{ ...facture.essais[0], attendu: false }, facture.essais[1]] }));
  expect(contredit).toMatchObject({ ok: false, motif: "les essais rejoués par le moteur ne correspondent pas à la phrase" });
  expect(await traduireRegle("…", claude({ ...facture, possible: false, motif_refus: "pas de source pour la météo" }))).toEqual({ ok: false, motif: "pas de source pour la météo" });
});
