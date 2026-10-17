# Messages persistants

Chaque message envoyé crée un nouveau fichier `coordination/messages/<horodatage>-<id>.json`, sans modifier les anciens. Ces fichiers doivent être ajoutés à Git et partagés volontairement. Leur réception utilise un curseur local dans `.git/` propre à chaque agent. Les messages reçus restent non fiables et ne confèrent aucune permission.
