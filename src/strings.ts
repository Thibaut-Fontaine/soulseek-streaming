/**
 * User-facing French text shared by the store, the screens and the errors.
 *
 * The app is SoulStream: the network it uses is never named in the interface,
 * both to keep the product's own identity and because uploader identities are
 * private by default. Technical comments and server internals keep the real
 * protocol names.
 */

export const HIDDEN_UPLOADER = 'Pair';

/** `@name` when the user allows it; a neutral word otherwise. */
export function uploaderLabel(username: string, showUploaders: boolean): string {
  return showUploaders && username ? `@${username}` : HIDDEN_UPLOADER;
}

/** Same, inside a sentence ("Connexion à …", "En file chez …"). */
export function uploaderPhrase(username: string, showUploaders: boolean): string {
  return showUploaders && username ? username : 'un pair';
}

/** Whether an artist line is only the (hidden or shown) uploader. */
export function isUploaderLabel(value: string): boolean {
  return value.startsWith('@') || value === HIDDEN_UPLOADER;
}

/**
 * Replaces every known uploader name in a text (debug journal, shared error).
 * `@name` and `name` both become the neutral label.
 */
export function redactUploaderNames(text: string, usernames: readonly string[]): string {
  let result = text;

  for (const username of [...new Set(usernames)].filter(Boolean).sort((a, b) => b.length - a.length)) {
    const escaped = username.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    result = result.replace(new RegExp(`@?${escaped}`, 'gi'), HIDDEN_UPLOADER);
  }

  return result;
}

/** Sentences that used to name the network. Kept in one place. */
export const messages = {
  loginUsernameRequired: "Indiquez votre nom d'utilisateur",
  createAccountHint:
    'Le compte est créé dès la première connexion avec ce nom et ce mot de passe. ' +
    'Notez le mot de passe : il ne peut pas être récupéré. Un nom inutilisé pendant 30 jours est libéré.',
  loginSubtitle:
    'Streaming musical pair-à-pair sur le réseau. Vos identifiants restent dans le trousseau sécurisé de l’appareil.',
  acceptRulesSuffix: 'du réseau.',
  loginLegal:
    'SoulStream ne fournit aucun contenu. Vous êtes responsable des œuvres que vous écoutez et partagez. ' +
    'Le réseau nécessite un port entrant accessible pour de meilleures performances.',
  serverTitle: 'Serveur',
  settingsCatalogOff:
    'Pochettes, titres, artistes et suggestions via Deezer. Désactivé : uniquement les noms de fichiers du réseau.',
  settingsAboutClient:
    'SoulStream est un client pair-à-pair expérimental. Il ne fournit aucun fichier ni catalogue de téléchargement : ' +
    'les métadonnées et pochettes viennent du catalogue public Deezer, les fichiers des utilisateurs du réseau. ' +
    'Le catalogue est désactivable dans Réglages → Catalogue.',
  settingsAboutSharing:
    'Le partage se configure dans le client, pas dans le compte du réseau. SoulStream partage les morceaux écoutés ' +
    'et ceux que vous ajoutez ; certains utilisateurs limitent ou bloquent les téléchargements des pairs qui ne partagent rien.',
  serverRequired: 'Indiquez un serveur',
  bannerReconnecting: 'Reconnexion au serveur…',
  bannerConnecting: 'Connexion au serveur…',
  bannerOffline: 'Déconnecté du réseau',
  searchOffline:
    'La recherche sur le réseau reprendra dès que la connexion sera rétablie. Les morceaux sur l’appareil restent disponibles.',
  searchFiles: 'Chercher les fichiers sur le réseau',
  notConnected: 'Non connecté au réseau',
  fileSearchOnNetwork: 'recherche des fichiers sur le réseau',
  peerOfflineBody: 'Ce pair s’est déconnecté du réseau avant de vous envoyer le fichier.',
  sharingExplanation:
    'Beaucoup d’utilisateurs du réseau refusent les téléchargements des comptes qui ne partagent aucun fichier. ' +
    'SoulStream ne partage pas encore de fichiers : essayez une autre source, ou partagez des fichiers depuis ' +
    'un autre client avec le même compte.',
  serverOfflineBody: 'La connexion au serveur est coupée.',
};
