#!/bin/bash
set -e

# Ensure output directory exists
mkdir -p src-tauri/target/release/bundle/dmg

# Clean previous DMG if exists
rm -f src-tauri/target/release/bundle/dmg/sandra-desktop-container_0.1.0_x64.dmg

echo "Building DMG manually with fixed size..."

./scripts/dmg-bundler/bundle_dmg.sh \
  --volname "Sandra Desktop Container" \
  --volicon "src-tauri/icons/icon.icns" \
  --window-size 800 600 \
  --icon-size 100 \
  --icon "sandra-desktop-container.app" 200 190 \
  --hide-extension "sandra-desktop-container.app" \
  --app-drop-link 600 185 \
  --disk-image-size 150 \
  "src-tauri/target/release/bundle/dmg/sandra-desktop-container_0.1.0_x64.dmg" \
  "src-tauri/target/release/bundle/macos/"

echo "DMG build complete."
