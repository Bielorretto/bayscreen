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

Bun.serve({
  port: PORT,
  hostname: "127.0.0.1",
  async fetch(req) {
    const url = new URL(req.url);
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
