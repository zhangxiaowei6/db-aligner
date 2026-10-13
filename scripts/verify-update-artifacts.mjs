import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
const require = createRequire(import.meta.url);
const { load } = require('js-yaml');
const { listPackage, extractFile } = require('@electron/asar');
const version = JSON.parse(readFileSync('desktop/package.json', 'utf8')).version;
const metadata = load(readFileSync('release/latest.yml', 'utf8'));
assert.equal(metadata.version, version);
const filename = `DBAligner-Setup-${version}.exe`;
assert.equal(metadata.files.length, 1);
assert.equal(decodeURIComponent(metadata.files[0].url), filename);
const installer = readFileSync(`release/${filename}`);
assert.equal(metadata.files[0].sha512, createHash('sha512').update(installer).digest('base64'));
assert.equal(metadata.files[0].size, installer.length);
const config = load(readFileSync('release/win-unpacked/resources/app-update.yml', 'utf8'));
assert.equal(config.provider, 'github');
assert.equal(config.owner, 'zhangxiaowei6');
assert.equal(config.repo, 'db-aligner');
assert(!config.token && !config.requestHeaders, '客户端不能携带发布凭据');
const asar = 'release/win-unpacked/resources/app.asar';
assert(
  listPackage(asar).some((file) =>
    file.replaceAll('\\', '/').endsWith('/node_modules/electron-updater/package.json'),
  ),
);
const packaged = JSON.parse(extractFile(asar, 'package.json').toString());
assert.equal(packaged.version, version);
const inventory = JSON.parse(
  readFileSync('release/win-unpacked/resources/licenses/npm-inventory.json', 'utf8'),
);
assert(inventory.some((entry) => entry.name === 'electron-updater'));
console.log(
  `Verified update metadata, SHA-512, packaged updater and license inventory for ${version}`,
);
