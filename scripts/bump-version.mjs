// Bumps the version in package.json, src-tauri/tauri.conf.json and src-tauri/Cargo.toml.
// Usage: node scripts/bump-version.mjs          → 1.6.0 → 1.6.1
//        node scripts/bump-version.mjs 1.7.0    → exact version
// Prints the new version (publish-update.bat uses it).
import fs from 'node:fs';
const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
const [major, minor, patch] = pkg.version.split('.').map(Number);
const next = process.argv[2] || `${major}.${minor}.${patch + 1}`;
if (!/^\d+\.\d+\.\d+$/.test(next)) { console.error('Invalid version: ' + next); process.exit(1); }
pkg.version = next;
fs.writeFileSync('package.json', JSON.stringify(pkg, null, 2) + '\n');
const conf = JSON.parse(fs.readFileSync('src-tauri/tauri.conf.json', 'utf8'));
conf.version = next;
fs.writeFileSync('src-tauri/tauri.conf.json', JSON.stringify(conf, null, 2) + '\n');
const cargo = fs.readFileSync('src-tauri/Cargo.toml', 'utf8').replace(/^version = ".*?"/m, `version = "${next}"`);
fs.writeFileSync('src-tauri/Cargo.toml', cargo);
console.log(next);
