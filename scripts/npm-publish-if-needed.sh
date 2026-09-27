#!/usr/bin/env bash
# npm-publish-if-needed.sh — publish a package unless that exact version is
# already on the registry.
#
# A release publishes several packages in sequence. If one fails (a new package
# without trusted publishing configured, a transient registry error), the
# versions published before it are already live. Without this guard a re-run
# dies immediately on "cannot publish over an existing version" and the release
# can never be completed.
#
# Usage: npm-publish-if-needed.sh <package-name>   (run from the package dir)
set -euo pipefail

PKG_DIR="$(pwd)"
PKG_NAME="${1:-}"
if [ -z "$PKG_NAME" ]; then
  echo "usage: $(basename "$0") <package-name>" >&2
  exit 2
fi

VERSION="$(node -p "require('./package.json').version")"

if npm view "${PKG_NAME}@${VERSION}" version >/dev/null 2>&1; then
  echo "::notice::${PKG_NAME}@${VERSION} is already published — skipping"
  exit 0
fi

echo "Publishing ${PKG_NAME}@${VERSION} from ${PKG_DIR}"
npm publish --provenance
