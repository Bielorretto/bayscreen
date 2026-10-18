# Fichiers de démo « Dès que » (tous fictifs)

Les consignes des pipes de démo cherchent ces fichiers dans `~/Documents/des-que-demo/` : les y copier d'abord.

```sh
mkdir -p ~/Documents/des-que-demo && cp demo/*.docx demo/*.pdf demo/profil.txt ~/Documents/des-que-demo/
```

| Fichier | Cas | Attendu |
| --- | --- | --- |
| `article_mairie.docx` | journaliste | article à sources piégées : Tour Eiffel, Paris, Loire justes ; la Seine « 1 200 km » est faux (777 km) ; le lien de la mairie est mort. Un vrai article écrit dans Pages marche aussi. |
| `formulaire_CAF.pdf` | administratif | formulaire à 5 champs vides (nom, prénom, adresse, numéro d'allocataire, ressources) : Haiku dit « administratif », la pipe le remplit avec `profil.txt` |
| `scan_003.pdf` | administratif | même formulaire sous un nom qui ne dit rien : reconnu par le texte de l'écran |
| `recette_crepes.pdf` | administratif | pas administratif : rien ne doit partir |
| `profil.txt` | administratif | les infos fictives de Camille Martin |

Remettre le formulaire à vide : `python3 scripts/formulaire-demo.py ~/Documents/des-que-demo/formulaire_CAF.pdf`
(le document fermé ; si on reteste dans les 30 min, relancer le moteur, qui ne relance pas une pipe pour un même document).

Pour la démo : ouvrir les PDF dans Aperçu (le mettre en appli par défaut des PDF) ; Acrobat ne recharge pas un fichier
modifié, et la pipe n'arrive pas toujours à fermer sa fenêtre.
