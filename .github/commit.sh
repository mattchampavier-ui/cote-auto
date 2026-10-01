#!/usr/bin/env bash
# Commit + push des fichiers de données, avec rebase et nouvelles tentatives si un autre
# workflow a poussé entre-temps.
set -euo pipefail
msg="$1"
git config user.name "cote-bot"
git config user.email "cote-bot@users.noreply.github.com"
git add models.json data.json listings.json recaps/ 2>/dev/null || true
if git diff --staged --quiet; then
  echo "Rien à committer."
  exit 0
fi
git commit -m "$msg"
for i in 1 2 3 4; do
  if git push; then exit 0; fi
  sleep $((i * 5))
  git pull --rebase
done
echo "Push impossible après 4 tentatives." >&2
exit 1
