// Propriétaire : Dev 2. Contournement d'un bug de screenpipe : son extension pi-subagents,
// chargée par défaut et réinstallée par l'app à chaque redémarrage, exige une version de
// pi-ai plus récente que celle embarquée — son échec de chargement tue l'agent des pipes
// avant qu'aucune ne tourne. Nos pipes n'en ont pas besoin (éprouvé sans elle) : on la
// retire de la liste des extensions avant chaque lancement de pipe. Sauvegarde .bak-pont.

import { copyFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";

const fichier = () => `${process.env.HOME ?? ""}/.screenpipe/pi-config/settings.json`;
const dossierNpm = () => `${process.env.HOME ?? ""}/.screenpipe/pi-config/npm`;

/**
 * Le retrait seul ne suffit pas : screenpipe réécrit ses réglages au lancement de chaque pipe et y remet l'extension
 * (vu le 18/10). La parade durable est la version que screenpipe fige lui-même depuis (commit amont 91f1a17) :
 * compatible avec l'agent des pipes (pi 0.84.1), elle peut être chargée sans rien casser.
 */
export const VERSION_COMPATIBLE = "0.70.0";

/** Version de pi-subagents installée pour l'agent de screenpipe ; null si absente. */
export function versionInstallee(): string | null {
  try {
    return String(JSON.parse(readFileSync(`${dossierNpm()}/node_modules/pi-subagents/package.json`, "utf8")).version ?? "") || null;
  } catch {
    return null;
  }
}

let figeage: Promise<boolean> | null = null;
/**
 * Installe pi-subagents à la version compatible (bun add --exact) si une autre version est installée. Ne fait rien si
 * screenpipe n'a pas de dossier npm, si l'extension est absente ou déjà à la bonne version. Un seul figeage à la fois.
 * Sauvegarde package.json.bak-pont avant. true si la version a été changée.
 */
export function figerVersionCompatible(): Promise<boolean> {
  const v = versionInstallee();
  if (!existsSync(`${dossierNpm()}/package.json`) || v === null || v === VERSION_COMPATIBLE) return Promise.resolve(false);
  figeage ??= (async () => {
    try {
      copyFileSync(`${dossierNpm()}/package.json`, `${dossierNpm()}/package.json.bak-pont`);
      const p = Bun.spawn([process.execPath, "add", "--exact", `pi-subagents@${VERSION_COMPATIBLE}`], { cwd: dossierNpm(), stdout: "ignore", stderr: "ignore" });
      return (await p.exited) === 0 && versionInstallee() === VERSION_COMPATIBLE;
    } catch {
      return false;
    } finally {
      figeage = null;
    }
  })();
  return figeage;
}

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
  const avant = versionInstallee();
  if (await figerVersionCompatible())
    journaliser("alerte", `pi-subagents ramené de ${avant} à ${VERSION_COMPATIBLE} pour l'agent des pipes de screenpipe (les versions suivantes font échouer toutes les pipes au chargement)`);
  else if (avant !== null && avant !== VERSION_COMPATIBLE && versionInstallee() !== VERSION_COMPATIBLE)
    journaliser("alerte", `pi-subagents ${avant} : impossible de le ramener à ${VERSION_COMPATIBLE} ; à la main : cd ~/.screenpipe/pi-config/npm && bun add --exact pi-subagents@${VERSION_COMPATIBLE}`);
  if (retirerPiSubAgents())
    journaliser(
      "alerte",
      "extension pi-subagents retirée de la config de screenpipe : incompatible avec son agent embarqué, elle empêchait toute pipe de s'exécuter (l'app la réinstalle parfois au redémarrage)",
    );
}
