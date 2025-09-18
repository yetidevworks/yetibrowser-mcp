#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
ARTIFACT_DIR="$ROOT_DIR/artifacts"

mkdir -p "$ARTIFACT_DIR"

echo "Building Chrome extension..."
npm run build --workspace yetibrowser-extension >/dev/null

echo "Building Firefox extension..."
npm run build --workspace yetibrowser-extension-firefox >/dev/null

chrome_zip="$ARTIFACT_DIR/yetibrowser-extension-chrome.zip"
firefox_zip="$ARTIFACT_DIR/yetibrowser-extension-firefox.zip"

rm -f "$chrome_zip" "$firefox_zip"

( cd "$ROOT_DIR/extensions/chrome/dist" && zip -qr "$chrome_zip" . )
( cd "$ROOT_DIR/extensions/firefox/dist" && zip -qr "$firefox_zip" . )

echo "Artifacts written to $ARTIFACT_DIR"
