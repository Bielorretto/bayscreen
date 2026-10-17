// Propriétaire : Dev 1. Source « web » : relit une page à intervalle régulier,
// extrait une valeur avec une expression régulière, émet valeur_changee quand elle change.
// Une source créée par le pont « dès que » (origine "pont") est relue en mode strict : garde d'adresse, DNS compris,
// à chaque relevé, sans redirection, 10 s et 512 Ko au plus (lireStricte). Les autres ne changent pas.

import { lookup } from "node:dns/promises";
import type { Bus } from "../types";

export type SourceWeb = {
  type: "web";
  nom: string;
  url: string;
  /** Expression régulière dont le premier groupe capture la valeur, ex. "Prix\\s*:\\s*([\\d.,]+)" */
  motif: string;
  intervalleSecondes: number;
  /** "pont" : ajoutée par le pont « dès que » au clic sur Valider ; relevée en mode strict (lireStricte). */
  origine?: "pont";
};

export function nombre(brut: string): number | null {
  const n = Number(brut.replace(/\s/g, "").replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

/** Résolution DNS de la garde : toutes les adresses (IPv4 et IPv6) d'un nom. Remplacée par les tests. */
export const resolution = { adresses: async (nom: string) => (await lookup(nom, { all: true })).map((a) => a.address) };

const MAX_ADRESSE = 500;
const MAX_OCTETS = 512 * 1024;
/** localhost et les suffixes des réseaux locaux. */
const NOMS_LOCAUX = /(^|\.)(localhost|local|internal|lan|home\.arpa)$/;
/** Plages IPv4 hors de l'Internet public : début, longueur du préfixe, nature. */
const PLAGES_V4: [string, number, string][] = [
  ["0.0.0.0", 8, "non spécifiée"],
  ["10.0.0.0", 8, "privée"],
  ["100.64.0.0", 10, "partagée (CGNAT)"],
  ["127.0.0.0", 8, "de bouclage"],
  ["169.254.0.0", 16, "de lien local"],
  ["172.16.0.0", 12, "privée"],
  ["192.0.0.0", 24, "réservée"],
  ["192.0.2.0", 24, "réservée"],
  ["192.88.99.0", 24, "réservée"],
  ["192.168.0.0", 16, "privée"],
  ["198.18.0.0", 15, "réservée"],
  ["198.51.100.0", 24, "réservée"],
  ["203.0.113.0", 24, "réservée"],
  ["224.0.0.0", 4, "multicast"],
  ["240.0.0.0", 4, "réservée"],
];

/** Adresse IPv4 écrite a.b.c.d, en entier ; null sinon. new URL() y ramène déjà 127.1, 2130706433, 0x7f000001 ou 0177.0.0.1. */
function entierV4(ip: string): number | null {
  const o = ip.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/)?.slice(1).map(Number);
  return o && o.every((x) => x <= 255) ? ((o[0]! << 24) | (o[1]! << 16) | (o[2]! << 8) | o[3]!) >>> 0 : null;
}
const natureV4 = (n: number) => PLAGES_V4.find(([debut, l]) => n >>> (32 - l) === entierV4(debut)! >>> (32 - l))?.[2] ?? "";

/** Les 8 groupes d'une adresse IPv6 (crochets, zone et IPv4 finale tolérés) ; null si ce n'en est pas une. */
function groupesV6(ip: string): number[] | null {
  let s = ip.replace(/^\[(.*)\]$/, "$1").replace(/%.*$/, "").toLowerCase();
  if (!s.includes(":")) return null;
  const v4 = s.match(/^(.*:)(\d+\.\d+\.\d+\.\d+)$/);
  if (v4) {
    const n = entierV4(v4[2]!);
    if (n === null) return null;
    s = `${v4[1]}${(n >>> 16).toString(16)}:${(n & 0xffff).toString(16)}`;
  }
  const moities = s.split("::");
  if (moities.length > 2) return null;
  const [tete, queue] = moities.map((m) => (m ? m.split(":") : []));
  const manque = 8 - tete!.length - (queue?.length ?? 0);
  if (queue ? manque < 1 : manque !== 0) return null;
  const groupes = [...tete!, ...Array<string>(queue ? manque : 0).fill("0"), ...(queue ?? [])];
  return groupes.every((g) => /^[0-9a-f]{1,4}$/.test(g)) ? groupes.map((g) => parseInt(g, 16)) : null;
}
function natureV6(g: number[]): string {
  const [a, b] = g as [number, number];
  if (g.slice(0, 5).every((x) => x === 0) && g[5] === 0xffff) return natureV4(((g[6]! << 16) | g[7]!) >>> 0); // IPv4 mappée : la sienne
  if (g.every((x, i) => x === (i === 7 ? 1 : 0))) return "de bouclage";
  if (g.every((x) => x === 0)) return "non spécifiée";
  if ((a & 0xfe00) === 0xfc00) return "privée";
  if ((a & 0xffc0) === 0xfe80) return "de lien local";
  if (a >>> 8 === 0xff) return "multicast";
  // Hors 2000::/3 (NAT64, IPv4 compatible…), protocoles IETF (2001::/23), documentation (2001:db8::/32, 3fff::/20), 6to4 (2002::/16).
  if (a >>> 13 !== 1 || (a === 0x2001 && (b < 0x200 || b === 0xdb8)) || a === 0x2002 || (a === 0x3fff && b < 0x1000)) return "réservée";
  return "";
}
/** Nature d'une adresse IP qui n'est pas publique ; "" si elle l'est ; null si ce n'est pas une adresse IP. */
function natureIp(ip: string): string | null {
  const v4 = entierV4(ip);
  if (v4 !== null) return natureV4(v4);
  const v6 = groupesV6(ip);
  return v6 ? natureV6(v6) : null;
}

/**
 * Garde d'adresse d'une source créée par le pont, sans DNS (fonction pure) : pourquoi l'adresse est refusée ; "" si elle
 * est permise. Refuse un schéma autre que http et https, des identifiants (user:pass@), localhost et les noms locaux, un
 * nom sans domaine, une adresse IP de bouclage, privée, réservée, de lien local, CGNAT, multicast ou non spécifiée, dans
 * toutes ses écritures (new URL() les ramène à une seule), et une adresse de plus de 500 caractères.
 */
export function adresseRefusee(adresse: string): string {
  if (adresse.length > MAX_ADRESSE) return `plus de ${MAX_ADRESSE} caractères`;
  let url: URL;
  try {
    url = new URL(adresse);
  } catch {
    return "adresse illisible";
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return `schéma ${url.protocol} interdit (http ou https seulement)`;
  if (url.username || url.password) return "identifiants dans l'adresse";
  const hote = url.hostname.replace(/\.+$/, "");
  const ip = natureIp(hote);
  if (ip !== null) return ip && `adresse IP ${ip} : ${hote}`;
  if (NOMS_LOCAUX.test(hote)) return `nom local : ${hote}`;
  if (!hote.includes(".")) return `nom sans domaine : ${hote}`;
  return "";
}

/** La garde, DNS compris : un nom est refusé si l'une de ses adresses n'est pas publique. "" si l'adresse est permise. */
export async function adresseRefuseeDns(adresse: string): Promise<string> {
  const refus = adresseRefusee(adresse);
  if (refus) return refus;
  const hote = new URL(adresse).hostname.replace(/\.+$/, "");
  if (natureIp(hote) !== null) return ""; // une adresse IP, déjà jugée
  let ips: string[];
  let minuterie: ReturnType<typeof setTimeout> | undefined;
  try {
    const delai = new Promise<never>((_, refuser) => (minuterie = setTimeout(() => refuser(new Error("pas de réponse en 5 s")), 5_000)));
    ips = await Promise.race([resolution.adresses(hote), delai]);
  } catch (e: any) {
    return `nom « ${hote} » introuvable (DNS : ${e?.code ?? e?.message ?? e})`;
  } finally {
    clearTimeout(minuterie);
  }
  if (!ips.length) return `nom « ${hote} » sans adresse (DNS)`;
  for (const ip of ips) {
    const nature = natureIp(ip);
    if (nature !== "") return `« ${hote} » se résout vers ${ip}, adresse ${nature ?? "illisible"}`;
  }
  return "";
}

/** Les 512 premiers Ko du corps : la suite n'est pas lue. */
async function texteBorne(res: Response): Promise<string> {
  const lecteur = res.body?.getReader();
  const morceaux: Uint8Array[] = [];
  for (let n = 0; lecteur && n < MAX_OCTETS; ) {
    const { done, value } = await lecteur.read();
    if (done) break;
    morceaux.push(value);
    n += value.byteLength;
  }
  await lecteur?.cancel();
  return new TextDecoder().decode(Buffer.concat(morceaux).subarray(0, MAX_OCTETS));
}

/** Lecture d'une source créée par le pont : garde d'abord, DNS compris ; sans redirection, 10 s et 512 Ko au plus. Lève une erreur lisible. */
export async function lireStricte(adresse: string): Promise<string> {
  const refus = await adresseRefuseeDns(adresse);
  if (refus) throw new Error(`adresse refusée : ${refus}`);
  let res: Response;
  try {
    res = await fetch(adresse, { redirect: "manual", signal: AbortSignal.timeout(10_000), headers: { "User-Agent": "des-que/0.1" } });
    if (res.ok) return await texteBorne(res);
  } catch (e: any) {
    throw new Error(`page injoignable (${e?.message ?? e})`);
  }
  throw new Error(res.status >= 300 && res.status < 400 ? `redirection refusée (HTTP ${res.status})` : `page injoignable (HTTP ${res.status})`);
}

/** Renvoie un tour de relevé de la source. */
export function sondeurPage(s: SourceWeb, bus: Bus) {
  const re = new RegExp(s.motif, "i");
  let precedente: string | null = null;
  // Un relevé lent ne doit pas croiser le suivant : sinon une réponse périmée peut déclencher deux fois.
  let enCours = false;

  return async () => {
    if (enCours) return;
    enCours = true;
    try {
      let html: string;
      if (s.origine === "pont") html = await lireStricte(s.url);
      else {
        const res = await fetch(s.url, { signal: AbortSignal.timeout(15_000), headers: { "User-Agent": "des-que/0.1" } });
        html = await res.text();
      }
      const m = html.match(re);
      if (!m?.[1]) {
        bus.journaliser("alerte", `source « ${s.nom} » : motif introuvable dans la page`);
        return;
      }
      const valeur = m[1].trim();
      if (valeur === precedente) return;
      const ancienne = precedente;
      precedente = valeur;
      if (ancienne === null) {
        bus.journaliser("info", `source « ${s.nom} » : valeur initiale ${valeur}`);
        return; // pas d'événement au premier relevé
      }
      await bus.emettre({
        id: crypto.randomUUID(),
        source: "web",
        type: "valeur_changee",
        date: new Date().toISOString(),
        donnees: { nom: s.nom, url: s.url, valeur: nombre(valeur) ?? valeur, valeurTexte: valeur, ancienne },
      });
    } catch (e: any) {
      bus.journaliser("erreur", `source « ${s.nom} » : ${e.message}`);
    } finally {
      enCours = false;
    }
  };
}

export function surveillerPage(s: SourceWeb, bus: Bus): () => void {
  const tour = sondeurPage(s, bus);
  tour();
  const t = setInterval(tour, Math.max(5, s.intervalleSecondes) * 1000);
  return () => clearInterval(t);
}
