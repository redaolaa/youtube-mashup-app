#!/bin/bash
# Create the GitHub repo and push this project (run after: gh auth login)
set -e
cd "$(dirname "$0")"
REPO_NAME="${1:-youtube-mashup-app}"
echo "Creating GitHub repo: $REPO_NAME"
gh repo create "$REPO_NAME" --public --source=. --remote=origin --push
echo "Done. Repo: https://github.com/$(gh repo view --json owner,name -q '.owner.login + "/" + .name')"
