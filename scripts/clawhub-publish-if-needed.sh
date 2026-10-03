#!/usr/bin/env bash
# clawhub-publish-if-needed.sh — publish the OpenClaw adapter to ClawHub unless
# that exact version is already there.
#
# ClawHub builds its artifact by copying the package's `files` allowlist; it
# does NOT run npm lifecycle scripts. So this script does by hand what
# `prepack`/`postpack` do for npm: build dist/, resolve `workspace:*` to a real
# range, publish, then restore package.json.
#
# Auth: inside GitHub Actions (id-token: write) the CLI mints a short-lived
# publish token via OIDC, once the package has a trusted publisher configured:
#   clawhub package trusted-publisher set @rohirik/openclaw-ltm \
#     --repository RohiRIK/OpenLtm --workflow-filename publish.yml
# Outside CI it falls back to a token from `clawhub login`.
#
# Usage: clawhub-publish-if-needed.sh   (from the repo root)
set -euo pipefail

CLAWHUB="${CLAWHUB:-npx -y clawhub@0.23.3}"
PKG_DIR="packages/adapter-openclaw"
PKG_JSON="${PKG_DIR}/package.json"
PKG_NAME="$(node -p "require('./${PKG_JSON}').name")"
VERSION="$(node -p "require('./${PKG_JSON}').version")"

if $CLAWHUB package inspect "$PKG_NAME" --version "$VERSION" --json >/dev/null 2>&1; then
  echo "::notice::${PKG_NAME}@${VERSION} is already on ClawHub — skipping"
  exit 0
fi

(cd "$PKG_DIR" && bun run build)

bun run scripts/resolve-workspace-deps.ts rewrite "$PKG_JSON"
trap 'bun run scripts/resolve-workspace-deps.ts restore "$PKG_JSON"' EXIT

echo "Publishing ${PKG_NAME}@${VERSION} to ClawHub"
# Source coordinates are explicit: ClawHub has inferred a stale ref/commit before.
# A version can be registered by a publish that errored server-side, so
# "already exists" means a previous attempt landed — not a failure.
set +e
OUTPUT="$($CLAWHUB package publish "$PKG_DIR" \
  --source-repo RohiRIK/OpenLtm \
  --source-commit "$(git rev-parse HEAD)" \
  --source-ref "${GITHUB_REF_NAME:-main}" \
  --source-path "$PKG_DIR" \
  --wait --wait-timeout 1800 2>&1)"
STATUS=$?
set -e
echo "$OUTPUT"

if [ $STATUS -ne 0 ]; then
  if grep -qi "already exists" <<<"$OUTPUT"; then
    echo "::notice::${PKG_NAME}@${VERSION} was already registered on ClawHub"
    exit 0
  fi
  exit $STATUS
fi
