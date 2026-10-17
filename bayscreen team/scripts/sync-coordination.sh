#!/usr/bin/env bash
# Fait voyager les messages du kit par la branche « coordination », sans jamais toucher à main.
# Une copie de travail dédiée (dans .git/coordination-wt) suit cette branche ; à chaque tour :
# récupérer, copier les messages dans les deux sens, commiter et pousser les nouveaux.
# Chaque message est un fichier nouveau et immuable : un rebase de ces commits ne peut pas entrer en conflit.
# Usage : bash "bayscreen team/scripts/sync-coordination.sh" [secondes | une-fois]   (Ctrl+C pour arrêter)
set -euo pipefail
KIT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
REPO="$(git -C "$KIT" rev-parse --show-toplevel)"
REL="$(git -C "$KIT" rev-parse --show-prefix)coordination/messages"
LOCAL="$KIT/coordination/messages"
WT="$(git -C "$REPO" rev-parse --path-format=absolute --git-common-dir)/coordination-wt"
BRANCHE=coordination

if [ ! -d "$WT" ]; then
  git -C "$REPO" fetch -q origin "$BRANCHE" 2>/dev/null || true
  if git -C "$REPO" rev-parse -q --verify "refs/heads/$BRANCHE" >/dev/null; then
    git -C "$REPO" worktree add -q "$WT" "$BRANCHE"
  elif git -C "$REPO" rev-parse -q --verify "refs/remotes/origin/$BRANCHE" >/dev/null; then
    git -C "$REPO" worktree add -q -b "$BRANCHE" "$WT" "origin/$BRANCHE"
  else
    git -C "$REPO" worktree add -q -b "$BRANCHE" "$WT" HEAD
  fi
fi

while :; do
  git -C "$WT" pull -q --rebase origin "$BRANCHE" 2>/dev/null || true # absente au premier tour
  mkdir -p "$LOCAL" "$WT/$REL"
  for f in "$WT/$REL"/*.json; do [ -e "$f" ] && [ ! -e "$LOCAL/${f##*/}" ] && cp "$f" "$LOCAL/"; done
  for f in "$LOCAL"/*.json; do [ -e "$f" ] && [ ! -e "$WT/$REL/${f##*/}" ] && cp "$f" "$WT/$REL/"; done
  # -f : le .gitignore du kit ignore les messages pour protéger main ; sur la branche
  # coordination, ils doivent au contraire être suivis — sinon aucun message ne voyage.
  git -C "$WT" add -f -- "$REL"
  if ! git -C "$WT" diff --cached --quiet; then
    git -C "$WT" commit -q -m "coordination : messages d'équipe"
  fi
  if [ -n "$(git -C "$WT" log --oneline "origin/$BRANCHE..$BRANCHE" 2>/dev/null || echo jamais-poussee)" ]; then
    git -C "$WT" push -q -u origin "$BRANCHE" || echo "sync : push refusé, nouvel essai au prochain tour" >&2
  fi
  [ "${1:-60}" = "une-fois" ] && break
  sleep "${1:-60}"
done
