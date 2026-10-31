#!/usr/bin/env bash
# Lädt das neueste SVWS-Tools-Release von GitHub und entpackt es in den Zielordner.
# Ein bereits vorhandener Zielordner wird vorher gelöscht und neu angelegt.
#
# Aufruf:
#   ./install-latest.sh                  # Ziel: /opt/app/svws/tools
#   ./install-latest.sh /anderer/ordner

set -euo pipefail

REPO="SVWS-NRW/SVWS-Tools"
TARGET="${1:-/opt/app/svws/tools}"
TARGET="${TARGET%/}"

if [[ -z "$TARGET" || "$TARGET" == "/" ]]; then
  echo "✖ Ungültiger Zielordner: '${1:-}'" >&2
  exit 1
fi

for cmd in curl unzip; do
  command -v "$cmd" >/dev/null || { echo "✖ '$cmd' ist nicht installiert." >&2; exit 1; }
done

TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

echo "▶ Suche neuestes Release von $REPO …"
URL="$(curl -fsSL "https://api.github.com/repos/$REPO/releases/latest" \
  | grep -o '"browser_download_url": *"[^"]*\.zip"' \
  | head -n1 \
  | sed 's/.*"\(https[^"]*\)"/\1/')"

if [[ -z "$URL" ]]; then
  echo "✖ Kein ZIP im neuesten Release gefunden." >&2
  exit 1
fi

echo "▶ Lade $URL"
curl -fsSL -o "$TMP_DIR/release.zip" "$URL"

# Erst nach erfolgreichem Download den Zielordner ersetzen
if [[ -e "$TARGET" ]]; then
  echo "▶ Lösche vorhandenen Ordner $TARGET"
  rm -rf "$TARGET"
fi
mkdir -p "$TARGET"

echo "▶ Entpacke nach $TARGET"
unzip -q "$TMP_DIR/release.zip" -d "$TARGET"

echo "✔ Fertig: $(basename "$URL") → $TARGET"
