import { promises as fs } from 'node:fs';
import path from 'node:path';
const root = path.resolve(import.meta.dirname, '..');
const lock = JSON.parse(await fs.readFile(path.join(root, 'package-lock.json'), 'utf8'));
const inventory = [];
for (const [location, entry] of Object.entries(lock.packages)) {
  if (!location.startsWith('node_modules/') || entry.dev || entry.link) continue;
  const folder = path.join(root, location);
  let pkg;
  try {
    pkg = JSON.parse(await fs.readFile(path.join(folder, 'package.json'), 'utf8'));
  } catch {
    continue;
  }
  const output = path.join(root, 'licenses', 'npm', pkg.name.replaceAll('/', '_'));
  await fs.mkdir(output, { recursive: true });
  for (const name of await fs.readdir(folder))
    if (/^(license|licence|notice|copying|copyright)(\.|$)/i.test(name)) {
      const src = path.join(folder, name);
      if ((await fs.stat(src)).isFile()) await fs.copyFile(src, path.join(output, name));
    }
  inventory.push({
    name: pkg.name,
    version: pkg.version,
    license: pkg.license,
    repository: pkg.repository,
    resolved: entry.resolved,
    integrity: entry.integrity,
  });
}
await fs.writeFile(
  path.join(root, 'licenses', 'npm-inventory.json'),
  JSON.stringify(inventory, null, 2) + '\n',
);
