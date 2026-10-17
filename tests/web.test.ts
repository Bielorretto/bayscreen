import { expect, spyOn, test } from "bun:test";
import { adresseRefusee, adresseRefuseeDns, lireStricte, resolution, sondeurPage } from "../src/sources/web";
import type { Bus, Evenement } from "../src/types";

// Réseau et DNS simulés : aucune requête ne part. Adresses fictives (.example) ; 93.184.216.34, l'adresse IANA des
// domaines d'exemple, tient lieu d'adresse publique (aucune connexion n'y est faite).
const PUBLIQUE = "93.184.216.34";
/** Résolution DNS simulée : nom → adresses ; absent : introuvable (ENOTFOUND). */
const dns = new Map<string, string[]>();
const resolus: string[] = [];
resolution.adresses = async (nom) => {
  resolus.push(nom);
  const a = dns.get(nom);
  if (!a) throw Object.assign(new Error(`getaddrinfo ENOTFOUND ${nom}`), { code: "ENOTFOUND" });
  return a;
};
/** Réponses des pages (adresse → réponse) et requêtes reçues, dans l'ordre. Toute autre adresse : réseau coupé. */
const pages = new Map<string, () => Response>();
const lectures: { url: string; init?: RequestInit }[] = [];
spyOn(globalThis, "fetch").mockImplementation((async (url: unknown, init?: RequestInit) => {
  const page = pages.get(String(url));
  if (!page) throw new Error(`réseau coupé pendant les tests : ${String(url)}`);
  lectures.push({ url: String(url), init });
  return page();
}) as any);

function busFactice() {
  const evenements: Evenement[] = [];
  const journal: string[] = [];
  const bus: Bus = {
    emettre: async (e) => void evenements.push(e),
    creerAction: (a) => ({ id: "x", statut: "proposee", creeeLe: "", ...a }) as any,
    diffuser: () => {},
    journaliser: (_niveau, message) => void journal.push(message),
  };
  return { bus, evenements, journal };
}

test("garde d'adresse (fonction pure) : schéma, identifiants, noms locaux, IP non publiques dans toutes leurs écritures, longueur", () => {
  const base = "https://cours.example/";
  const refusees: [string, string][] = [
    ["ftp://cours.example/prix", "schéma ftp: interdit (http ou https seulement)"],
    ["file:///etc/passwd", "schéma file: interdit (http ou https seulement)"],
    ["javascript:alert(1)", "schéma javascript: interdit (http ou https seulement)"],
    ["https://alice:secret@cours.example/", "identifiants dans l'adresse"],
    ["https://alice@cours.example/", "identifiants dans l'adresse"],
    ["http://localhost:4300/api/etat", "nom local : localhost"],
    ["http://LOCALHOST./", "nom local : localhost"],
    ["http://moteur.localhost/", "nom local : moteur.localhost"],
    ["http://imprimante.local/", "nom local : imprimante.local"],
    ["http://base.internal/", "nom local : base.internal"],
    ["http://nas.lan/", "nom local : nas.lan"],
    ["http://box.home.arpa/", "nom local : box.home.arpa"],
    ["http://intranet/", "nom sans domaine : intranet"],
    ["http://127.0.0.1:4310/", "adresse IP de bouclage : 127.0.0.1"],
    ["http://127.1/", "adresse IP de bouclage : 127.0.0.1"],
    ["http://2130706433/", "adresse IP de bouclage : 127.0.0.1"],
    ["http://0x7f000001/", "adresse IP de bouclage : 127.0.0.1"],
    ["http://0177.0.0.1/", "adresse IP de bouclage : 127.0.0.1"],
    ["http://0/", "adresse IP non spécifiée : 0.0.0.0"],
    ["http://10.0.0.1/", "adresse IP privée : 10.0.0.1"],
    ["http://172.16.0.1/", "adresse IP privée : 172.16.0.1"],
    ["http://172.31.255.255/", "adresse IP privée : 172.31.255.255"],
    ["http://3232235777/", "adresse IP privée : 192.168.1.1"],
    ["http://100.64.0.1/", "adresse IP partagée (CGNAT) : 100.64.0.1"],
    ["http://169.254.169.254/latest/meta-data/", "adresse IP de lien local : 169.254.169.254"],
    ["http://192.0.2.10/", "adresse IP réservée : 192.0.2.10"],
    ["http://198.18.0.1/", "adresse IP réservée : 198.18.0.1"],
    ["http://203.0.113.5/", "adresse IP réservée : 203.0.113.5"],
    ["http://224.0.0.251/", "adresse IP multicast : 224.0.0.251"],
    ["http://255.255.255.255/", "adresse IP réservée : 255.255.255.255"],
    ["http://[::1]/", "adresse IP de bouclage : [::1]"],
    ["http://[0:0:0:0:0:0:0:1]/", "adresse IP de bouclage : [::1]"],
    ["http://[::]/", "adresse IP non spécifiée : [::]"],
    ["http://[::ffff:127.0.0.1]/", "adresse IP de bouclage : [::ffff:7f00:1]"],
    ["http://[::ffff:10.0.0.1]/", "adresse IP privée : [::ffff:a00:1]"],
    ["http://[fc00::1]/", "adresse IP privée : [fc00::1]"],
    ["http://[fd12:3456::1]/", "adresse IP privée : [fd12:3456::1]"],
    ["http://[fe80::1]/", "adresse IP de lien local : [fe80::1]"],
    ["http://[ff02::1]/", "adresse IP multicast : [ff02::1]"],
    ["http://[64:ff9b::7f00:1]/", "adresse IP réservée : [64:ff9b::7f00:1]"],
    ["http://[2001:db8::1]/", "adresse IP réservée : [2001:db8::1]"],
    ["http://[2002:7f00:1::]/", "adresse IP réservée : [2002:7f00:1::]"],
    [base + "a".repeat(501 - base.length), "plus de 500 caractères"],
    ["pas une adresse", "adresse illisible"],
  ];
  const permises = [
    "https://api.cours-demo.example/v1/prix?actif=bitcoin&devise=eur",
    "https://cours.example./prix", // point final : le même nom
    "https://cours.example:8443/prix",
    `http://${PUBLIQUE}/`,
    "https://[2606:2800:220:1:248:1893:25c8:1946]/",
    `http://[::ffff:${PUBLIQUE}]/`, // IPv4 publique, mappée
    "http://11.0.0.1/",
    "http://172.32.0.1/", // juste après 172.16.0.0/12
    "http://100.128.0.1/", // juste après 100.64.0.0/10
    base + "a".repeat(500 - base.length), // 500 caractères pile
  ];
  for (const [adresse, motif] of refusees) expect({ adresse, motif: adresseRefusee(adresse) }).toEqual({ adresse, motif });
  for (const adresse of permises) expect({ adresse, motif: adresseRefusee(adresse) }).toEqual({ adresse, motif: "" });
  expect(refusees.length + permises.length).toBeGreaterThanOrEqual(25);
});

test("garde DNS : toutes les adresses du nom comptent ; un nom qui se résout vers 127.0.0.1 ou 10.x est refusé", async () => {
  dns.set("public.cours-demo.example", [PUBLIQUE, "2606:2800:220:1:248:1893:25c8:1946"]);
  dns.set("boucle.piege.example", ["127.0.0.1"]);
  dns.set("interne.piege.example", [PUBLIQUE, "10.0.0.7"]);
  dns.set("v6.piege.example", ["::ffff:127.0.0.1"]);
  dns.set("vide.piege.example", []);
  expect(await adresseRefuseeDns("https://public.cours-demo.example/prix")).toBe("");
  expect(await adresseRefuseeDns("https://public.cours-demo.example./prix")).toBe(""); // point final : le même nom
  expect(await adresseRefuseeDns("https://boucle.piege.example/prix")).toBe("« boucle.piege.example » se résout vers 127.0.0.1, adresse de bouclage");
  expect(await adresseRefuseeDns("https://interne.piege.example/prix")).toBe("« interne.piege.example » se résout vers 10.0.0.7, adresse privée");
  expect(await adresseRefuseeDns("https://v6.piege.example/")).toBe("« v6.piege.example » se résout vers ::ffff:127.0.0.1, adresse de bouclage");
  expect(await adresseRefuseeDns("https://vide.piege.example/")).toBe("nom « vide.piege.example » sans adresse (DNS)");
  expect(await adresseRefuseeDns("https://inconnu.piege.example/")).toBe("nom « inconnu.piege.example » introuvable (DNS : ENOTFOUND)");
  // Sans DNS : une adresse IP, déjà jugée, ou une adresse refusée sans lui.
  resolus.length = 0;
  expect(await adresseRefuseeDns(`http://${PUBLIQUE}/`)).toBe("");
  expect(await adresseRefuseeDns("http://localhost/")).toBe("nom local : localhost");
  expect(resolus).toEqual([]);
});

test("lecture stricte : la garde d'abord, DNS compris ; redirection refusée ; 10 s ; 512 Ko lus au plus", async () => {
  dns.set("public.cours-demo.example", [PUBLIQUE]);
  dns.set("boucle.piege.example", ["127.0.0.1"]);
  const base = "https://public.cours-demo.example";
  pages.set(`${base}/redirige`, () => new Response(null, { status: 302, headers: { Location: "http://127.0.0.1:4300/api/etat" } }));
  pages.set(`${base}/absente`, () => new Response("introuvable", { status: 404 }));
  // 4 Mo servis par morceaux de 64 Ko : lire jusqu'au bout se voit (longueur, morceaux tirés) sans bloquer la suite.
  let tires = 0;
  let abandonnee = false;
  const grosse = () =>
    new ReadableStream<Uint8Array>({
      pull: (c) => void (++tires > 64 ? c.close() : c.enqueue(new Uint8Array(64 * 1024).fill(0x78))),
      cancel: () => void (abandonnee = true),
    });
  pages.set(`${base}/grosse`, () => new Response(grosse()));
  const delais = spyOn(AbortSignal, "timeout");
  try {
    lectures.length = 0;
    await expect(lireStricte(`${base}/redirige`)).rejects.toThrow("redirection refusée (HTTP 302)");
    expect(lectures[0]!.init).toMatchObject({ redirect: "manual", signal: expect.any(AbortSignal) });
    expect(delais).toHaveBeenCalledWith(10_000);
    await expect(lireStricte(`${base}/absente`)).rejects.toThrow("page injoignable (HTTP 404)");
    await expect(lireStricte(`${base}/inconnue`)).rejects.toThrow(`page injoignable (réseau coupé pendant les tests : ${base}/inconnue)`);
    // Une réponse de 4 Mo : 512 Ko lus, puis la suite abandonnée.
    expect((await lireStricte(`${base}/grosse`)).length).toBe(512 * 1024);
    expect(abandonnee).toBe(true);
    expect(tires).toBeLessThanOrEqual(10);
    // Refusée par la garde : aucune requête.
    lectures.length = 0;
    await expect(lireStricte("http://10.0.0.1/prix")).rejects.toThrow("adresse refusée : adresse IP privée : 10.0.0.1");
    await expect(lireStricte("https://boucle.piege.example/prix")).rejects.toThrow("adresse refusée : « boucle.piege.example » se résout vers 127.0.0.1, adresse de bouclage");
    expect(lectures).toEqual([]);
  } finally {
    delais.mockRestore();
  }
});

test("source marquée « pont » : chaque relevé repasse la garde, DNS compris, et refuse les redirections ; une source non marquée ne change pas", async () => {
  const { bus, evenements, journal } = busFactice();
  const url = "https://releve.cours-demo.example/prix";
  const hote = "releve.cours-demo.example";
  dns.set(hote, [PUBLIQUE]);
  let reponse = () => new Response("Prix : 42");
  pages.set(url, () => reponse());
  const tour = sondeurPage({ type: "web", nom: "Cours", url, motif: "Prix\\s*:\\s*([\\d.,]+)", intervalleSecondes: 60, origine: "pont" }, bus);
  lectures.length = 0;
  resolus.length = 0;
  await tour(); // valeur initiale
  dns.set(hote, ["10.0.0.7"]); // le nom bascule vers le réseau local (DNS rebinding)
  await tour();
  dns.set(hote, [PUBLIQUE]);
  reponse = () => new Response(null, { status: 301, headers: { Location: "http://127.0.0.1:4300/api/etat" } });
  await tour();
  reponse = () => new Response("Prix : 40");
  await tour();
  expect(resolus).toEqual([hote, hote, hote, hote]); // DNS à chaque relevé
  expect(lectures.map((l) => l.init?.redirect)).toEqual(["manual", "manual", "manual"]); // aucune requête au relevé refusé
  expect(journal).toEqual([
    "source « Cours » : valeur initiale 42",
    `source « Cours » : adresse refusée : « ${hote} » se résout vers 10.0.0.7, adresse privée`,
    "source « Cours » : redirection refusée (HTTP 301)",
  ]);
  expect(evenements.map((e) => [e.source, e.type, e.donnees])).toEqual([["web", "valeur_changee", { nom: "Cours", url, valeur: 40, valeurTexte: "40", ancienne: "42" }]]);

  // Non marquée (les sources de la démo, sur 127.0.0.1:4310) : ni garde ni DNS, la requête d'avant.
  pages.set("http://127.0.0.1:4310/", () => new Response("Prix : 129 €"));
  const demo = busFactice();
  const delais = spyOn(AbortSignal, "timeout");
  lectures.length = 0;
  resolus.length = 0;
  try {
    await sondeurPage({ type: "web", nom: "Casque audio", url: "http://127.0.0.1:4310/", motif: "Prix\\s*:\\s*([\\d.,]+)", intervalleSecondes: 5 }, demo.bus)();
    expect(delais).toHaveBeenCalledWith(15_000);
  } finally {
    delais.mockRestore();
  }
  expect(demo.journal).toEqual(["source « Casque audio » : valeur initiale 129"]);
  expect(resolus).toEqual([]);
  expect(lectures.map((l) => [l.url, Object.keys(l.init ?? {}), l.init?.headers])).toEqual([["http://127.0.0.1:4310/", ["signal", "headers"], { "User-Agent": "des-que/0.1" }]]);
});
