// Propriétaire : Dev 2. Serveur local : page web, API de pilotage, WebSocket vers la page.
// Écoute seulement 127.0.0.1 : rien n'est exposé sur le réseau.

import { config } from "./config";
import type { Copilote } from "./copilote";
import type { Moteur } from "./moteur";
import type { Evenement, Regle } from "./types";

const json = (data: unknown, status = 200) => Response.json(data, { status });

export function demarrerServeur(moteur: Moteur, copilote: Copilote) {
  const serveur = Bun.serve({
    hostname: "127.0.0.1",
    port: config.port,

    async fetch(req, server) {
      const url = new URL(req.url);
      const { pathname } = url;

      if (pathname === "/ws") {
        return server.upgrade(req) ? undefined : new Response("WebSocket attendu", { status: 400 });
      }
      if (pathname === "/" && req.method === "GET") return new Response(Bun.file("public/index.html"));

      try {
        if (pathname === "/api/etat") return json(moteur.etat());

        // Simuler n'importe quel événement : le meilleur outil de test de la nuit.
        if (pathname === "/api/evenements" && req.method === "POST") {
          const corps = (await req.json()) as Partial<Evenement>;
          if (!corps.source || !corps.type) return json({ erreur: "source et type obligatoires" }, 400);
          const evt: Evenement = {
            id: crypto.randomUUID(),
            date: new Date().toISOString(),
            donnees: {},
            ...corps,
          } as Evenement;
          await moteur.emettre(evt);
          return json({ ok: true, id: evt.id });
        }

        const m = pathname.match(/^\/api\/actions\/([\w-]+)\/(valider|refuser)$/);
        if (m && req.method === "POST") {
          const [, id, verbe] = m;
          if (verbe === "valider") await moteur.valider(id!);
          else moteur.refuser(id!);
          return json({ ok: true });
        }

        if (pathname === "/api/regles" && req.method === "GET") return json(moteur.regles);
        if (pathname === "/api/regles" && req.method === "POST") {
          const regle = (await req.json()) as Regle;
          if (!regle.id || !regle.desQue || !regle.alors) return json({ erreur: "règle incomplète" }, 400);
          moteur.regles = [...moteur.regles.filter((r) => r.id !== regle.id), regle];
          await moteur.sauverRegles();
          moteur.diffuser(moteur.etat());
          return json({ ok: true });
        }

        if (pathname === "/api/copilote/question" && req.method === "POST") {
          const { question } = (await req.json()) as { question?: string };
          if (!question?.trim()) return json({ erreur: "question vide" }, 400);
          copilote.questionTapee(question.trim());
          return json({ ok: true });
        }

        return json({ erreur: "introuvable" }, 404);
      } catch (e: any) {
        return json({ erreur: e.message }, 400);
      }
    },

    websocket: {
      open(ws) {
        ws.subscribe("ui");
        ws.send(JSON.stringify(moteur.etat()));
        if (copilote.visio) ws.send(JSON.stringify({ type: "visio", active: true, ...copilote.visio }));
      },
      message() {
        /* la page ne parle que par l'API REST */
      },
    },
  });

  moteur.abonner((msg) => serveur.publish("ui", JSON.stringify(msg)));
  return serveur;
}
