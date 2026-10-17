import { afterEach, expect, spyOn, test } from "bun:test";
import { executeurs } from "../src/actions";
import { screenpipe, texteBrut, type NotificationScreenpipe } from "../src/screenpipe";
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

test("notifier : un bouton lien seulement pour une page http ou https, et l'information passe toujours", async () => {
  const envoyees: NotificationScreenpipe[] = [];
  espion = spyOn(screenpipe, "notifier").mockImplementation((async (n: NotificationScreenpipe) => {
    envoyees.push(n);
    return {};
  }) as any);
  const journal: string[] = [];
  const bus = { journaliser: (_niveau: string, m: string) => journal.push(m) } as unknown as Bus;

  await executeurs.notifier!({ text: "L'ISS passe au-dessus de Paris", lien: "http://127.0.0.1:4310/iss?nom=Paris", libelle: "Voir le direct NASA" }, bus);
  expect(envoyees[0]!.actions).toEqual([{ id: "ouvrir", label: "Voir le direct NASA", type: "link", url: "http://127.0.0.1:4310/iss?nom=Paris" }]);

  for (const lien of ["javascript:alert(1)", "file:///etc/hosts", "screenpipe://chat/new?v=1&prompt=x", "-a Calculator"]) {
    await executeurs.notifier!({ text: "x", lien }, bus);
    expect(envoyees.at(-1)!.actions).toBeUndefined();
    expect(envoyees.at(-1)!.body).toBe(texteBrut("x"));
  }
  expect(journal.filter((m) => m.includes("lien ignoré"))).toHaveLength(4);

  await executeurs.notifier!({ text: "libellé vide", lien: "https://exemple.invalid/", libelle: "  \n " }, bus);
  expect(envoyees.at(-1)!.actions![0]!.label).toBe("Ouvrir");

  await executeurs.notifier!({ text: "sans lien", lien: "" }, bus);
  expect(envoyees.at(-1)!.actions).toBeUndefined();
  expect(journal.filter((m) => m.includes("lien ignoré"))).toHaveLength(4);
});
