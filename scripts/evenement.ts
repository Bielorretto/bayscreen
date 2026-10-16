export {};
// Envoie un événement factice au moteur : bun run evt <source> <type> '<json des données>'
// ex. bun run evt mail mail_recu '{"expediteur":"client@exemple.fr","objet":"Devis urgent","corps":"Pouvez-vous me rappeler avant 18 h ?"}'
const [source = "web", type = "valeur_changee", donnees = "{}"] = process.argv.slice(2);
const port = process.env.PORT ?? "4300";
const res = await fetch(`http://127.0.0.1:${port}/api/evenements`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ source, type, donnees: JSON.parse(donnees) }),
});
console.log(res.status, await res.text());
