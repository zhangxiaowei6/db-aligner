import { readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import assert from 'node:assert/strict';

const root = JSON.parse(readFileSync('package.json', 'utf8'));
const desktop = JSON.parse(readFileSync('desktop/package.json', 'utf8'));
const config = JSON.parse(readFileSync('desktop/src-tauri/tauri.conf.json', 'utf8'));
const lock = JSON.parse(readFileSync('package-lock.json', 'utf8'));
const cargo = readFileSync('desktop/src-tauri/Cargo.toml', 'utf8');
const cargoLock = readFileSync('desktop/src-tauri/Cargo.lock', 'utf8');
const pom = readFileSync('engine/pom.xml', 'utf8');
const engineVersion = pom.match(
  /<artifactId>db-aligner-engine<\/artifactId>\s*<version>([^<]+)<\/version>/,
)?.[1];
const cargoVersion = cargo.match(/^version = "([^"]+)"/m)?.[1];
const cargoLockVersion = cargoLock.match(/name = "dbaligner"\s+version = "([^"]+)"/)?.[1];
assert.match(desktop.version, /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/);
for (const version of [
  root.version,
  config.version,
  engineVersion,
  cargoVersion,
  cargoLockVersion,
  lock.packages[''].version,
  lock.packages.desktop.version,
])
  assert.equal(version, desktop.version, '根、桌面、Tauri、引擎与锁文件版本必须一致');
assert.equal(config.productName, 'DBAligner');
assert.equal(config.identifier, 'io.dbaligner.client');
assert.equal(config.bundle.createUpdaterArtifacts, true);
assert.equal(config.bundle.targets.length, 1);
assert.equal(config.bundle.targets[0], 'nsis');
assert.equal(config.plugins.updater.endpoints.length, 1);
assert.equal(
  config.plugins.updater.endpoints[0],
  'https://github.com/zhangxiaowei6/db-aligner/releases/latest/download/latest.json',
);
assert(config.plugins.updater.pubkey.length > 80);
assert(!desktop.dependencies?.['electron-updater'] && !desktop.devDependencies?.electron);
const changelog = readFileSync('CHANGELOG.md', 'utf8');
const headings = [...changelog.matchAll(/^## ([^\r\n]+)\r?\n/gm)];
const escapedVersion = desktop.version.replaceAll('.', '\\.');
const versionHeading = new RegExp(`^(?:${escapedVersion}|\\[${escapedVersion}\\])(?:\\s|$)`);
const matchingHeadings = headings.filter((heading) => versionHeading.test(heading[1]));
assert.equal(matchingHeadings.length, 1, 'CHANGELOG.md 必须包含且仅包含一个当前版本记录');
const currentHeading = matchingHeadings[0];
const nextHeading = headings[headings.indexOf(currentHeading) + 1];
const notes = changelog
  .slice(currentHeading.index + currentHeading[0].length, nextHeading?.index ?? changelog.length)
  .trim();
assert(notes.length > 0, '当前版本记录不能为空');
if (process.env.RELEASE_TAG) {
  assert.equal(process.env.RELEASE_TAG, `v${desktop.version}`, '标签与构建版本不一致');
  assert(!currentHeading[1].includes('开发中'), '正式标签不能使用开发中版本记录');
  execFileSync('git', ['merge-base', '--is-ancestor', 'HEAD', 'origin/master']);
}
const args = process.argv.slice(2);
assert(args.length === 0 || (args.length === 2 && args[0] === '--notes-file'), '未知发布检查参数');
if (args.length) {
  const releaseNotes = notes.replace(
    /\]\((docs\/[^)]+)\)/g,
    `](https://github.com/zhangxiaowei6/db-aligner/blob/v${desktop.version}/$1)`,
  );
  writeFileSync(args[1], `# DBAligner ${desktop.version}\n\n${releaseNotes}\n`, 'utf8');
}
console.log(`Release version and changelog verified: ${desktop.version}`);
