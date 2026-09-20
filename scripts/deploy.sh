#!/bin/sh
# Builds and publishes dist/ to the gh-pages branch. Used because the local gh token has no `workflow` scope;
# to switch to CI deploys run `gh auth refresh -s workflow`, move scripts/deploy-workflow.yml to
# .github/workflows/deploy.yml, and set Pages to "GitHub Actions".
set -e
cd "$(dirname "$0")/.."
npm test
node scripts/verify-catalog.mjs --offline
npm run build
REMOTE=$(git remote get-url origin)
REV=$(git rev-parse --short HEAD)
cd dist
touch .nojekyll
rm -rf .git
git init -q -b gh-pages
git add -A
git -c user.name="dog-os deploy" -c user.email="noreply@users.noreply.github.com" commit -qm "deploy $REV"
git push -qf "$REMOTE" gh-pages
rm -rf .git
echo "deployed $REV → https://blackdeer.github.io/dog-os/"
