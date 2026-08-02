#!/usr/bin/env sh
set -eu

PROJECT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
OUTPUT_DIR="$PROJECT_DIR/dist/webos"

mkdir -p "$OUTPUT_DIR"
ares-package \
  -e "README.md" \
  -e "STORE_SUBMISSION.md" \
  -e "assets/store-icon-400.png" \
  -e "assets/splash.svg" \
  "$PROJECT_DIR/platforms/lg-webos" \
  -o "$OUTPUT_DIR"
