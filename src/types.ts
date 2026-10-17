// Contrat partagé entre Dev 1 et Dev 2.
// Ce fichier ne se modifie qu'à deux : tout le reste du code en dépend.

/** Un événement, quelle que soit sa source. */
export type Evenement = {
  id: string;
  source: "screenpipe" | "web" | "mail" | "webhook" | "appel";
  /** ex. "meeting_ended" (screenpipe), "valeur_changee" (web), "mail_recu" (mail), "visio_terminee" (appel) */
  type: string;
  /** Date ISO 8601 */
  date: string;
  donnees: Record<string, unknown>;
  /** Mis à "des-que" sur les événements que nous émettons nous-mêmes, pour éviter les boucles. */
  origine?: "des-que";
};

export type Condition = {
  /** Chemin dans evenement.donnees, ex. "valeur" ou "app" */
  champ: string;
  op: "egal" | "contient" | "superieur" | "inferieur";
  valeur: string | number;
};

/** Une règle « dès que X, fais Y ». */
export type Regle = {
  id: string;
  nom: string;
  active: boolean;
  /** type "*" = n'importe quel type de cette source */
  desQue: { source: Evenement["source"]; type: string; si?: Condition[] };
  alors:
    | {
        mode: "fixe";
        action: string;
        /** Les chaînes peuvent contenir {{champ}}, remplacé par evenement.donnees.champ */
        params: Record<string, unknown>;
      }
    | {
        mode: "ia";
        /** Consigne donnée à Claude pour choisir et remplir l'action */
        consigne: string;
        /** Liste blanche : Claude ne peut proposer que ces actions */
        actionsPermises: string[];
      };
  /** Le mode "ia" impose "demander", quoi qu'indique ce champ. */
  validation: "auto" | "demander";
};

/** Brique B : une tâche répétée repérée dans la mémoire (Dev 1), affichée en carte par la page (Dev 2). */
export type TacheRepetee = {
  /** Nom donné par Claude */
  nom: string;
  /** Applis où la tâche a été vue (app_name de screenpipe) */
  applis: string[];
  /** Jamais vide : une tâche sans preuve est écartée avant d'arriver à la page. date en ISO 8601. */
  preuves: { date: string; extrait: string }[];
  /** Envoyée telle quelle à POST /api/regles par « Créer la règle » ; desQue vise un événement réellement émis. Écrite par Claude à partir de données non fiables : toujours à valider. */
  regle: Regle & { validation: "demander" };
};

export type StatutAction = "proposee" | "validee" | "refusee" | "executee" | "echec";

/** Une action à exécuter, proposée par une règle ou par Claude. */
export type Action = {
  id: string;
  regleId?: string;
  evenementId?: string;
  /** Nom d'exécuteur, ex. "notifier", "slack.envoyer", "telegram.envoyer", "webhook", "pipe.lancer" */
  nom: string;
  params: Record<string, unknown>;
  statut: StatutAction;
  /** Extrait (transcription, page, mail) qui justifie l'action */
  preuve?: string;
  creeeLe: string;
  resultat?: unknown;
  erreur?: string;
};

export type LigneJournal = {
  date: string;
  niveau: "info" | "alerte" | "erreur";
  message: string;
  details?: unknown;
};

/** Ligne définitive d'une transcription de visio (copilote → assistant). date : ISO 8601. */
export type LigneTranscription = { date: string; qui: string; micro: boolean; texte: string };

/** Messages envoyés par le serveur à la page, sur le WebSocket /ws. */
export type MessageUI =
  | { type: "etat"; regles: Regle[]; actions: Action[]; journal: LigneJournal[] }
  | { type: "action"; action: Action }
  | { type: "journal"; ligne: LigneJournal }
  | { type: "visio"; active: boolean; meetingId?: number; app?: string }
  | { type: "transcription"; meetingId: number; texte: string; micro: boolean }
  | { type: "reveil"; meetingId: number }
  | { type: "question"; meetingId: number; question: string }
  | { type: "reponse"; meetingId: number; question: string; reponse: string; citations: string[] };

/** Ce que le moteur expose aux autres modules (sources, copilote, serveur). */
export interface Bus {
  /** Fait passer un événement dans le moteur de règles. */
  emettre(evt: Evenement): Promise<void>;
  /** Propose une action (statut "proposee", en attente de validation dans la page). */
  creerAction(a: Pick<Action, "nom" | "params"> & Partial<Action>): Action;
  /** Envoie un message à toutes les pages ouvertes. */
  diffuser(msg: MessageUI): void;
  journaliser(niveau: LigneJournal["niveau"], message: string, details?: unknown): void;
}
