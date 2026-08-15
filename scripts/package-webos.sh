#!/usr/bin/env sh
set -eu

PROJECT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
OUTPUT_DIR="$PROJECT_DIR/dist/webos"
SOURCE_DIR="$PROJECT_DIR/platforms/webos"
ASSET_DIR="$PROJECT_DIR/platforms/lg-webos/assets"
STAGING_DIR="$(mktemp -d "${TMPDIR:-/tmp}/gate-webos.XXXXXX")"

cleanup() {
  rm -rf "$STAGING_DIR"
}
trap cleanup EXIT HUP INT TERM

if ! command -v ares-package >/dev/null 2>&1; then
  echo "ares-package nao encontrado. Instale: npm install -g @webos-tools/cli" >&2
  exit 1
fi

if [ ! -f "$ASSET_DIR/icon.png" ] || [ ! -f "$ASSET_DIR/large-icon.png" ] || [ ! -f "$ASSET_DIR/splash.png" ]; then
  echo "Assets webOS obrigatorios nao encontrados em $ASSET_DIR" >&2
  exit 1
fi

mkdir -p "$OUTPUT_DIR"
cp -R "$SOURCE_DIR/." "$STAGING_DIR/"
mkdir -p "$STAGING_DIR/assets"
cp "$ASSET_DIR/icon.png" "$STAGING_DIR/assets/icon.png"
cp "$ASSET_DIR/large-icon.png" "$STAGING_DIR/assets/large-icon.png"
cp "$ASSET_DIR/splash.png" "$STAGING_DIR/assets/splash.png"

ares-package \
  -e "README.md" \
  "$STAGING_DIR" \
  -o "$OUTPUT_DIR"
