import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { isThemeMode, readThemeMode, writeThemeMode } from '../electron/appearance';
const roots: string[] = [];
async function isolated() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'datasync-appearance-'));
  roots.push(root);
  return root;
}
afterEach(async () => {
  for (const root of roots.splice(0)) {
    const target = path.resolve(root);
    if (
      !target.startsWith(path.resolve(os.tmpdir()) + path.sep) ||
      !path.basename(target).startsWith('datasync-appearance-')
    )
      throw new Error('Invalid cleanup target');
    await fs.rm(target, { recursive: true, force: true });
  }
});
describe('Local appearance preferences', () => {
  it('loads the default for an old installation and persists a choice across restarts', async () => {
    const root = await isolated();
    expect(await readThemeMode(root)).toBe('system');
    await writeThemeMode(root, 'dark');
    expect(await readThemeMode(root)).toBe('dark');
    await writeThemeMode(root, 'light');
    expect(await readThemeMode(root)).toBe('light');
    expect(await fs.readdir(root)).toEqual(['ui-preferences.json']);
  });
  it('falls back for damaged or unknown preferences', async () => {
    const root = await isolated();
    await fs.writeFile(path.join(root, 'ui-preferences.json'), '{broken');
    expect(await readThemeMode(root)).toBe('system');
    await fs.writeFile(path.join(root, 'ui-preferences.json'), 'null');
    expect(await readThemeMode(root)).toBe('system');
    await fs.writeFile(
      path.join(root, 'ui-preferences.json'),
      JSON.stringify({ themeMode: 'unknown' }),
    );
    expect(await readThemeMode(root)).toBe('system');
    expect(isThemeMode('unknown')).toBe(false);
  });
});
