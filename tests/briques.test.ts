import { beforeEach, expect, test } from "bun:test";
import * as b from "../src/briques";

const cadreApp = { evenement: "screenpipe/app_active", texte: ["app", "fenetre"], references: ["app", "fenetre"], si: [] };
const cadreMail = { evenement: "mail/mail_recu", texte: ["expediteur", "objet", "corps"], references: ["expediteur", "objet"], si: [] };

let questions: Record<string, any>[] = [];
let reponse: unknown = { reponse: true, raison: "" };
let horloge = 0;
beforeEach(() => {
  b.oublierTout();
  questions = [];
  reponse = { reponse: true, raison: "" };
  horloge = Date.parse("2026-10-18T10:00:00Z");
  b.deps.demander = (async (o: Record<string, any>) => {
    questions.push(o);
    if (reponse instanceof Error) throw reponse;
    return reponse;
  }) as any;
  b.deps.ecran = async () => "CAF Déclaration trimestrielle de ressources";
  b.deps.maintenant = () => horloge;
  b.deps.minuteMs = 1;
});

test("vérification : briques valides normalisées ; hors cadre, refusées avec un motif", () => {
  const ok = b.verifierBriques({ sens: { question: "Est-ce un document administratif ?", depuis: ["fenetre"], apps: ["Aperçu"], ecran: true }, session: null, attente: null, transmettre: ["app", "fenetre"] }, cadreApp);
  expect(ok).toEqual({ ok: true, briques: { sens: { question: "Est-ce un document administratif ?", depuis: ["fenetre"], apps: ["Aperçu"], ecran: true }, session: null, attente: null, transmettre: ["app", "fenetre"] } });
  expect(b.verifierBriques({ transmettre: ["corps"] }, cadreMail).ok).toBe(false); // le corps d'un mail ne se transmet jamais
  expect(b.verifierBriques({ session: { app: "Word", minutes: 5 } }, cadreMail).ok).toBe(false); // session : app_active seulement
  expect(b.verifierBriques({ session: { app: "Word", minutes: 5 } }, { ...cadreApp, si: [{ champ: "app", op: "contient", valeur: "Word" }] }).ok).toBe(false);
  expect(b.verifierBriques({ attente: { minutes: 7200, cle: "corps" } }, cadreMail).ok).toBe(false);
  expect(b.verifierBriques({ session: { app: "Word", minutes: 5 }, attente: { minutes: 5, cle: "app" } }, cadreApp).ok).toBe(false);
  expect(b.verifierBriques({ sens: { question: "{{piège}} ?", depuis: ["objet"], apps: [], ecran: false } }, cadreMail).ok).toBe(false);
  expect(b.verifierBriques({ sens: { question: "Une promesse de rappel ?", depuis: ["objet"], apps: [], ecran: true } }, cadreMail).ok).toBe(false); // ecran : app_active seulement
});

test("sens : filtre d'appli gratuit, puis Haiku une seule fois par document (cache), texte d'écran joint", async () => {
  const s = { question: "Est-ce un document administratif ?", depuis: ["fenetre"], apps: ["Aperçu", "Preview"], ecran: true };
  expect(await b.jugerSens(s, { app: "Safari", fenetre: "Google" })).toEqual({ oui: false, motif: "appli hors liste (sans appel à Claude)" });
  expect(questions.length).toBe(0);
  expect((await b.jugerSens(s, { app: "Aperçu", fenetre: "scan_003.pdf" })).oui).toBe(true);
  expect(questions[0]!.modele).toBe("claude-haiku-5-5");
  expect(questions[0]!.contenu).toContain("scan_003.pdf");
  expect(questions[0]!.contenu).toContain("CAF Déclaration trimestrielle"); // texte de l'écran
  expect(await b.jugerSens(s, { app: "Aperçu", fenetre: "scan_003.pdf" })).toEqual({ oui: true, motif: "réponse en cache" });
  expect(questions.length).toBe(1);
});

test("sens : Claude en échec ou réponse illisible → non, rien ne part sur un doute", async () => {
  const s = { question: "Une promesse de rappel ?", depuis: ["objet"], apps: [], ecran: false };
  reponse = new Error("délai dépassé");
  expect((await b.jugerSens(s, { objet: "Votre candidature" })).oui).toBe(false);
  reponse = { reponse: "oui" };
  expect((await b.jugerSens(s, { objet: "Autre objet" })).oui).toBe(false);
});

test("session : au moins N min dans l'appli puis sortie → contexte du document quitté ; trop court → rien", () => {
  const s = { app: "Word", minutes: 2 };
  expect("motif" in b.suivreSession("journaliste", s, { app: "Microsoft Word", fenetre: "article_mairie.docx" })).toBe(true);
  horloge += 3 * 60_000;
  const fin = b.suivreSession("journaliste", s, { app: "Safari", fenetre: "Google" });
  expect(fin).toEqual({ contexte: { app: "Microsoft Word", fenetre: "article_mairie.docx", debut: "2026-10-18T10:00:00.000Z", fin: "2026-10-18T10:03:00.000Z", minutes: "3" } });
  b.suivreSession("journaliste", s, { app: "Microsoft Word", fenetre: "brouillon.docx" });
  horloge += 30_000;
  expect(b.suivreSession("journaliste", s, { app: "Finder", fenetre: "" })).toEqual({ motif: "session de 0.5 min, moins de 2 : rien" });
});

test("attente : part après le délai ; un nouveau mail du même expéditeur l'annule ; la clé est l'adresse", async () => {
  const a = { minutes: 5, cle: "expediteur" };
  const partis: string[] = [];
  b.armerAttente("etudiant", a, { expediteur: "Recruteur A <a@exemple.fr>" }, async () => void partis.push("A"));
  b.armerAttente("etudiant", a, { expediteur: "Recruteur B <b@exemple.fr>" }, async () => void partis.push("B"));
  expect(b.annulerAttente("etudiant", a, { expediteur: "B (autre nom) <B@exemple.fr>" })).toBe(true);
  expect(b.attentesEnCours("etudiant")).toBe(1);
  await Bun.sleep(20);
  expect(partis).toEqual(["A"]);
  expect(b.attentesEnCours("etudiant")).toBe(0);
});

test("anti-répétition : même document, dans n'importe quelle appli, pas relancé dans les 30 min ; pipe occupée 2 min", () => {
  expect(b.dejaLance("admin", { app: "Aperçu", fenetre: "formulaire_CAF.pdf – 1 page" })).toBe(false);
  horloge += 20_000;
  expect(b.dejaLance("admin", { app: "Aperçu", fenetre: "scan_003.pdf" })).toBe(true); // la pipe tourne encore
  horloge += 10 * 60_000;
  expect(b.dejaLance("admin", { app: "Acrobat", fenetre: "formulaire_CAF.pdf" })).toBe(true); // rouvert ailleurs par la pipe
  expect(b.dejaLance("admin", { app: "Aperçu", fenetre: "scan_003.pdf" })).toBe(false); // autre document, pipe libre
  horloge += 31 * 60_000;
  expect(b.dejaLance("admin", { app: "Acrobat", fenetre: "formulaire_CAF.pdf" })).toBe(false);
});

test("ligneSure : une ligne, sans contrôle ni {{…}}, bornée", () => {
  expect(b.ligneSure("a\nb\u0000c {{x}}")).toBe("a b c x");
  expect(b.ligneSure("x".repeat(500)).length).toBe(200);
});
