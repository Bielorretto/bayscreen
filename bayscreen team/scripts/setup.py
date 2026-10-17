#!/usr/bin/env python3
"""Configurer l'identité LOCALE de l'agent ; ne partage pas cette configuration."""
import argparse
import json
from pathlib import Path
import re
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[1]


def main() -> int:
    p = argparse.ArgumentParser()
    p.add_argument("--member", required=True)
    p.add_argument("--agent", required=True, help="nom court de la machine / de l'agent")
    args = p.parse_args()
    cfg = json.loads((ROOT / "team.json").read_text(encoding="utf8"))
    if args.member not in cfg.get("members", []) or not re.fullmatch("[a-z][a-z0-9_-]{1,31}", args.agent):
        p.error("Member absent de team.json, ou agent invalide")
    if subprocess.run(["git", "-C", str(ROOT), "rev-parse", "--is-inside-work-tree"], capture_output=True).returncode:
        p.error("Ce projet doit d'abord être un dépôt Git")
    subprocess.run(["git", "-C", str(ROOT), "config", "--local", "hackathon.member", args.member], check=True)
    subprocess.run(["git", "-C", str(ROOT), "config", "--local", "hackathon.agent", f"{args.member}/{args.agent}"], check=True)
    session = ROOT / "sessions" / f"{args.member}.md"
    if not session.exists():
        text = (ROOT / "sessions" / "_TEMPLATE.md").read_text(encoding="utf8")
        session.write_text(text.replace("[MEMBRE]", args.member), encoding="utf8")
    print(f"Identité enregistrée UNIQUEMENT dans ce clone Git : {args.member}/{args.agent}")
    print("Aucune synchronisation distante ni autorisation d'action n'a été donnée.")
    return 0

if __name__ == "__main__":
    sys.exit(main())
