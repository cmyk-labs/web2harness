#!/bin/sh
set -eu

REPOSITORY="${WEB2HARNESS_REPOSITORY:-}"
if [ -z "$REPOSITORY" ]; then
  echo "Web2Harness releases are not configured. Set WEB2HARNESS_REPOSITORY to the published GitHub owner/repository before installing." >&2
  exit 1
fi
if ! printf '%s\n' "$REPOSITORY" | grep -Eq '^[A-Za-z0-9][A-Za-z0-9_.-]*/[A-Za-z0-9][A-Za-z0-9_.-]*$'; then
  echo "Invalid GitHub repository: $REPOSITORY" >&2
  exit 1
fi
VERSION="${WEB2HARNESS_VERSION:-2.0.0}"
BIN_DIR="${WEB2HARNESS_BIN_DIR:-$HOME/.local/bin}"
LIB_DIR="${WEB2HARNESS_LIB_DIR:-$HOME/.local/lib/web2harness}"
DOC_DIR="${WEB2HARNESS_DOC_DIR:-$HOME/.local/share/doc/web2harness}"

if [ "$(uname -s)" != "Darwin" ]; then
  echo "The terminal-only installer supports macOS only; use the desktop launcher on Windows or Linux" >&2
  exit 1
fi

case "$(uname -m)" in
  arm64) ARCH="arm64" ;;
  x86_64) ARCH="x64" ;;
  *) echo "Unsupported macOS architecture: $(uname -m)" >&2; exit 1 ;;
esac

ASSET="web2harness-$VERSION-mac-$ARCH.zip"
BASE_URL="https://github.com/$REPOSITORY/releases/download/v$VERSION"
TEMP_DIR="$(mktemp -d "${TMPDIR:-/tmp}/web2harness.XXXXXX")"
STAGE_DIR="$LIB_DIR/.stage-$VERSION-$$"
TARGET_DIR="$LIB_DIR/$VERSION"
BACKUP_DIR="$LIB_DIR/.previous-$VERSION-$$"
trap 'rm -rf "$TEMP_DIR" "$STAGE_DIR"' EXIT HUP INT TERM

curl -fsSL "$BASE_URL/$ASSET" -o "$TEMP_DIR/$ASSET"
curl -fsSL "$BASE_URL/checksums.txt" -o "$TEMP_DIR/checksums.txt"

EXPECTED="$(awk -v asset="$ASSET" '$2 == asset { print $1 }' "$TEMP_DIR/checksums.txt")"
ACTUAL="$(shasum -a 256 "$TEMP_DIR/$ASSET" | awk '{ print $1 }')"
if [ -z "$EXPECTED" ] || [ "$ACTUAL" != "$EXPECTED" ]; then
  echo "SHA-256 verification failed for $ASSET" >&2
  exit 1
fi

ditto -x -k "$TEMP_DIR/$ASSET" "$TEMP_DIR/application"
BUNDLE_RUNTIME="$TEMP_DIR/application/Web2Harness.app/Contents/Resources/runtime"
if [ ! -x "$BUNDLE_RUNTIME/bin/web2harness" ] || [ ! -x "$BUNDLE_RUNTIME/runtime/bun" ]; then
  echo "Desktop archive does not contain a complete CLI runtime" >&2
  exit 1
fi
for DOC in LICENSE LICENSES/Bun-1.4.0.md THIRD_PARTY_NOTICES.txt; do
  if [ ! -s "$BUNDLE_RUNTIME/$DOC" ]; then
    echo "Desktop archive is missing required license material: $DOC" >&2
    exit 1
  fi
done
if [ "$("$BUNDLE_RUNTIME/bin/web2harness" --version)" != "$VERSION" ]; then
  echo "Runtime archive version does not match $VERSION" >&2
  exit 1
fi

mkdir -p "$LIB_DIR" "$BIN_DIR" "$DOC_DIR"
mkdir "$STAGE_DIR"
cp -R "$BUNDLE_RUNTIME/." "$STAGE_DIR/"

if [ -e "$TARGET_DIR" ]; then
  mv "$TARGET_DIR" "$BACKUP_DIR"
fi
if ! mv "$STAGE_DIR" "$TARGET_DIR"; then
  if [ -e "$BACKUP_DIR" ]; then mv "$BACKUP_DIR" "$TARGET_DIR"; fi
  exit 1
fi

ln -sfn "$TARGET_DIR/bin/web2harness" "$BIN_DIR/.web2harness.next"
mv -f "$BIN_DIR/.web2harness.next" "$BIN_DIR/web2harness"
rm -f "$BIN_DIR/web2harness.legacy-standalone"
for DOC in LICENSE LICENSES/Bun-1.4.0.md THIRD_PARTY_NOTICES.txt; do
  install -m 0644 "$TARGET_DIR/$DOC" "$DOC_DIR/$(basename "$DOC")"
done
if [ -e "$BACKUP_DIR" ]; then rm -rf "$BACKUP_DIR"; fi

echo "Installed $TARGET_DIR"
if [ "$#" -gt 0 ]; then
  "$TARGET_DIR/bin/web2harness" setup "$@"
  exit 0
fi
echo "Next: $BIN_DIR/web2harness setup --browser-only --acknowledge-unofficial"
