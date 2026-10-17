import { afterEach, expect, spyOn, test } from "bun:test";
import { executeurs } from "../src/actions";
import type { Bus } from "../src/types";

let espion: ReturnType<typeof spyOn> | undefined;
afterEach(() => espion?.mockRestore());

test("ouvrir : refuse tout ce qui n'est pas une page http ou https", async () => {
  for (const url of ["file:///etc/hosts", "javascript:alert(1)", "-a Calculator", "", undefined]) {
    await expect(executeurs.ouvrir!({ url }, {} as Bus)).rejects.toThrow("paramètre « url »");
  }
});

test("ouvrir : passe l'URL normalisée à open, sans les clés du .env", async () => {
  process.env.FAUSSE_CLE_API = "factice";
  const appels: { cmd: string[]; env: Record<string, string> }[] = [];
  // Rien n'est lancé : Bun.spawn est simulé.
  espion = spyOn(Bun, "spawn").mockImplementation(((cmd: string[], o: { env: Record<string, string> }) => {
    appels.push({ cmd, env: o.env });
    return { exited: Promise.resolve(0), exitCode: 0 };
  }) as any);
  expect(await executeurs.ouvrir!({ url: "http://127.0.0.1:4310/iss?nom=Paris" }, {} as Bus)).toEqual({ ouverte: "http://127.0.0.1:4310/iss?nom=Paris" });
  expect(appels[0]!.cmd.at(-1)).toBe("http://127.0.0.1:4310/iss?nom=Paris");
  expect(Object.keys(appels[0]!.env).filter((k) => /KEY|CLE|TOKEN|SECRET/i.test(k))).toEqual([]);
  delete process.env.FAUSSE_CLE_API;
});
