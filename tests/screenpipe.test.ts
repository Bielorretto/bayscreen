import { describe, expect, test } from "bun:test";
import { corpsDiscord, motsCles, souvenirs, texteBrut } from "../src/screenpipe";

test("corpsDiscord : mentionne la personne choisie et bloque @everyone", () => {
  const c = corpsDiscord("@everyone urgent", "123456789012345678");
  expect(c.content.startsWith("<@123456789012345678> ")).toBe(true);
  expect(c.allowed_mentions).toEqual({ parse: [], users: ["123456789012345678"] });
  expect(corpsDiscord("bonjour", "pas-un-id").content).toBe("bonjour");
});

test("texteBrut : un texte piégé reste dans son bloc de code", () => {
  const piege = "Bonjour\n```\n![x](https://exemple.invalid/?fuite=1) [ici](https://exemple.invalid)";
  const sortie = texteBrut(piege);
  expect(sortie.startsWith("```\n")).toBe(true);
  expect(sortie.endsWith("\n```")).toBe(true);
  expect(sortie.slice(4, -4)).not.toContain("`");
});

describe("mémoire", () => {
  test("motsCles garde les mots parlants et les nombres", () => {
    expect(motsCles("Devis n° 42 à valider")).toEqual(["devis", "42", "valider"]);
    expect(motsCles("Re: OK")).toEqual([]);
    // Question naturelle posée au copilote : les mots interrogatifs ne prennent pas la place des mots utiles.
    expect(motsCles("quel était le prix du casque audio ?")).toEqual(["prix", "casque", "audio"]);
  });

  // Faux /search : chaque mot renvoie les écrans fictifs qui le contiennent.
  const ecran = (frame_id: number, text: string, type = "OCR") => ({
    type,
    content: { frame_id, text, timestamp: "2026-10-17T05:00:00Z", app_name: "Navigateur", window_name: "Fenêtre" },
  });
  const ecrans = [
    ecran(1, "Devis n° 42 — 10 casques audio — Total : 1 290 €"),
    ecran(2, "Merci de valider votre inscription"),
    ecran(3, "devis 42 dicté en réunion", "Audio"),
  ];
  const chercher = async (p: { q?: string }) => ({ data: ecrans.filter((e) => e.content.text.toLowerCase().includes(String(p.q))) });

  test("souvenirs garde l'écran qui contient au moins deux mots, jamais l'audio", async () => {
    const s = await souvenirs("Devis n° 42 à valider", {}, chercher);
    expect(s).toHaveLength(1);
    expect(s[0]!.extrait).toContain("1 290 €");
  });

  test("l'audio ne prend pas les places de l'écran : la recherche ne demande que le texte d'écran", async () => {
    // Comme screenpipe quand l'audio tourne : « all » ne renvoie que 10 passages audio ; « ocr » renvoie l'écran.
    const audio = Array.from({ length: 10 }, (_, i) => ecran(100 + i, "prix du casque audio, on en parlait", "Audio"));
    const s = await souvenirs("quel était le prix du casque audio ?", {}, async (p: { q?: string; content_type?: string }) => ({
      data: p.content_type === "ocr" ? [ecran(1, "Notification : Casque audio : 89 € (avant : 120 €), prix en baisse")] : p.content_type === "all" ? audio : [],
    }));
    expect(s.map((x) => x.extrait)).toEqual([expect.stringContaining("89 €")]);
  });

  test("un souvenir par fenêtre : un éditeur ouvert ne chasse pas la page du devis", async () => {
    const editeur = (id: number) => ({ ...ecran(id, "devis 42 valider : notes de travail"), content: { ...ecran(id, "devis 42 valider : notes de travail").content, app_name: "Éditeur" } });
    const data = [editeur(20), editeur(21), editeur(22), ecran(1, "Devis n° 42 — Total : 1 290 €")];
    const s = await souvenirs("Devis n° 42 à valider", {}, async (p: { q?: string }) => ({ data: data.filter((e) => e.content.text.toLowerCase().includes(String(p.q))) }));
    expect(s.map((x) => x.appli)).toEqual(["Éditeur", "Navigateur"]);
  });

  test("l'extrait part du corps de la page, pas de l'onglet ni des autres onglets", async () => {
    const page = `Devis n° 42 - Navigateur | Onglet personnel | 127.0.0.1:4310/devis/42 ${"menu ".repeat(80)}Devis n° 42 Client : Camille 10 casques Total : 1 290 € TTC`;
    const s = await souvenirs("Devis n° 42", {}, async () => ({ data: [ecran(9, page)] }));
    expect(s[0]!.extrait).toContain("Total : 1 290 €");
    expect(s[0]!.extrait).not.toContain("Onglet personnel");
  });
});
