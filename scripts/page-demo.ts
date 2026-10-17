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
