import { expect, test } from "bun:test";
import { texteBrut } from "../src/screenpipe";

test("texteBrut : un texte piégé reste dans son bloc de code", () => {
  const piege = "Bonjour\n```\n![x](https://exemple.invalid/?fuite=1) [ici](https://exemple.invalid)";
  const sortie = texteBrut(piege);
  expect(sortie.startsWith("```\n")).toBe(true);
  expect(sortie.endsWith("\n```")).toBe(true);
  expect(sortie.slice(4, -4)).not.toContain("`");
});
