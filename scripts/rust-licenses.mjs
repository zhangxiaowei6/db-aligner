import { spawnSync } from 'node:child_process';
import { promises as fs, existsSync } from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const localCargo = path.join(root, '.tools', 'cargo', 'bin', 'cargo.exe');
const env = { ...process.env };
if (existsSync(localCargo)) {
  env.CARGO_HOME = path.join(root, '.tools', 'cargo');
  env.RUSTUP_HOME = path.join(root, '.tools', 'rustup');
  env.RUSTUP_TOOLCHAIN = 'stable-x86_64-pc-windows-msvc';
}
const cargo = spawnSync(
  existsSync(localCargo) ? localCargo : 'cargo',
  [
    'metadata',
    '--locked',
    '--format-version',
    '1',
    '--manifest-path',
    path.join(root, 'desktop', 'src-tauri', 'Cargo.toml'),
  ],
  { cwd: root, env, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
);
if (cargo.status !== 0) throw new Error(cargo.stderr || `cargo metadata failed: ${cargo.status}`);
const metadata = JSON.parse(cargo.stdout);
const outputRoot = path.join(root, 'licenses', 'rust');
await fs.mkdir(outputRoot, { recursive: true });
const active = new Set();
const inventory = [];
for (const pkg of metadata.packages.filter((entry) => entry.source)) {
  const name = `${pkg.name}-${pkg.version}`;
  if (!/^[a-zA-Z0-9_.+-]+$/.test(name)) throw new Error(`Invalid Rust package name: ${name}`);
  active.add(name);
  const folder = path.dirname(pkg.manifest_path);
  const notices = path.join(outputRoot, name);
  await fs.mkdir(notices, { recursive: true });
  for (const filename of await fs.readdir(folder)) {
    if (!/^(license|licence|notice|copying|copyright)(\.|-|$)/i.test(filename)) continue;
    const source = path.join(folder, filename);
    if ((await fs.stat(source)).isFile()) await fs.copyFile(source, path.join(notices, filename));
  }
  if (pkg.license_file) {
    const source = path.resolve(folder, pkg.license_file);
    if (!source.startsWith(folder + path.sep)) throw new Error(`License path escapes ${name}`);
    if ((await fs.stat(source)).isFile()) await fs.copyFile(source, path.join(notices, 'LICENSE-FILE'));
  }
  inventory.push({
    name: pkg.name,
    version: pkg.version,
    license: pkg.license,
    repository: pkg.repository,
    source: pkg.source,
  });
}
for (const name of await fs.readdir(outputRoot)) {
  const target = path.join(outputRoot, name);
  if (!target.startsWith(outputRoot + path.sep)) throw new Error('Invalid Rust notice path');
  if (!active.has(name) && (await fs.stat(target)).isDirectory())
    await fs.rm(target, { recursive: true });
}
inventory.sort((a, b) => a.name.localeCompare(b.name) || a.version.localeCompare(b.version));
await fs.writeFile(
  path.join(root, 'licenses', 'rust-inventory.json'),
  JSON.stringify(inventory, null, 2) + '\n',
);
console.log(`Rust license inventory prepared: ${inventory.length} packages`);
