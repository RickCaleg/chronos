#!/usr/bin/env bash
# Installs the Chronos AppImage for the current user: downloads it (plus its
# icon), writes a .desktop launcher entry, and refreshes the desktop
# database — so it shows up in your app launcher with an icon, same as any
# natively packaged app. Safe to re-run (e.g. to reinstall the current
# version, or to install a different one) — it just overwrites its own files.
#
# Why the AppImage specifically: it's the only Linux build Chronos's
# in-app updater can self-update (see docs/proofhub-integration.md's
# sibling note in CONTRIBUTING.md, and CHANGELOG.md's "Unreleased" entry
# on this) — .deb/.rpm/AUR installs need a new manual install each time.
#
# Usage:
#   ./install.sh              # installs the latest release
#   ./install.sh 0.5.0        # installs a specific version
#
# Remote usage (review before piping to a shell, as always):
#   curl -fsSL https://raw.githubusercontent.com/RickCaleg/chronos/master/packaging/appimage/install.sh | bash

set -euo pipefail

REPO="RickCaleg/chronos"
INSTALL_DIR="$HOME/Applications"
APPIMAGE_PATH="$INSTALL_DIR/Chronos.AppImage"
ICON_PATH="$INSTALL_DIR/chronos-icon.png"
DESKTOP_FILE="$HOME/.local/share/applications/chronos.desktop"

requested_version="${1-}"

if ! command -v curl >/dev/null 2>&1; then
  echo "curl is required." >&2
  exit 1
fi

if [[ -n "$requested_version" ]]; then
  tag="v${requested_version#v}"
  release_url="https://api.github.com/repos/$REPO/releases/tags/$tag"
else
  release_url="https://api.github.com/repos/$REPO/releases/latest"
fi

echo "Looking up the release..."
if ! release_json="$(curl -fsSL "$release_url")"; then
  echo "Couldn't find that release on GitHub (${requested_version:-latest}). Check the version number and try again." >&2
  exit 1
fi

tag="$(printf '%s' "$release_json" | grep -m1 '"tag_name"' | sed -E 's/.*"tag_name": *"([^"]+)".*/\1/')"
appimage_url="$(printf '%s' "$release_json" | grep -o '"browser_download_url": *"[^"]*\.AppImage"' | head -1 | sed -E 's/.*"(https:[^"]+)"/\1/')"

if [[ -z "$tag" || -z "$appimage_url" ]]; then
  echo "Couldn't find an AppImage asset on that release. Is it published (not a draft)?" >&2
  exit 1
fi

echo "Installing Chronos $tag to $INSTALL_DIR..."
mkdir -p "$INSTALL_DIR" "$(dirname "$DESKTOP_FILE")"

curl -fsSL "$appimage_url" -o "$APPIMAGE_PATH"
chmod +x "$APPIMAGE_PATH"

# The icon isn't inside the release's AppImage asset list on its own, so
# it's fetched from the repo at the same tag as the AppImage being
# installed, keeping the two in sync.
curl -fsSL "https://raw.githubusercontent.com/$REPO/$tag/src-tauri/icons/icon.png" -o "$ICON_PATH"

cat >"$DESKTOP_FILE" <<EOF
[Desktop Entry]
Type=Application
Name=Chronos
Comment=A manual, local-first time tracker
Exec=$APPIMAGE_PATH
Icon=$ICON_PATH
Categories=Utility;
Terminal=false
EOF

if command -v update-desktop-database >/dev/null 2>&1; then
  update-desktop-database "$(dirname "$DESKTOP_FILE")" >/dev/null 2>&1 || true
fi

echo "Done. Chronos $tag is installed at $APPIMAGE_PATH and should now show up in your app launcher."
