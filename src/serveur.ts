// Propriétaire : Dev 2. Serveur local : page web, API de pilotage, WebSocket vers la page.
// Écoute seulement 127.0.0.1 : rien n'est exposé sur le réseau.

import { pourDebloquer } from "./actions";
import { config } from "./config";
import type { Copilote } from "./copilote";
import type { Moteur } from "./moteur";
import { screenpipe, texteBrut, type NotificationScreenpipe } from "./screenpipe";
import * as pipesDesQue from "./pipes-des-que";
import { MAX_PHRASE, traduireRegle } from "./regle-en-francais";
import type { Evenement, MessageUI, Regle } from "./types";

// L'appli screenpipe (webview Tauri) appelle le moteur depuis « Add trigger » : état des pipes, synchronisation,
// Valider / Refuser, rien d'autre. Le clic sur Valider y reste la validation humaine.
// ponytail: origine macOS et Linux ; sous Windows ce serait http://tauri.localhost.
const ORIGINE_SCREENPIPE = "tauri://localhost";
const ROUTES_SCREENPIPE = /^\/api\/(pipes\/(etat|synchroniser)|actions\/[\w-]+\/(valider|refuser))$/;
const CORS = { "Access-Control-Allow-Origin": ORIGINE_SCREENPIPE, "Access-Control-Allow-Methods": "GET, POST", "Access-Control-Allow-Headers": "content-type" };

// CORS sur toutes les réponses JSON : il n'ouvre que la lecture à l'appli ; ce qu'elle peut appeler, origineAcceptee le décide.
const json = (data: unknown, status = 200) => Response.json(data, { status, headers: CORS });

/** Refuse un autre site (CSRF) et un nom de domaine qui pointerait vers 127.0.0.1 (DNS rebinding). */
export function origineAcceptee(req: Request, port = config.port): boolean {
  const permis = new Set([`127.0.0.1:${port}`, `localhost:${port}`]);
  const origine = req.headers.get("origin");
  if (!permis.has(req.headers.get("host") ?? "")) return false;
  if (origine === ORIGINE_SCREENPIPE) return ROUTES_SCREENPIPE.test(new URL(req.url).pathname);
  return !origine || permis.has(origine.replace(/^http:\/\//, ""));
}

/**
 * Valider / Refuser une action. Depuis l'appli screenpipe (son origine), seulement le branchement d'une pipe qui existe
 * (« pipe.brancher ») : c'est tout ce dont « Add trigger » a besoin, et un script lancé dans sa webview ne peut pas
 * faire partir un message ou un webhook en attente. Les autres origines (page du moteur, curl du chat) : inchangé.
 */
export async function validerOuRefuser(req: Request, moteur: Pick<Moteur, "actions" | "valider" | "refuser">, id: string, verbe: string): Promise<Response> {
  if (req.headers.get("origin") === ORIGINE_SCREENPIPE && moteur.actions.get(id)?.nom !== "pipe.brancher") {
    return json({ erreur: "depuis l'appli screenpipe, seul le branchement d'une pipe se valide ou se refuse" }, 403);
  }
  if (verbe === "valider") await moteur.valider(id);
  else moteur.refuser(id);
  return json({ ok: true });
}

/**
 * POST /api/regles : ajoute ou remplace une règle. Jamais celle d'une pipe screenpipe (« pipe-des-que-… ») : elle ne
 * s'arme que par la validation humaine de son branchement (pipes-des-que.ts), pas par l'API.
 */
export async function poserRegle(moteur: Pick<Moteur, "regles" | "sauverRegles" | "diffuser" | "etat">, regle: Regle): Promise<Response> {
  if (!regle.id || !regle.desQue || !regle.alors) return json({ erreur: "règle incomplète" }, 400);
  if (String(regle.id).startsWith(pipesDesQue.idReglePipe(""))) {
    return json({ erreur: "la règle d'une pipe screenpipe ne se pose que par la validation de son branchement" }, 403);
  }
  moteur.regles = [...moteur.regles.filter((r) => r.id !== regle.id), regle];
  await moteur.sauverRegles();
  moteur.diffuser(moteur.etat());
  return json({ ok: true });
}

/** Ce que l'appli screenpipe affiche pour un message du moteur ; null : rien. */
/** Deeplink screenpipe://chat/new (préremplit le chat, n'envoie jamais rien seul) : demande à l'agent du chat de valider ou refuser l'action. */
export function demandeChat(a: { id: string; nom: string; params: Record<string, unknown> }, geste: "valider" | "refuser"): string {
  const resume = String(a.params.content ?? a.params.text ?? a.nom).slice(0, 600);
  const prompt =
    `Dès que : je ${geste === "valider" ? "valide" : "refuse"} l'action « ${a.nom} » : ${resume}\n` +
    `Exécute exactement cette commande, puis dis-moi seulement sa réponse :\n` +
    `curl -s -X POST http://127.0.0.1:${config.port}/api/actions/${a.id}/${geste}`;
  return `screenpipe://chat/new?v=1&prompt=${encodeURIComponent(prompt)}`;
}

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
      // On valide dans screenpipe, sans quitter l'appli : un bouton deeplink (ouvert en Rust, donc fiable ;
      // un bouton api serait un clic sans effet sur macOS) ouvre le chat screenpipe avec la demande écrite.
      // Rien ne part tant que l'utilisateur ne l'envoie pas lui-même : c'est son envoi qui vaut validation.
      actions: [
        { id: "valider", label: "Valider dans screenpipe", type: "deeplink", url: demandeChat(a, "valider") },
        { id: "refuser", label: "Refuser dans screenpipe", type: "deeplink", url: demandeChat(a, "refuser") },
      ],
    };
  }
  if (m.type === "action" && m.action.statut === "echec") {
    // Une pipe que screenpipe n'a pas lancée (préréglage IA, disque plein, appli fermée…) : dire comment débloquer, si la cause est connue.
    const d = m.action.nom === "pipe.lancer" ? pourDebloquer(String(m.action.erreur ?? "")) : undefined;
    return {
      pipe_name: "des-que",
      title: `Dès que : ${m.action.nom} en échec`,
      body: texteBrut(m.action.erreur) + (d ? `\n\n${d.texte}` : ""),
      priority: "high",
      ...(d?.bouton && { actions: [d.bouton] }),
    };
  }
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
      if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS }); // préflight : n'exécute rien
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
        // await : une erreur de validation reste une réponse 400 du catch ci-dessous.
        if (m && req.method === "POST") return await validerOuRefuser(req, moteur, m[1]!, m[2]!);

        if (pathname === "/api/regles" && req.method === "GET") return json(moteur.regles);
        if (pathname === "/api/regles" && req.method === "POST") return await poserRegle(moteur, (await req.json()) as Regle);
        // « Écris ta règle en français » : traduit seulement ; la page pose la règle par POST /api/regles au clic.
        if (pathname === "/api/regles/traduire" && req.method === "POST") {
          const { phrase } = (await req.json()) as { phrase?: string };
          if (!phrase?.trim() || phrase.length > MAX_PHRASE) return json({ erreur: `phrase vide ou de plus de ${MAX_PHRASE} caractères` }, 400);
          return json(await traduireRegle(phrase.trim()));
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
        if (pathname === "/api/pipes/etat" && req.method === "GET") return json(await pipesDesQue.etatPipes(moteur));
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
