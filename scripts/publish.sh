#!/usr/bin/env bash
# Creates the private GitHub repo "point-xfer" from this folder and pushes main.
# Requires the GitHub CLI (https://cli.github.com) and `gh auth login` once.
set -euo pipefail
cd "$(dirname "$0")/.."
command -v gh >/dev/null || { echo "Install the GitHub CLI first: https://cli.github.com"; exit 1; }
gh auth status >/dev/null 2>&1 || gh auth login
gh repo create point-xfer --private --source=. --remote=origin --push \
  --description "Mobile-first map of credit card point transfer partners with auto-tracked transfer bonuses"
echo
echo "Pushed. Next: Settings → Pages → Source: GitHub Actions (private Pages needs a paid plan),"
echo "then Actions → Track transfer bonuses → Run workflow."
