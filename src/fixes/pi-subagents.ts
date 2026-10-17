// Propriétaire : Dev 2. Contournement d'un bug de screenpipe : son extension pi-subagents,
// chargée par défaut et réinstallée par l'app à chaque redémarrage, exige une version de
// pi-ai plus récente que celle embarquée — son échec de chargement tue l'agent des pipes
// avant qu'aucune ne tourne. Nos pipes n'en ont pas besoin (éprouvé sans elle) : on la
// retire de la liste des extensions avant chaque lancement de pipe. Sauvegarde .bak-pont.

import { copyFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";

const fichier = () => `${process.env.HOME ?? ""}/.screenpipe/pi-config/settings.json`;

/** Retire npm:pi-subagents des listes d'extensions de l'agent. true si un retrait a eu lieu. */
export function retirerPiSubAgents(): boolean {
  const chemin = fichier();
  if (!existsSync(chemin)) return false;
  let contenu: Record<string, unknown>;
  try {
    contenu = JSON.parse(readFileSync(chemin, "utf8")) as Record<string, unknown>;
  } catch {
    return false;
  }
  let modifie = false;
  for (const cle of Object.keys(contenu)) {
    const v = contenu[cle];
    if (Array.isArray(v) && v.includes("npm:pi-subagents")) {
      contenu[cle] = v.filter((x) => x !== "npm:pi-subagents");
      modifie = true;
    }
  }
  if (!modifie) return false;
  try {
    copyFileSync(chemin, `${chemin}.bak-pont`);
    writeFileSync(chemin, JSON.stringify(contenu, null, 2) + "\n");
  } catch {
    return false;
  }
  return true;
}

/**
 * Appelé avant chaque lancement de pipe et au démarrage du moteur. Ne journalise que
 * quand il agit : si l'app n'a pas réinstallé l'extension, il ne se passe rien.
 */
export async function degagerExtensionIncompatible(
  journaliser: (niveau: "info" | "alerte", message: string) => void,
): Promise<void> {
  if (retirerPiSubAgents())
    journaliser(
      "alerte",
      "extension pi-subagents retirée de la config de screenpipe : incompatible avec son agent embarqué, elle empêchait toute pipe de s'exécuter (l'app la réinstalle parfois au redémarrage)",
    );
}
