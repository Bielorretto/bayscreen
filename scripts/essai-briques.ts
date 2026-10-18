// Essai de bout en bout des briques sur les 3 cas d'usage : bun scripts/essai-briques.ts
// Vraie traduction par Claude (et vraies questions à Haiku), faux screenpipe local : aucune pipe réelle n'est lancée,
// on regarde ce que chaque pipe aurait reçu. Fichiers de règles et de sources temporaires : rien du projet n'est touché.
// Coût : 3 traductions (Sonnet) et quelques questions à Haiku.
export {};
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dossier = mkdtempSync(join(tmpdir(), "essai-briques-"));
const sources = join(dossier, "sources.json");
writeFileSync(sources, JSON.stringify([{ type: "mail", mailbox: "Candidatures", intervalleSecondes: 15 }]));

// ── faux screenpipe ─────────────────────────────────────────────────────────────────────────────────────────────────
const pipes = [
  {
    config: { name: "journaliste-sources", title: "Vérifier mes sources", enabled: true, trigger: { custom: "dès que je finis ma rédaction dans Word" } },
    prompt_body:
      "Vérifie toutes les sources de l'article que je viens de terminer : retrouve le fichier d'après le nom de fenêtre reçu, " +
      "ouvre chaque lien cité, vérifie que l'affirmation qui s'y appuie figure bien dans la page, puis envoie-moi un rapport en notification.",
  },
  {
    config: { name: "etudiant-relance", title: "Relancer les recruteurs", enabled: true, trigger: { custom: "dès qu'un recruteur me promet de me rappeler et ne le fait pas sous 5 jours" } },
    prompt_body: "Prépare un message de relance poli pour ce recruteur, d'après l'expéditeur et l'objet reçus, et envoie-le-moi en notification pour que je le valide. N'envoie rien toi-même.",
  },
  {
    config: { name: "admin-remplir", title: "Remplir mes papiers", enabled: true, trigger: { custom: "dès que j'ouvre un document administratif" } },
    prompt_body: "Remplis le document ouvert avec mes informations (fiche ~/Documents/profil.txt), dans une copie, sans rien soumettre ni signer, puis préviens-moi qu'il est à relire.",
  },
];
let ocr = "";
const lancements: { pipe: string; evenement: Record<string, unknown> }[] = [];
const faux = Bun.serve({
  hostname: "127.0.0.1",
  port: 0,
  async fetch(req) {
    const u = new URL(req.url);
    if (u.pathname === "/pipes") return Response.json({ data: pipes });
    const run = u.pathname.match(/^\/pipes\/([^/]+)\/run$/);
    if (run && req.method === "POST") {
      const corps = (await req.json()) as any;
      lancements.push({ pipe: run[1]!, evenement: corps.run_context?.evenement ?? {} });
      return Response.json({ success: true, execution_id: 1 });
    }
    if (/^\/pipes\/[^/]+\/executions\//.test(u.pathname)) return Response.json({ data: { status: "completed" } });
    if (u.pathname === "/search") return Response.json({ data: ocr ? [{ type: "OCR", content: { text: ocr } }] : [] });
    return Response.json({ erreur: "route absente du faux screenpipe" }, { status: 404 });
  },
});

process.env.SCREENPIPE_LOCAL_API_URL = `http://127.0.0.1:${faux.port}`;
process.env.SCREENPIPE_LOCAL_API_KEY = "cle-factice-essai";
process.env.FICHIER_REGLES = join(dossier, "regles.json");
process.env.FICHIER_SOURCES = sources;
process.env.FICHIER_PIPES_DES_QUE = join(dossier, "valides.json");

const { Moteur } = await import("../src/moteur");
const { synchroniserAutomatiquement } = await import("../src/pipes-des-que");
const briques = await import("../src/briques");

const moteur = new Moteur(process.env.FICHIER_REGLES);
await moteur.charger();
let horloge = Date.now();
briques.deps.maintenant = () => horloge;
briques.deps.minuteMs = 0.002; // 5 jours d'attente = 14 ms

console.log("\n══ 1. Traduction des 3 déclencheurs par Claude ══");
await synchroniserAutomatiquement(moteur);
for (const r of moteur.regles) {
  const b = r.alors.mode === "fixe" ? r.alors.params.briques : undefined;
  console.log(`\n• ${r.id} (active : ${r.active})\n  desQue : ${JSON.stringify(r.desQue)}\n  briques : ${JSON.stringify(b ?? null)}`);
}

const evt = (source: "screenpipe" | "mail", type: string, donnees: Record<string, unknown>) =>
  moteur.emettre({ id: crypto.randomUUID(), source, type, date: new Date(horloge).toISOString(), donnees });
const app = (a: string, fenetre: string) => evt("screenpipe", "app_active", { app: a, fenetre, capture: new Date(horloge).toISOString() });
const verdicts: [string, boolean][] = [];
const lancesPour = (pipe: string) => lancements.filter((l) => l.pipe === pipe);

console.log("\n══ 2. Journaliste : Word 12 min sur l'article, puis Safari ══");
const session = moteur.regles.find((r) => r.id === "pipe-des-que-journaliste-sources");
const minutes = Number((session?.alors as any)?.params?.briques?.session?.minutes ?? 10);
await app("Microsoft Word", "article_mairie.docx");
horloge += (minutes + 2) * 60_000;
await app("Safari", "Google");
await app("Microsoft Word", "brouillon.docx");
horloge += 20_000;
await app("Finder", "Documents");
const j = lancesPour("journaliste-sources");
verdicts.push(["journaliste : un lancement, pour article_mairie.docx", j.length === 1 && j[0]!.evenement.fenetre === "article_mairie.docx"]);

console.log("\n══ 3. Administratif : formulaire CAF, recette, scan sans nom parlant ══");
await app("Aperçu", "formulaire_CAF.pdf");
await app("Aperçu", "recette_crepes.pdf");
ocr = "CAF — Déclaration trimestrielle de ressources. Numéro d'allocataire : ____ Nom : ____ Adresse : ____";
await app("Aperçu", "scan_003.pdf");
ocr = "";
horloge += 5 * 60_000;
await app("Aperçu", "formulaire_CAF.pdf"); // rouvert : pas de second lancement
const a = lancesPour("admin-remplir").map((l) => l.evenement.fenetre);
verdicts.push(["administratif : CAF et scan_003 lancés, recette non, CAF rouvert non", JSON.stringify(a) === JSON.stringify(["formulaire_CAF.pdf", "scan_003.pdf"])]);

console.log("\n══ 4. Étudiant : promesse A, promesse B puis réponse de B, newsletter ══");
await evt("mail", "mail_recu", { expediteur: "Recruteur A <a@exemple.fr>", objet: "Votre candidature — développeur junior", corps: "Merci pour votre candidature. Nous vous rappelons d'ici vendredi." });
await evt("mail", "mail_recu", { expediteur: "Recruteur B <b@exemple.fr>", objet: "Candidature stage data", corps: "Bonne nouvelle, votre profil nous intéresse, on vous rappelle la semaine prochaine." });
await evt("mail", "mail_recu", { expediteur: "Recruteur B <b@exemple.fr>", objet: "Re: Candidature stage data", corps: "Comme promis, voici les créneaux pour l'entretien : mardi 10 h ou jeudi 14 h." });
await evt("mail", "mail_recu", { expediteur: "JobLetter <news@exemple.fr>", objet: "Les offres de la semaine", corps: "On revient vers vous la semaine prochaine avec de nouvelles offres !" });
await Bun.sleep(300);
const e = lancesPour("etudiant-relance").map((l) => l.evenement.expediteur);
verdicts.push(["étudiant : relance pour A seulement", JSON.stringify(e) === JSON.stringify(["Recruteur A <a@exemple.fr>"])]);

console.log("\n══ Ce que les pipes ont reçu ══");
for (const l of lancements) console.log(`→ ${l.pipe} : ${JSON.stringify(l.evenement)}`);
console.log("\n══ Verdict ══");
for (const [nom, ok] of verdicts) console.log(`${ok ? "✅" : "❌"} ${nom}`);
faux.stop(true);
process.exit(verdicts.every(([, ok]) => ok) ? 0 : 1);
