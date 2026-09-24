#!/usr/bin/env bash
# Replace the vendored Faceclaw SDK with a packaged candidate.
# Usage: scripts/update-sdk.sh <version> [sdk-independence output dir]
set -euo pipefail
cd "$(dirname "$0")/.."

version="${1:?usage: scripts/update-sdk.sh <version> [output dir]}"
source_dir="${2:-../output/sdk-independence}"
maven="$source_dir/maven/com/faceclaw/sdk/$version"
tarball="$source_dir/npm/faceclaw-motion-$version.tgz"
manifest="$source_dir/candidates/$version/sdk-manifest.json"

for file in "$maven/sdk-$version.aar" "$maven/sdk-$version.pom" "$tarball" "$manifest"; do
  [[ -f "$file" ]] || { echo "missing $file" >&2; exit 1; }
done
for artifact in "$maven/sdk-$version.aar" "$maven/sdk-$version.pom"; do
  echo "$(tr -d '\n' < "$artifact.sha256")  $artifact" | sha256sum --check --quiet
done
npm_sha="$(node -p "require(require('path').resolve(process.argv[1])).npmSha256" "$manifest")"
echo "$npm_sha  $tarball" | sha256sum --check --quiet

rm -rf vendor/maven vendor/npm
mkdir -p vendor/maven/com/faceclaw/sdk vendor/npm
cp -r "$maven" vendor/maven/com/faceclaw/sdk/
cp "$tarball" vendor/npm/

npm pkg set "dependencies.@faceclaw/motion=file:vendor/npm/faceclaw-motion-$version.tgz"
sed -i -E "s/'com\.faceclaw:sdk:[^']+'/'com.faceclaw:sdk:$version'/" App_Resources/Android/app.gradle
echo "Vendored Faceclaw SDK $version. Run npm install and npm run check."
