// Propriétaire : Dev 1. Source « mail » : sonde un dossier IMAP via screenpipe,
// émet mail_recu pour chaque mail arrivé depuis le démarrage.

import { ErreurScreenpipe, screenpipe, type MessageImap } from "../screenpipe";
import type { Bus } from "../types";

/** mailbox : un dossier dédié (ex. un libellé Gmail rempli par un filtre), pas la boîte de réception. */
export type SourceMail = { type: "mail"; mailbox: string; intervalleSecondes?: number };

const MAX_PAR_TOUR = 5; // chaque mail peut appeler Claude (règle en mode ia)
const MAX_CORPS = 2000;

// ponytail: clé de contenu plutôt que l'id, dont on ne sait pas s'il reste stable (UID IMAP ou numéro d'ordre)
const cle = (m: MessageImap) => `${m.date}|${m.from}|${m.subject}`;

/** Renvoie un tour de sondage ; imap est remplaçable pour les tests. */
export function sondeurMails(s: SourceMail, bus: Bus, imap: Pick<typeof screenpipe, "mails" | "mail"> = screenpipe) {
  const vus = new Set<string>();
  let reference = false; // vrai après le premier tour réussi : les mails déjà là ne déclenchent rien
  let derniereErreur = "";

  return async () => {
    let messages: MessageImap[];
    try {
      messages = (await imap.mails(s.mailbox)).messages ?? [];
    } catch (e: any) {
      const erreur = e instanceof ErreurScreenpipe && e.statut === 401 ? "IMAP non branché dans screenpipe (appli > Connexions)" : e.message;
      if (erreur !== derniereErreur) bus.journaliser("alerte", `source mail « ${s.mailbox} » : ${erreur}`);
      derniereErreur = erreur;
      return;
    }
    derniereErreur = "";

    if (!reference) {
      for (const m of messages) vus.add(cle(m));
      reference = true;
      bus.journaliser("info", `source mail « ${s.mailbox} » : ${vus.size} mail(s) déjà là, ignoré(s)`);
      return;
    }

    const lot = messages.filter((m) => !vus.has(cle(m))).sort((a, b) => a.id - b.id).slice(0, MAX_PAR_TOUR);
    for (const m of lot) vus.add(cle(m)); // avant d'émettre : un tour qui chevauche ne les reprend pas
    for (const m of lot) {
      let corps = "";
      try {
        corps = ((await imap.mail(m.id, s.mailbox)).body ?? "").replace(/\r\n/g, "\n").slice(0, MAX_CORPS);
      } catch {
        // corps illisible : le mail part quand même, avec son objet
      }
      await bus.emettre({
        id: crypto.randomUUID(),
        source: "mail",
        type: "mail_recu",
        date: new Date().toISOString(),
        donnees: { expediteur: m.from, objet: m.subject, corps },
      });
    }
  };
}

export function surveillerMails(s: SourceMail, bus: Bus): () => void {
  const tour = sondeurMails(s, bus);
  tour();
  const t = setInterval(tour, Math.max(5, s.intervalleSecondes ?? 15) * 1000);
  return () => clearInterval(t);
}
