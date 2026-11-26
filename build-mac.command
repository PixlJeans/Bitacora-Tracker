#!/bin/bash
# Double-click on macOS to build the .dmg (needs Xcode Command Line Tools, Node.js and Rust)
cd "$(dirname "$0")"
command -v node >/dev/null || { echo "Node.js is missing: https://nodejs.org"; read -r; exit 1; }
command -v cargo >/dev/null || { echo "Rust is missing: curl https://sh.rustup.rs -sSf | sh"; read -r; exit 1; }
xcode-select -p >/dev/null 2>&1 || xcode-select --install
rustup target add aarch64-apple-darwin x86_64-apple-darwin
npm install && npx tauri icon src-tauri/icons/icon.png && npm run tauri build -- --target universal-apple-darwin \
  && open src-tauri/target/universal-apple-darwin/release/bundle/dmg
read -r -p "Done. Press Enter to close."
