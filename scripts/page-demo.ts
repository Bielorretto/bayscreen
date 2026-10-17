// Propriétaire : Dev 1. Page de démo pour la source web : un prix qu'on change à la main,
// pour franchir un seuil quand on veut au lieu d'attendre un cours réel.
// Lancer : bun scripts/page-demo.ts, puis ouvrir http://127.0.0.1:4310
// Changer le prix sans navigateur : curl -d prix=89 http://127.0.0.1:4310/prix

const PORT = Number(process.env.PORT_PAGE_DEMO ?? 4310);
let prix = 129;

const page = () => `<!doctype html>
<html lang="fr"><meta charset="utf-8"><title>Casque audio</title>
<body style="font-family: system-ui, sans-serif; max-width: 32rem; margin: 3rem auto; padding: 0 1rem">
  <h1>Casque audio sans fil</h1>
  <p style="font-size: 2rem">Prix : ${prix} €</p>
  <form method="post" action="/prix">
    <input name="prix" type="number" step="0.01" min="0" value="${prix}" required>
    <button>Changer le prix</button>
  </form>
</body></html>`;

// Document fictif à afficher avant la démo du mail : screenpipe le voit, Claude pourra le citer.
const devis = `<!doctype html>
<html lang="fr"><meta charset="utf-8"><title>Devis n° 42</title>
<body style="font-family: system-ui, sans-serif; max-width: 32rem; margin: 3rem auto; padding: 0 1rem">
  <h1>Devis n° 42</h1>
  <p>Client : Camille (exemple fictif)</p>
  <p>10 casques audio sans fil × 129 €</p>
  <p style="font-size: 1.5rem">Total : 1 290 € TTC</p>
  <p>Valable jusqu'au 31 octobre 2026</p>
</body></html>`;

// Scénario « designeuse » (données fictives) : une collection dont seule la couleur change, parmi une liste fermée.
const COULEURS: Record<string, string> = {
  bleu: "#2563eb", rouge: "#dc2626", noir: "#1f2937", blanc: "#e7e5e4", vert: "#16a34a",
  jaune: "#eab308", rose: "#ec4899", orange: "#ea580c", violet: "#7c3aed", gris: "#6b7280",
};
let collection = { couleur: "bleu", modifieeLe: null as string | null, par: null as string | null };

// Mails fictifs, remis au moteur comme s'ils arrivaient par IMAP : aucun envoi réel.
type MailDemo = { expediteur: string; nom: string; initiale: string; teinte: string; objet: string; corps: string };
const MAILS: Record<string, MailDemo> = {
  designeuse: {
    expediteur: "Léa Martin <lea.design@atelier-demo.example>", nom: "Léa Martin", initiale: "L", teinte: "#ec4899",
    objet: "Collection Été : on passe en rouge ?",
    corps: "Bonjour,\n\nAprès le shooting d'hier, le bleu de la collection Été ne rend pas bien. Peux-tu passer toute la collection du bleu au rouge ?\n\nMerci !\nLéa, design, Atelier Démo",
  },
  devis: {
    expediteur: "Camille Durand <camille@client-demo.example>", nom: "Camille Durand", initiale: "C", teinte: "#0ea5e9",
    objet: "Devis n° 42 : délai et remise ?",
    corps: "Bonjour,\n\nMerci pour le devis n° 42 (10 casques audio sans fil). Pouvez-vous me confirmer le délai de livraison ? Et une remise est-elle possible à partir de 10 unités ?\n\nBien cordialement,\nCamille Durand",
  },
};
const PORT_MOTEUR = Number(process.env.PORT_MOTEUR ?? 4300);
const echapper = (t: string) => t.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

const pageMail = (id: string, m: MailDemo) => `<!doctype html>
<html lang="fr"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Boîte de réception · démo</title>
<body style="margin: 0; font-family: system-ui, sans-serif; background: #f4f4f5; color: #18181b">
<div style="max-width: 44rem; margin: 2.5rem auto; padding: 0 1rem">
  <div style="font-size: .8rem; letter-spacing: .14em; text-transform: uppercase; color: #71717a">Boîte de réception · données fictives</div>
  <article style="background: #fff; border: 1px solid #e4e4e7; border-radius: 14px; padding: 1.5rem; margin-top: .8rem">
    <h1 style="font-size: 1.35rem; margin: 0 0 1rem">${echapper(m.objet)}</h1>
    <div style="display: flex; gap: .8rem; align-items: center; margin-bottom: 1.2rem">
      <div style="width: 2.4rem; height: 2.4rem; border-radius: 50%; background: ${m.teinte}; color: #fff; display: grid; place-items: center; font-weight: 600">${echapper(m.initiale)}</div>
      <div><div>${echapper(m.expediteur)}</div><div style="color: #71717a; font-size: .9rem">à moi · aujourd'hui</div></div>
    </div>
    ${m.corps.split("\n\n").map((para) => `<p>${echapper(para).replace(/\n/g, "<br>")}</p>`).join("\n    ")}
  </article>
  <div style="display: flex; gap: 1rem; align-items: center; margin-top: 1rem; flex-wrap: wrap">
    <button id="recevoir" style="font: inherit; padding: .6rem 1rem; border-radius: 8px; border: 1px solid #18181b; background: #18181b; color: #fff; cursor: pointer">Faire arriver ce mail (démo)</button>
    <span id="resultat" style="color: #71717a"></span>
  </div>
</div>
<script>
  document.getElementById("recevoir").onclick = async () => {
    const out = document.getElementById("resultat");
    out.textContent = "…";
    try {
      const r = await fetch("/mail/${id}/recevoir", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
      const j = await r.json().catch(() => ({}));
      out.textContent = r.ok ? "Mail remis au moteur Dès que." : "Erreur : " + (j.erreur ?? r.status);
    } catch (e) { out.textContent = "Erreur : " + e.message; }
  };
</script>
</body></html>`;

const json415 = () => Response.json({ erreur: "JSON attendu" }, { status: 415 });
const enJson = (req: Request) => (req.headers.get("content-type") ?? "").startsWith("application/json");

/** Distance au sol entre deux points (km), formule de haversine. */
function distanceKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const r = Math.PI / 180;
  const h = Math.sin(((lat2 - lat1) * r) / 2) ** 2 + Math.cos(lat1 * r) * Math.cos(lat2 * r) * Math.sin(((lon2 - lon1) * r) / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(h));
}

Bun.serve({
  port: PORT,
  hostname: "127.0.0.1",
  async fetch(req) {
    const url = new URL(req.url);
    if (url.pathname === "/devis/42") return new Response(devis, { headers: { "Content-Type": "text/html; charset=utf-8" } });
    // Carte de l'ISS en direct, ouverte par l'action « ouvrir » : /iss (l'équateur) ou /iss?lat=48.8566&lon=2.3522&nom=Paris
    if (url.pathname === "/iss") return new Response(Bun.file(`${import.meta.dir}/iss.html`));
    // Distance de l'ISS à un point, à lire par une source web du moteur (une seule valeur par source).
    if (url.pathname === "/iss/distance") {
      const lat = Number(url.searchParams.get("lat") ?? NaN), lon = Number(url.searchParams.get("lon") ?? NaN);
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) return new Response("lat et lon attendus", { status: 400 });
      const r = await fetch("https://api.wheretheiss.at/v1/satellites/25544", { signal: AbortSignal.timeout(4_000) });
      if (!r.ok) return new Response(`api.wheretheiss.at → ${r.status}`, { status: 502 });
      const iss = (await r.json()) as { latitude: number; longitude: number };
      return new Response(`Distance : ${Math.round(distanceKm(iss.latitude, iss.longitude, lat, lon))} km`);
    }
    if (url.pathname === "/collection") return new Response(Bun.file(`${import.meta.dir}/collection.html`));
    if (url.pathname === "/collection/etat") return Response.json({ ...collection, hex: COULEURS[collection.couleur], permises: Object.keys(COULEURS) });
    // Seule écriture : une couleur de la liste, en JSON (un autre site ne peut pas poster du JSON sans préflight).
    if (req.method === "POST" && url.pathname === "/collection/couleur") {
      if (!enJson(req)) return json415();
      const corps = (await req.json().catch(() => null)) as { couleur?: unknown; par?: unknown } | null;
      const couleur = String(corps?.couleur ?? "").trim().toLowerCase();
      if (!Object.hasOwn(COULEURS, couleur)) return Response.json({ erreur: "couleur non autorisée", permises: Object.keys(COULEURS) }, { status: 400 });
      collection = { couleur, modifieeLe: new Date().toISOString(), par: String(corps?.par ?? "").slice(0, 80) || null };
      console.log(`collection : ${couleur} (par ${collection.par ?? "?"})`);
      return Response.json({ ok: true, couleur });
    }
    const mail = url.pathname.match(/^\/mail\/(\w+)(\/recevoir)?$/);
    if (mail && Object.hasOwn(MAILS, mail[1]!)) {
      const m = MAILS[mail[1]!]!;
      if (!mail[2]) return new Response(pageMail(mail[1]!, m), { headers: { "Content-Type": "text/html; charset=utf-8" } });
      if (req.method !== "POST" || !enJson(req)) return json415();
      const { expediteur, objet, corps } = m;
      const r = await fetch(`http://127.0.0.1:${PORT_MOTEUR}/api/evenements`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ source: "mail", type: "mail_recu", donnees: { expediteur, objet, corps } }),
        signal: AbortSignal.timeout(5_000),
      }).catch((e: Error) => e);
      if (!(r instanceof Response)) return Response.json({ erreur: `moteur injoignable : ${r.message}` }, { status: 502 });
      return new Response(r.body, { status: r.status, headers: { "Content-Type": "application/json" } });
    }
    if (req.method === "POST" && url.pathname === "/prix") {
      const n = Number((await req.formData()).get("prix"));
      if (!Number.isFinite(n) || n < 0) return new Response("prix invalide", { status: 400 });
      prix = n;
      return new Response(null, { status: 303, headers: { Location: "/" } });
    }
    return new Response(page(), { headers: { "Content-Type": "text/html; charset=utf-8" } });
  },
});

console.log(`page de démo : http://127.0.0.1:${PORT} (prix ${prix} €)`);
