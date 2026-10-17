import { describe, expect, test } from "bun:test";
import { ErreurScreenpipe, type MessageImap } from "../src/screenpipe";
import { sondeurMails } from "../src/sources/mail";
import type { Bus } from "../src/types";

const SOURCE = { type: "mail" as const, mailbox: "test" };

const mail = (id: number, subject: string): MessageImap => ({
  id,
  from: "Camille <camille@exemple.fr>",
  to: "moi@exemple.fr",
  subject,
  date: `2026-10-17T10:0${id}:00+02:00`,
});

/** Faux IMAP : chaque tour lit la réponse suivante (une liste de mails, ou une erreur levée). */
function imapFactice(tours: (MessageImap[] | Error)[]) {
  return {
    mails: async () => {
      const r = tours.shift() ?? [];
      if (r instanceof Error) throw r;
      return { messages: r };
    },
    mail: async (id: number) => ({ body: `Corps du mail ${id}\r\nDeuxième ligne` }),
  };
}

function busFactice() {
  const evenements: any[] = [];
  const journal: string[] = [];
  const bus: Bus = {
    emettre: async (e) => void evenements.push(e),
    creerAction: (a) => ({ id: "x", statut: "proposee", creeeLe: "", ...a }) as any,
    diffuser: () => {},
    journaliser: (_niveau, message) => void journal.push(message),
  };
  return { bus, evenements, journal };
}

describe("source mail", () => {
  test("boîte vide au démarrage, puis un mail arrive : un mail_recu", async () => {
    const { bus, evenements } = busFactice();
    const tour = sondeurMails(SOURCE, bus, imapFactice([[], [mail(1, "Devis à valider")]]));
    await tour();
    await tour();
    expect(evenements).toHaveLength(1);
    expect(evenements[0]).toMatchObject({
      source: "mail",
      type: "mail_recu",
      donnees: { expediteur: "Camille <camille@exemple.fr>", objet: "Devis à valider", corps: "Corps du mail 1\nDeuxième ligne" },
    });
  });

  test("401 puis succès : les mails déjà là servent de référence, une seule alerte", async () => {
    const { bus, evenements, journal } = busFactice();
    const nonBranche = new ErreurScreenpipe(401, "non branché");
    const tour = sondeurMails(SOURCE, bus, imapFactice([nonBranche, nonBranche, [mail(1, "Ancien")]]));
    await tour();
    await tour();
    await tour();
    expect(evenements).toHaveLength(0);
    expect(journal.filter((m) => m.includes("IMAP non branché"))).toHaveLength(1);
  });

  test("un mail déjà vu n'est pas réémis", async () => {
    const { bus, evenements } = busFactice();
    const deux = [mail(1, "Ancien"), mail(2, "Nouveau")];
    const tour = sondeurMails(SOURCE, bus, imapFactice([[mail(1, "Ancien")], deux, deux]));
    await tour();
    await tour();
    await tour();
    expect(evenements.map((e) => e.donnees.objet)).toEqual(["Nouveau"]);
  });
});
