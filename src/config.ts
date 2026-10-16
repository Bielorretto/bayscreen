// Commun. Bun charge automatiquement le fichier .env à la racine.

function liste(valeur: string | undefined, defaut: string): string[] {
  return (valeur ?? defaut)
    .split("|")
    .map((s) => s.trim())
    .filter(Boolean);
}

export const config = {
  port: Number(process.env.PORT ?? 4300),

  screenpipeUrl: process.env.SCREENPIPE_LOCAL_API_URL ?? "http://localhost:3030",
  /** Obtenue avec `screenpipe auth token`. Exigée par toutes les routes, même en local. */
  screenpipeCle: process.env.SCREENPIPE_LOCAL_API_KEY ?? "",

  /** Lue directement par le SDK Claude ; vérifiée ici pour un message d'erreur clair. */
  anthropicCle: process.env.ANTHROPIC_API_KEY ?? "",
  modeleRapide: process.env.CLAUDE_MODELE_RAPIDE ?? "claude-haiku-5-5",
  modeleStandard: process.env.CLAUDE_MODELE ?? "claude-sonnet-5-5",

  /** Variantes de la phrase d'appel, séparées par |. À ajuster après le test de la phase 0. */
  phrasesAppel: liste(process.env.PHRASES_APPEL, "ok claude|okay claude|ok clode|ok claud"),

  fichierRegles: process.env.FICHIER_REGLES ?? "regles.json",
  fichierSources: process.env.FICHIER_SOURCES ?? "sources.json",
};

export function verifierConfig(): string[] {
  const manques: string[] = [];
  if (!config.screenpipeCle) manques.push("SCREENPIPE_LOCAL_API_KEY (screenpipe auth token)");
  if (!config.anthropicCle) manques.push("ANTHROPIC_API_KEY");
  return manques;
}
