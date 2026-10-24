#!/bin/bash
# Doble clic en macOS para compilar el .dmg (requiere Xcode Command Line Tools, Node.js y Rust)
cd "$(dirname "$0")"
command -v node >/dev/null || { echo "Falta Node.js: https://nodejs.org"; read -r; exit 1; }
command -v cargo >/dev/null || { echo "Falta Rust: curl https://sh.rustup.rs -sSf | sh"; read -r; exit 1; }
xcode-select -p >/dev/null 2>&1 || xcode-select --install
rustup target add aarch64-apple-darwin x86_64-apple-darwin
npm install && npx tauri icon src-tauri/icons/icon.png && npm run tauri build -- --target universal-apple-darwin \
  && open src-tauri/target/universal-apple-darwin/release/bundle/dmg
read -r -p "Listo. Enter para cerrar."
