import Anthropic from "@anthropic-ai/sdk";
import { afterAll, expect, spyOn, test } from "bun:test";

// Le vrai module : tests/pipes-des-que.test.ts simule « ../src/claude » pour tout le processus (mock.module),
// « ?reel » en charge une copie à part. Son client vise un port fermé : rien ne partirait vers l'API si l'espion ratait.
const urlAvant = process.env.ANTHROPIC_BASE_URL;
process.env.ANTHROPIC_BASE_URL = "http://127.0.0.1:9";
const chemin = "../src/claude.ts?reel";
const { demanderJSON } = (await import(chemin)) as typeof import("../src/claude");
if (urlAvant === undefined) delete process.env.ANTHROPIC_BASE_URL;
else process.env.ANTHROPIC_BASE_URL = urlAvant;

// Requête simulée au niveau du SDK : on lit les options de requête qu'il recevrait.
let options: Record<string, any> | undefined;
let repondre: (o: Record<string, any> | undefined) => Promise<unknown>;
const create = spyOn(Anthropic.Messages.prototype, "create").mockImplementation(((_: unknown, o?: Record<string, any>) => ((options = o), repondre(o))) as any);
afterAll(() => create.mockRestore());

const question = { systeme: "Réponds.", contenu: "Bonjour", schema: { type: "object" } };

test("demanderJSON sans délai : aucune option de requête, comme avant", async () => {
  repondre = async () => ({ stop_reason: "end_turn", content: [{ type: "text", text: '{"ok":true}' }] });
  expect(await demanderJSON(question)).toEqual({ ok: true });
  expect(options).toEqual({});
});

test("demanderJSON avec délai : une nouvelle tentative au plus, et un signal qui coupe tout au bout du délai", async () => {
  // Comme le SDK : la requête n'échoue que si son signal coupe ; sinon elle traîne bien au-delà du délai.
  repondre = (o) =>
    new Promise((_, rejeter) => {
      const t = setTimeout(() => rejeter(new Error("jamais coupée")), 2_000);
      o?.signal?.addEventListener("abort", () => (clearTimeout(t), rejeter(new Error("Request was aborted."))));
    });
  const debut = performance.now();
  await expect(demanderJSON({ ...question, delaiMs: 50, nouvellesTentatives: 1 })).rejects.toThrow("Claude n'a pas répondu dans les 0.05 s");
  expect(performance.now() - debut).toBeLessThan(1_000);
  expect(options).toMatchObject({ timeout: 50, maxRetries: 1 });
  expect(options?.signal).toBeInstanceOf(AbortSignal);
});
