#!/usr/bin/env bash
# Run AFTER GitHub username is SortivaApp and gh has user+repo scopes.
set -euo pipefail
gh api user --jq .login | grep -qx SortivaApp
gh repo rename SortivaApp.github.io --yes
cd /workspace/playmobil-app
git remote set-url origin https://github.com/SortivaApp/SortivaApp.github.io.git
git fetch origin
git remote -v
echo "OK: next create LukasLL2002 redirect Pages site."
