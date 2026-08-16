#!/usr/bin/env sh
set -eu

PROJECT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
SOURCE_DIR="$PROJECT_DIR/platforms/tizen"
OUTPUT_DIR="$PROJECT_DIR/dist/tizen"
ICON_SOURCE="$PROJECT_DIR/platforms/lg-webos/assets/icon.png"
SECURITY_PROFILE="${1:-${TIZEN_SECURITY_PROFILE:-}}"
STAGING_DIR="$(mktemp -d "${TMPDIR:-/tmp}/gate-tizen.XXXXXX")"
BUILD_DIR="$STAGING_DIR/build"
PROJECT_STAGE="$STAGING_DIR/project"
PACKAGE_DIR="$STAGING_DIR/package"

cleanup() {
  rm -rf "$STAGING_DIR"
}
trap cleanup EXIT HUP INT TERM

if ! command -v tizen >/dev/null 2>&1; then
  echo "Tizen CLI nao encontrada. Instale o Tizen Studio com as ferramentas de TV." >&2
  exit 1
fi

if [ -z "$SECURITY_PROFILE" ]; then
  echo "Informe o perfil de assinatura: TIZEN_SECURITY_PROFILE=NomeDoPerfil sh scripts/package-tizen.sh" >&2
  exit 1
fi

if [ ! -f "$ICON_SOURCE" ]; then
  echo "Icone obrigatorio nao encontrado em $ICON_SOURCE" >&2
  exit 1
fi

mkdir -p "$OUTPUT_DIR" "$PROJECT_STAGE" "$BUILD_DIR" "$PACKAGE_DIR"
cp -R "$SOURCE_DIR/." "$PROJECT_STAGE/"
cp "$ICON_SOURCE" "$PROJECT_STAGE/icon.png"

tizen build-web --output "$BUILD_DIR" -- "$PROJECT_STAGE"
tizen package -t wgt -s "$SECURITY_PROFILE" -o "$PACKAGE_DIR" -- "$BUILD_DIR"

PACKAGE_PATH="$(find "$PACKAGE_DIR" -maxdepth 1 -type f -name '*.wgt' -print | sort | tail -n 1)"
if [ -z "$PACKAGE_PATH" ]; then
  echo "A Tizen CLI nao gerou um pacote .wgt." >&2
  exit 1
fi

TARGET_PATH="$OUTPUT_DIR/GATE-TV-Tizen-0.6.2.wgt"
if [ "$PACKAGE_PATH" != "$TARGET_PATH" ]; then
  mv "$PACKAGE_PATH" "$TARGET_PATH"
fi
echo "Pacote criado em $TARGET_PATH"
