// Propriétaire : Dev 2. Serveur local : page web, API de pilotage, WebSocket vers la page.
// Écoute seulement 127.0.0.1 : rien n'est exposé sur le réseau.

import { config } from "./config";
import type { Copilote } from "./copilote";
import type { Moteur } from "./moteur";
import { screenpipe, texteBrut, type NotificationScreenpipe } from "./screenpipe";
import * as pipesDesQue from "./pipes-des-que";
import type { Evenement, MessageUI, Regle } from "./types";

const json = (data: unknown, status = 200) => Response.json(data, { status });

/** Refuse un autre site (CSRF) et un nom de domaine qui pointerait vers 127.0.0.1 (DNS rebinding). */
export function origineAcceptee(req: Request, port = config.port): boolean {
  const permis = new Set([`127.0.0.1:${port}`, `localhost:${port}`]);
  const origine = req.headers.get("origin");
  return permis.has(req.headers.get("host") ?? "") && (!origine || permis.has(origine.replace(/^http:\/\//, "")));
}

/** Ce que l'appli screenpipe affiche pour un message du moteur ; null : rien. */
export function notificationPour(m: MessageUI): NotificationScreenpipe | null {
  if (m.type === "action" && m.action.statut === "proposee") {
    const a = m.action;
    const contenu = String(a.params.content ?? a.params.text ?? JSON.stringify(a.params));
    return {
      pipe_name: "des-que",
      title: `Dès que : ${a.nom} à valider`,
      body: texteBrut(contenu) + (a.preuve ? `\n\nPourquoi :\n${texteBrut(a.preuve)}` : ""),
      priority: "high",
      autoDismissMs: 0,
      // Rien ne s'exécute depuis la notification : un bouton link (ouvert par screenpipe en Rust,
      // donc fiable) mène à la page, où l'on valide. Un bouton api serait un clic sans effet sur macOS.
      actions: [{ id: "voir", label: "Voir et valider", type: "link", url: `http://127.0.0.1:${config.port}/` }],
    };
  }
  if (m.type === "action" && m.action.statut === "echec")
    return { pipe_name: "des-que", title: `Dès que : ${m.action.nom} en échec`, body: texteBrut(m.action.erreur), priority: "high" };
  if (m.type === "reveil") return { pipe_name: "des-que", title: "Dès que : je vous écoute", body: "Posez votre question.", priority: "low", autoDismissMs: 8000 };
  if (m.type === "reponse")
    return { pipe_name: "des-que", title: "Dès que : réponse", body: `${texteBrut(m.question)}\n\n${texteBrut(m.reponse)}`, autoDismissMs: 0 };
  return null;
}

export function demarrerServeur(moteur: Moteur, copilote: Copilote) {
  const serveur = Bun.serve({
    hostname: "127.0.0.1",
    port: config.port,

    async fetch(req, server) {
      if (!origineAcceptee(req)) return json({ erreur: "origine refusée" }, 403);
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

        // Brique B : l'ouverture vers l'extérieur et les tâches répétées (produites par Dev 1).
        if (pathname === "/api/connections" && req.method === "GET") {
          return json(await screenpipe.connexions());
        }
        if (pathname === "/api/taches" && req.method === "GET") {
          // data/ est ignoré par git : ce fichier contient des extraits de la vraie mémoire.
          const f = Bun.file(process.env.FICHIER_TACHES ?? "data/taches.json");
          return json((await f.exists()) ? ((await f.json()) as unknown[]) : []);
        }

        // Pont « dès que » : traduit les déclencheurs custom des pipes screenpipe en règles du moteur.
        if (pathname === "/api/pipes/synchroniser" && req.method === "POST") {
          const rapports = await pipesDesQue.synchroniserAutomatiquement(moteur);
          const n = (s: string) => rapports.filter((r) => r.statut === s).length;
          moteur.journaliser("info", `pipes screenpipe : ${n("a_valider")} à valider, ${n("deja")} déjà traitée(s), ${n("refusee")} refusée(s), ${n("retiree")} retirée(s), ${n("erreur")} erreur(s)`);
          return json({ ok: true, rapports });
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
      // Bun ferme un WebSocket inactif après 10 s par défaut : la page se
      // déconnectait toute seule (« la coupure à 10 s »). On tolère 4 min d'inactivité.
      idleTimeout: 240,
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
  moteur.abonner((msg) => {
    const n = notificationPour(msg);
    // console.error et non moteur.journaliser : le journal repasse par le bus, on bouclerait.
    if (n) screenpipe.notifier(n).catch((e) => console.error(`notification screenpipe : ${e.message}`));
  });
  return serveur;
}
