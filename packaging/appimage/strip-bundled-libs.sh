#!/usr/bin/env bash
# Strips a handful of over-bundled host libraries out of a Tauri-built
# AppImage, then repackages it in place at the same path.
#
# Why: linuxdeploy's own excludelist doesn't cover these (the community
# pkg2appimage excludelist does, with per-library rationale —
# https://github.com/AppImage/pkg2appimage/blob/master/excludelist), so they
# get bundled alongside the newer host toolchain's build of them. On a
# system with a newer Mesa than whatever built these bundled copies, the
# mismatch surfaces as WebKitWebProcess crashing with "Could not create
# default EGL display: EGL_BAD_PARAMETER" the moment the window tries to
# render — the window itself stays open, but blank. See CHANGELOG.md.
#
# Verified by hand: extracting the real published v0.5.0 AppImage, removing
# exactly these 4 files, and repackaging fixed the crash on the machine that
# originally reported it.
#
# Usage: strip-bundled-libs.sh <path-to.AppImage>
# Requires linuxdeploy-plugin-appimage.AppImage to already be cached at
# ~/.cache/tauri/ (true right after any `tauri build` that bundles an
# AppImage runs on this machine — release.yml relies on that ordering).

set -euo pipefail

APPIMAGE="$(realpath "$1")"
PLUGIN="$HOME/.cache/tauri/linuxdeploy-plugin-appimage.AppImage"

if [[ ! -f "$APPIMAGE" ]]; then
  echo "No such file: $APPIMAGE" >&2
  exit 1
fi
if [[ ! -f "$PLUGIN" ]]; then
  echo "$PLUGIN not found — run a Tauri AppImage build on this machine first." >&2
  exit 1
fi
chmod +x "$PLUGIN"

LIBS_TO_STRIP=(
  libwayland-client.so.0
  libxcb-render.so.0
  libxcb-shm.so.0
  libxkbcommon.so.0
)

workdir="$(mktemp -d)"
trap 'rm -rf "$workdir"' EXIT

cd "$workdir"
APPIMAGE_EXTRACT_AND_RUN=1 "$APPIMAGE" --appimage-extract >/dev/null

for lib in "${LIBS_TO_STRIP[@]}"; do
  rm -f "squashfs-root/usr/lib/$lib"
done

mkdir -p out
(cd out && APPIMAGE_EXTRACT_AND_RUN=1 "$PLUGIN" --appdir ../squashfs-root >/dev/null)

built="$(find out -maxdepth 1 -name '*.AppImage' | head -1)"
if [[ -z "$built" ]]; then
  echo "Repackaging didn't produce an AppImage." >&2
  exit 1
fi

mv "$built" "$APPIMAGE"
chmod +x "$APPIMAGE"
echo "Fixed $APPIMAGE (stripped: ${LIBS_TO_STRIP[*]})"
