# Régénère le formulaire CAF fictif de la démo (PDF à 5 champs, vides) : python3 scripts/formulaire-demo.py demo/formulaire_CAF.pdf
# Sans dépendance : le PDF est écrit à la main.
import sys
champs = [("nom","Nom",680),("prenom","Prénom",640),("adresse","Adresse",600),("numero_allocataire","Numéro d'allocataire",560),("ressources","Ressources du trimestre (EUR)",520)]
def esc(s): return s.replace("\\","\\\\").replace("(","\\(").replace(")","\\)")
def latin(s): return s.encode("latin-1")
lignes = ["BT /F1 16 Tf 50 770 Td (CAF - Declaration trimestrielle de ressources) Tj ET",
          "BT /F1 10 Tf 50 750 Td (Document fictif pour une demonstration. Remplir tous les champs.) Tj ET"]
for _, lib, y in champs:
    lignes.append(f"BT /F1 11 Tf 50 {y+6} Td ({esc(lib)}) Tj ET")
contenu = "\n".join(lignes).encode("latin-1")
objs = []
objs.append(b"<< /Type /Catalog /Pages 2 0 R /AcroForm << /Fields [" + b" ".join(f"{6+i} 0 R".encode() for i in range(len(champs))) + b"] /NeedAppearances true /DA (/Helv 11 Tf 0 g) /DR << /Font << /Helv 5 0 R >> >> >> >>")
objs.append(b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>")
objs.append(b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 842] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> /Annots [" + b" ".join(f"{6+i} 0 R".encode() for i in range(len(champs))) + b"] >>")
objs.append(b"<< /Length " + str(len(contenu)).encode() + b" >>\nstream\n" + contenu + b"\nendstream")
objs.append(b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>")
for nom, lib, y in champs:
    objs.append(f"<< /Type /Annot /Subtype /Widget /FT /Tx /T ({nom}) /TU ({esc(lib)}) /Rect [250 {y} 560 {y+22}] /F 4 /P 3 0 R /DA (/Helv 11 Tf 0 g) /MK << /BC [0 0 0] >> >>".encode("latin-1"))
out = bytearray(b"%PDF-1.4\n%\xe2\xe3\xcf\xd3\n")
offs = []
for i, o in enumerate(objs, 1):
    offs.append(len(out)); out += f"{i} 0 obj\n".encode() + o + b"\nendobj\n"
x = len(out)
out += f"xref\n0 {len(objs)+1}\n0000000000 65535 f \n".encode() + b"".join(f"{o:010d} 00000 n \n".encode() for o in offs)
out += f"trailer\n<< /Size {len(objs)+1} /Root 1 0 R >>\nstartxref\n{x}\n%%EOF\n".encode()
open(sys.argv[1], "wb").write(out)
