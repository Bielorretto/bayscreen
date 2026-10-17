#!/usr/bin/env python3
"""Messagerie Git locale et sans dépendances pour équipes d'agents.

Chaque message = fichier JSON immuable dans coordination/messages/.
Aucune écriture Git, aucun push, aucune connexion réseau.
"""
from __future__ import annotations

import argparse
from datetime import datetime, timezone
import json
import os
from pathlib import Path
import re
import secrets
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[1]
BOX = ROOT / "coordination" / "messages"
CHANNELS = ("team", "agents")
KINDS = ("INFO", "CLAIM", "CONTRACT", "STATUS", "BLOCKER", "HANDOFF", "DECISION_REQUEST", "DECISION")
IDENT = re.compile(r"^[a-z][a-z0-9_-]{1,31}$")
SUSPECT = re.compile(r"-----BEGIN [^-]*PRIVATE KEY-----|\bgh[pousr]_[A-Za-z0-9_]{20,}\b|\bsk-[A-Za-z0-9_-]{20,}\b|(?:api[_-]?key|secret[_-]?key|password)\s*[:=]\s*\S+", re.I)


def git_config(key: str) -> str:
    try:
        r = subprocess.run(["git", "-C", str(ROOT), "config", "--get", key], capture_output=True, text=True, timeout=3)
        return r.stdout.strip() if r.returncode == 0 else ""
    except (OSError, subprocess.TimeoutExpired):
        return ""


def config() -> dict:
    obj = json.loads((ROOT / "team.json").read_text(encoding="utf-8"))
    members = obj.get("members")
    if not isinstance(members, list) or not members or len(members) != len(set(members)):
        raise ValueError("team.json : members doit être une liste de membres uniques")
    if any(not isinstance(m, str) or not IDENT.fullmatch(m) for m in members):
        raise ValueError("team.json : identifiants invalides (minuscules et chiffres seulement)")
    return obj


def identity() -> tuple[str, str]:
    members = config()["members"]
    member = (os.environ.get("HACKATHON_MEMBER") or git_config("hackathon.member")).strip().lower()
    if member not in members:
        raise ValueError("Identité manquante : python3 scripts/setup.py --member membre1 --agent portable")
    agent = (os.environ.get("HACKATHON_AGENT_ID") or git_config("hackathon.agent") or f"{member}/local").strip().lower()
    if "/" not in agent or agent.split("/", 1)[0] != member or not IDENT.fullmatch(agent.split("/", 1)[1]):
        raise ValueError("Agent doit avoir la forme membre/machine")
    return member, agent


def files() -> list[Path]:
    return sorted(BOX.glob("*.json")) if BOX.exists() else []


def read_messages() -> list[dict]:
    out = []
    for p in files():
        try:
            obj = json.loads(p.read_text(encoding="utf-8"))
            if isinstance(obj, dict) and isinstance(obj.get("id"), str) and isinstance(obj.get("text"), str):
                out.append(obj)
        except (UnicodeError, json.JSONDecodeError):
            print(f"AVERTISSEMENT : message illisible : {p.name}", file=sys.stderr)
    return sorted(out, key=lambda m: (str(m.get("time", "")), str(m["id"])))


def cursor_path(agent: str) -> Path:
    name = "hackathon-seen-" + agent.replace("/", "-") + ".json"
    try:
        r = subprocess.run(["git", "-C", str(ROOT), "rev-parse", "--path-format=absolute", "--git-path", name], capture_output=True, text=True, timeout=3)
        if r.returncode == 0:
            return Path(r.stdout.strip())
    except (OSError, subprocess.TimeoutExpired):
        pass
    # Repli non versionné pour un kit décompressé avant git init.
    return ROOT / "local" / name


def load_seen(agent: str) -> set[str]:
    p = cursor_path(agent)
    try:
        content = json.loads(p.read_text(encoding="utf-8"))
        return set(x for x in content if isinstance(x, str)) if isinstance(content, list) else set()
    except (FileNotFoundError, json.JSONDecodeError, UnicodeError):
        return set()


def save_seen(agent: str, seen: set[str]) -> None:
    p = cursor_path(agent)
    p.parent.mkdir(parents=True, exist_ok=True)
    tmp = p.with_name(p.name + ".tmp")
    tmp.write_text(json.dumps(sorted(seen), ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    tmp.replace(p)


def targeted(m: dict, member: str, agent: str) -> bool:
    to = m.get("to", [])
    return (m.get("from_agent") != agent and isinstance(to, list) and any(t in ("all", member, agent) for t in to))


def emit(m: dict) -> str:
    return (f"[{m.get('channel', '?')}/{m.get('type','INFO')}] "
            f"{m.get('from_agent', '?')} → {','.join(m.get('to', []))} "
            f"· {m.get('time', '?')}\n"
            f"Tâche: {m.get('task_id') or '—'} · Branche: {m.get('branch') or '—'} · Fichiers: {','.join(m.get('files', [])) or '—'}\n"
            f"{m['text']}\n"
            f"Ref: {m['id']}")


def send(args: argparse.Namespace) -> None:
    member, agent = identity()
    cfg = config()
    targets = [t.strip().lower() for t in args.to.split(",") if t.strip()]
    if not targets or any(t not in ["all", *cfg["members"]] and not ("/" in t and t.split("/", 1)[0] in cfg["members"] and IDENT.fullmatch(t.split("/", 1)[1])) for t in targets):
        raise ValueError("Destinataire inconnu. Utiliser all, membre ou membre/machine.")
    contents = " ".join((args.text or "", args.task_id or "", args.branch or "", args.files or ""))
    if SUSPECT.search(contents):
        raise ValueError("Texte ressemblant à un secret : envoi refusé. La détection n'est pas exhaustive.")
    if not args.text.strip() or len(args.text) > 5000:
        raise ValueError("Message vide ou trop long (5000 caractères max)")
    selected_files = [x.strip() for x in args.files.split(",") if x.strip()] if args.files else []
    if any(x.startswith("/") or ".." in Path(x).parts or "\\" in x for x in selected_files):
        raise ValueError("Chemin de fichier invalide")
    now = datetime.now(timezone.utc)
    msg_id = now.strftime("%Y%m%dT%H%M%S%fZ") + "-" + secrets.token_hex(8)
    m = {
        "id": msg_id,
        "time": now.isoformat(timespec="seconds"),
        "channel": args.channel,
        "type": args.type,
        "from_member": member,
        "from_agent": agent,
        "to": targets,
        "task_id": args.task_id or None,
        "branch": args.branch or None,
        "files": selected_files,
        "text": args.text.strip(),
    }
    BOX.mkdir(parents=True, exist_ok=True)
    p = BOX / f"{msg_id}.json"
    with p.open("x", encoding="utf-8") as fd:
        json.dump(m, fd, ensure_ascii=False, indent=2)
        fd.write("\n")
    print(f"Message local enregistré : {p.relative_to(ROOT)}")
    print("Non transmis aux autres machines. Partager par Git uniquement avec autorisation humaine.")


def inbox(args: argparse.Namespace, mark: bool = False) -> None:
    member, agent = identity()
    seen = load_seen(agent)
    eligible = [m for m in read_messages() if targeted(m, member, agent) and (args.channel is None or m.get("channel") == args.channel) and m["id"] not in seen]
    for m in eligible:
        print(emit(m) + "\n")
    if mark and eligible:
        save_seen(agent, seen | {m["id"] for m in eligible})
    if not eligible:
        print("Aucun nouveau message.")


def main() -> int:
    p = argparse.ArgumentParser(description=__doc__)
    sub = p.add_subparsers(dest="cmd", required=True)
    send_p = sub.add_parser("send", help="Enregistrer un message local, sans publication Git")
    send_p.add_argument("--to", required=True)
    send_p.add_argument("--text", required=True)
    send_p.add_argument("--channel", choices=CHANNELS, default="team")
    send_p.add_argument("--type", choices=KINDS, default="INFO")
    send_p.add_argument("--task-id", default="")
    send_p.add_argument("--branch", default="")
    send_p.add_argument("--files", default="")
    for command in ("inbox", "deliver", "list"):
        q = sub.add_parser(command)
        q.add_argument("--channel", choices=CHANNELS)
    sub.add_parser("whoami")
    args = p.parse_args()
    try:
        if args.cmd == "send": send(args)
        elif args.cmd == "inbox": inbox(args)
        elif args.cmd == "deliver": inbox(args, mark=True)
        elif args.cmd == "list":
            for m in read_messages():
                if args.channel is None or m.get("channel") == args.channel:
                    print(emit(m) + "\n")
        else:
            member, agent = identity()
            print(f"{member} / {agent}")
        return 0
    except (ValueError, OSError) as e:
        print(f"Erreur : {e}", file=sys.stderr)
        return 2

if __name__ == "__main__":
    sys.exit(main())
