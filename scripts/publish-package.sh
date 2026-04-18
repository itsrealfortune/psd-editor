#!/usr/bin/env bash
set -euo pipefail

if ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  echo "Error: this command must run inside a git repository."
  exit 1
fi

if [[ -n "$(git status --porcelain)" ]]; then
  echo "Error: working tree is not clean. Commit or stash your changes first."
  exit 1
fi

VERSION="$(node -p "require('./package.json').version")"
TAG="v${VERSION}"

if [[ -z "${VERSION}" ]]; then
  echo "Error: package.json version is empty."
  exit 1
fi

git fetch --tags --quiet

if git rev-parse --verify --quiet "refs/tags/${TAG}" >/dev/null; then
  echo "Error: tag ${TAG} already exists."
  exit 1
fi

git tag -a "${TAG}" -m "Release ${TAG}"
git push origin "${TAG}"

echo "Tag ${TAG} pushed."

if command -v gh >/dev/null 2>&1; then
  if gh release view "${TAG}" >/dev/null 2>&1; then
    echo "GitHub release ${TAG} already exists."
  else
    gh release create "${TAG}" --title "${TAG}" --generate-notes
    echo "GitHub release ${TAG} created."
  fi
else
  echo "gh CLI not found; skipping GitHub release creation."
fi

echo "Done. The publish workflow should run from tag ${TAG}."
