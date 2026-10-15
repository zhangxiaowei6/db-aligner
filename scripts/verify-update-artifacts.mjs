import { readFileSync, statSync } from 'node:fs';
import assert from 'node:assert/strict';

const config = JSON.parse(readFileSync('desktop/src-tauri/tauri.conf.json', 'utf8'));
const version = JSON.parse(readFileSync('desktop/package.json', 'utf8')).version;
const filename = `DBAligner-Setup-${version}-win-x64.exe`;
const signature = readFileSync(`release/${filename}.sig`, 'utf8').trim();
const latest = JSON.parse(readFileSync('release/latest.json', 'utf8'));
const platform = latest.platforms['windows-x86_64'];
assert.equal(latest.version, version);
assert.equal(platform.signature, signature);
assert.equal(
  platform.url,
  `https://github.com/zhangxiaowei6/db-aligner/releases/latest/download/${filename}`,
);
assert(config.plugins.updater.pubkey.length > 80);
assert(statSync(`release/${filename}`).size > 10_000_000);
assert.match(signature, /^[A-Za-z0-9+/=]+$/);
console.log(`Verified signed Tauri update metadata and installer for ${version}`);
