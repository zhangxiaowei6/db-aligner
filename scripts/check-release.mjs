import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import assert from 'node:assert/strict';
const root = JSON.parse(readFileSync('package.json', 'utf8'));
const desktop = JSON.parse(readFileSync('desktop/package.json', 'utf8'));
const lock = JSON.parse(readFileSync('package-lock.json', 'utf8'));
const pom = readFileSync('engine/pom.xml', 'utf8');
const engineVersion = pom.match(
  /<artifactId>db-aligner-engine<\/artifactId>\s*<version>([^<]+)<\/version>/,
)?.[1];
assert.match(desktop.version, /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/);
for (const version of [
  root.version,
  engineVersion,
  lock.packages[''].version,
  lock.packages.desktop.version,
])
  assert.equal(version, desktop.version, '根、桌面、引擎与锁文件版本必须一致');
assert.equal(lock.packages['node_modules/electron-builder'].version, '26.15.3');
assert.equal(desktop.build.publish.provider, 'github');
assert.equal(desktop.build.publish.owner, 'zhangxiaowei6');
assert.equal(desktop.build.publish.repo, 'db-aligner');
if (process.env.RELEASE_TAG) {
  assert.equal(process.env.RELEASE_TAG, `v${desktop.version}`, '标签与构建版本不一致');
  execFileSync('git', ['merge-base', '--is-ancestor', 'HEAD', 'origin/master']);
}
console.log(`Release version verified: ${desktop.version}`);
