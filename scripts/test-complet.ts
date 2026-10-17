// Propriétaire : Dev 1. Test complet de « Dès que », pas à pas : prérequis, scénarios, bilan.
//   bun run test:complet                 tout, sans envoi réel : la validation Discord se fait à la main
//   bun run test:complet -- --discord    valide aussi la proposition par l'API : envoie VRAIMENT un message Discord
//   bun run test:complet -- --mail-reel  attend en plus un vrai mail dans le dossier IMAP
// Prérequis et dépannage : docs/TEST-COMPLET.md. Ne lit ni n'affiche aucune clé.

import { openSync } from "node:fs";
import { config, verifierConfig } from "../src/config";

const args = new Set(process.argv.slice(2));
const racine = new URL("..", import.meta.url).pathname;
const MOTEUR = `http://127.0.0.1:${config.port}`;
const DEMO = "http://127.0.0.1:4310";
const NOTIFS = "http://localhost:11435/notifications";
const interactif = process.stdin.isTTY;
const bilan: { titre: string; statut: "OK" | "ÉCHEC" | "SAUTÉ"; detail: string }[] = [];
const lances: { kill(): void }[] = [];

const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));
const maintenant = () => new Date().toISOString();

async function lire(url: string, init: RequestInit = {}) {
  const res = await fetch(url, { ...init, signal: AbortSignal.timeout(init.method === "POST" ? 120_000 : 10_000) });
  return { status: res.status, json: (await res.json().catch(() => null)) as any };
}
const screenpipe = (route: string) => lire(config.screenpipeUrl + route, { headers: { Authorization: `Bearer ${config.screenpipeCle}` } });
const repond = (url: string) => fetch(url, { signal: AbortSignal.timeout(2_000) }).then((r) => r.ok, () => false);

/** Rejoue fn chaque seconde jusqu'à une valeur non vide, au plus `secondes` fois. */
async function attendre<T>(fn: () => Promise<T | null | undefined | false>, secondes: number): Promise<T | null> {
  for (let i = 0; i < secondes; i++) {
    const r = await fn().catch(() => null);
    if (r) return r;
    await pause(1_000);
  }
  return null;
}

function etape(n: number, titre: string, explication: string) {
  console.log(`\n── ${n}. ${titre}\n   ${explication}`);
}
function noter(titre: string, ok: boolean | "saute", detail: string) {
  const statut = ok === "saute" ? "SAUTÉ" : ok ? "OK" : "ÉCHEC";
  bilan.push({ titre, statut, detail });
  console.log(`   ${statut === "OK" ? "✔" : statut === "SAUTÉ" ? "–" : "✘"} ${titre} : ${detail}`);
}
function lancer(cmd: string[], journal: string) {
  const fd = openSync(`${racine}data/${journal}`, "w");
  const p = Bun.spawn(cmd, { cwd: racine, stdout: fd, stderr: fd });
  lances.push(p);
}
const curlCode = (...a: string[]) => Bun.spawnSync(["curl", "-s", "-o", "/dev/null", "-w", "%{http_code}", ...a]).stdout.toString();
const notificationsDesQue = async (depuis: string) =>
  ((await lire(NOTIFS)).json as any[]).filter((n) => n.pipe_name === "des-que" && new Date(n.timestamp) >= new Date(depuis));
const actionsDepuis = async (depuis: string) =>
  ((await lire(`${MOTEUR}/api/etat`)).json.actions as any[]).filter((a) => a.creeeLe >= depuis);

console.log(`Test complet de « Dès que ». Des notifications vont s'afficher dans screenpipe, et Claude sera appelé une fois.
Rien n'est envoyé sur Discord sans votre validation${args.has("--discord") ? ", sauf à l'étape 6 (--discord)" : ""}.`);

// 1. Prérequis
etape(1, "Prérequis", "Clés présentes, screenpipe ouvert, connexions Discord et IMAP, sources.");
const manques = verifierConfig();
noter(".env", manques.length === 0, manques.length ? `manque ${manques.join(", ")}` : "clés screenpipe et Claude présentes");
if (!(await Bun.file(`${racine}sources.json`).exists())) {
  await Bun.write(`${racine}sources.json`, Bun.file(`${racine}sources.exemple.json`));
  console.log("   sources.json absent : copié depuis sources.exemple.json");
}
const sources = (await Bun.file(`${racine}sources.json`).json()) as any[];
const sourcePrix = sources.find((s) => s.type === "web" && String(s.url).startsWith(DEMO));
const sourceMail = sources.find((s) => s.type === "mail");
noter("sources.json", Boolean(sourcePrix), sourcePrix ? `page de prix « ${sourcePrix.nom} », toutes les ${sourcePrix.intervalleSecondes} s` : "aucune source web vers la page de démo 4310");
noter("screenpipe ouvert", await repond(NOTIFS), "notifications sur localhost:11435");
const cnx = await screenpipe("/connections").catch(() => ({ status: 0, json: null }));
const branche = (id: string) => (cnx.json?.data ?? []).some((c: any) => c.id === id && c.connected);
noter("API screenpipe", cnx.status === 200, cnx.status === 200 ? "clé acceptée" : `réponse ${cnx.status} : vérifier SCREENPIPE_LOCAL_API_KEY`);
noter("Discord", branche("discord"), branche("discord") ? "connexion branchée dans screenpipe" : "à brancher : appli screenpipe > Connexions > Discord (URL du webhook)");
if (sourceMail) {
  const boites = await screenpipe("/connections/imap/mailboxes").catch(() => ({ status: 0, json: null }));
  const ok = (boites.json?.mailboxes ?? []).includes(sourceMail.mailbox);
  noter("IMAP", ok, ok ? `dossier « ${sourceMail.mailbox} » présent` : `IMAP non branché ou dossier « ${sourceMail.mailbox} » absent (réponse ${boites.status})`);
}
console.log(`   ${config.discordMention ? "DISCORD_MENTION rempli : chaque message mentionnera cette personne" : "DISCORD_MENTION vide : les messages ne mentionneront personne"}`);

// 2. Tests unitaires et types
etape(2, "Tests unitaires et types", "bun test et tsc, sans réseau ni notification.");
const tests = Bun.spawnSync(["bun", "test"], { cwd: racine });
const resume = tests.stderr.toString().match(/(\d+) pass[\s\S]*?(\d+) fail/);
noter("bun test", tests.exitCode === 0, resume ? `${resume[1]} réussis, ${resume[2]} en échec` : `code ${tests.exitCode}`);
const types = Bun.spawnSync(["bun", "run", "typecheck"], { cwd: racine });
noter("typecheck", types.exitCode === 0, types.exitCode === 0 ? "aucune erreur" : types.stdout.toString().slice(0, 300));

// 3. Démarrage
etape(3, "Démarrage", "Réutilise la page de démo et le moteur s'ils tournent, sinon les lance (journaux dans data/).");
if (!(await repond(`${DEMO}/`))) lancer(["bun", "scripts/page-demo.ts"], "test-complet-page.log");
const moteurDejaLa = await repond(`${MOTEUR}/api/etat`);
if (!moteurDejaLa) lancer(["bun", "src/main.ts"], "test-complet-moteur.log");
const etat = await attendre(async () => (await lire(`${MOTEUR}/api/etat`)).json, 20);
noter("page de démo", await attendre(() => repond(`${DEMO}/`), 10) === true, `${DEMO}/`);
noter("moteur", Boolean(etat), etat ? `${MOTEUR} (${moteurDejaLa ? "déjà lancé" : "lancé par ce script"}), règles : ${etat.regles.map((r: any) => r.id).join(", ")}` : "ne répond pas : voir data/test-complet-moteur.log");
if (!etat) await finir();
if (!moteurDejaLa) await pause(((sourcePrix?.intervalleSecondes ?? 5) + 2) * 1_000); // premier relevé = référence

// 4. Sécurité
etape(4, "Sécurité", "Un autre site, ou un autre nom pointé vers 127.0.0.1, doit être refusé.");
noter("Origin étranger", curlCode("-X", "POST", "-H", "Origin: https://exemple.invalid", "-H", "Content-Type: application/json", "-d", "{}", `${MOTEUR}/api/regles`) === "403", "POST /api/regles depuis un autre site → 403 attendu");
noter("Host étranger", curlCode("-H", "Host: piege.exemple.invalid:4300", `${MOTEUR}/api/etat`) === "403", "DNS rebinding → 403 attendu");

// 5. Scène A1 : un seuil franchi sur une page
etape(5, "Seuil", "La règle exemple-seuil notifie dès que le prix passe sous 100 € alors qu'il était au-dessus.");
const prix = (p: number) => fetch(`${DEMO}/prix`, { method: "POST", body: new URLSearchParams({ prix: String(p) }), redirect: "manual" });
// Un prix différent à chaque passage : screenpipe ignore une notification identique pendant 90 s (gate.rs:264).
const bas = 80 + Math.floor(Math.random() * 20);
await prix(129);
await pause(((sourcePrix?.intervalleSecondes ?? 5) + 2) * 1_000);
const t5 = maintenant();
await prix(bas);
const alerte = await attendre(async () => (await actionsDepuis(t5)).find((a) => a.nom === "notifier" && String(a.params.text).includes(`${bas} €`)), 20);
noter("action notifier", alerte?.statut === "executee", alerte ? `« ${alerte.params.text} » : ${alerte.statut}` : "aucune action en 20 s");
const notifPrix = await attendre(async () => (await notificationsDesQue(t5)).find((n) => String(n.body).includes(`${bas} €`)), 10);
noter("notification du seuil", Boolean(notifPrix), notifPrix ? `« ${notifPrix.title} » dans screenpipe` : "aucune notification screenpipe");
await prix(129);

// 6. Scène A2 : un mail → Claude propose → on valide → Discord
etape(6, "Mail → Claude → Discord", "Mail fictif ; Claude propose un message avec la mémoire d'écran ; un humain valide.");
const t6 = maintenant();
const quantite = 10 + Math.floor(Math.random() * 10); // même raison : un texte neuf à chaque passage
const envoi = await lire(`${MOTEUR}/api/evenements`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ source: "mail", type: "mail_recu", donnees: { expediteur: "Camille <camille@exemple.fr>", objet: "Devis n° 42 à valider", corps: `Bonjour, pouvez-vous valider le devis n° 42 (${quantite} casques audio) avant vendredi ? Merci, Camille` } }),
});
const proposition = (await actionsDepuis(t6)).find((a) => a.statut === "proposee");
noter("proposition de Claude", Boolean(proposition), proposition ? `${proposition.nom} : « ${String(proposition.params.content ?? proposition.params.text).slice(0, 160)} »` : `aucune (réponse ${envoi.status})`);
const notifMail = await attendre(async () => (await notificationsDesQue(t6)).find((n) => (n.actions ?? []).some((b: any) => b.type === "link" && b.label === "Voir et valider")), 10);
noter("notification « Voir et valider »", Boolean(notifMail), notifMail ? `« ${notifMail.title} », bouton vers ${notifMail.actions[0].url}` : "absente");

const valide = async () => {
  const a = (await actionsDepuis(t6)).find((x) => x.id === proposition?.id);
  return a && a.statut !== "proposee" ? a : null;
};
if (!proposition) noter("validation Discord", "saute", "pas de proposition à valider");
else if (args.has("--discord")) {
  await lire(`${MOTEUR}/api/actions/${proposition.id}/valider`, { method: "POST" });
  const a = await valide();
  noter("validation Discord", a?.resultat?.upstream_status === 204, `par l'API : ${a?.statut} ${JSON.stringify(a?.resultat ?? a?.erreur ?? null)}`);
} else if (interactif && prompt("   Cliquez « Voir et valider » dans la notification, puis « Valider » sur la page (Entrée pour attendre, s pour sauter) :") !== "s") {
  const a = await attendre(valide, 120);
  noter("validation Discord", a?.resultat?.upstream_status === 204, a ? `${a.statut} ${JSON.stringify(a.resultat ?? a.erreur ?? null)}` : "rien validé en 2 min");
} else noter("validation Discord", "saute", "à faire à la main : « Voir et valider », puis « Valider » (ou relancer avec --discord)");

// 7. Facultatif : un vrai mail par IMAP
if (args.has("--mail-reel") && sourceMail) {
  etape(7, "Vrai mail", `Envoyez maintenant un mail qui arrive dans le dossier « ${sourceMail.mailbox} » (objet conseillé : « Devis n° 42 à valider »).`);
  const t7 = maintenant();
  const a = await attendre(async () => (await actionsDepuis(t7)).find((x) => x.statut === "proposee"), 120);
  noter("vrai mail", Boolean(a), a ? `proposition ${a.nom} reçue` : `rien en 2 min (sondage toutes les ${sourceMail.intervalleSecondes ?? 15} s)`);
}

await finir();

async function finir(): Promise<never> {
  for (const p of lances) p.kill();
  console.log("\n── Bilan");
  for (const b of bilan) console.log(`   ${b.statut.padEnd(5)} ${b.titre}`);
  const echecs = bilan.filter((b) => b.statut === "ÉCHEC").length;
  console.log(echecs ? `\n${echecs} échec(s) : voir docs/TEST-COMPLET.md, section Dépannage.` : "\nTout ce qui a été testé fonctionne.");
  process.exit(echecs ? 1 : 0);
}
