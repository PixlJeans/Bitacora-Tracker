// Copies the PUBLIC signing key (.pub file) into src-tauri/tauri.conf.json → plugins.updater.pubkey
// Usage: node scripts/set-public-key.mjs <path to the .pub>
import fs from 'node:fs';
const pub = process.argv[2];
if (!pub || !fs.existsSync(pub)) { console.error('Public key not found: ' + pub); process.exit(1); }
const confPath = 'src-tauri/tauri.conf.json';
const conf = JSON.parse(fs.readFileSync(confPath, 'utf8'));
conf.plugins = conf.plugins || {};
conf.plugins.updater = conf.plugins.updater || {};
conf.plugins.updater.pubkey = fs.readFileSync(pub, 'utf8').trim();
fs.writeFileSync(confPath, JSON.stringify(conf, null, 2) + '\n');
console.log('  [OK] Public key saved in ' + confPath);
