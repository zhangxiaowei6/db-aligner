import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { ThemeMode } from '../src/types.js';

export function isThemeMode(value: unknown): value is ThemeMode {
  return value === 'light' || value === 'dark' || value === 'system';
}
export async function readThemeMode(root: string): Promise<ThemeMode> {
  try {
    const preferences = JSON.parse(
      await fs.readFile(path.join(root, 'ui-preferences.json'), 'utf8'),
    );
    return isThemeMode(preferences?.themeMode) ? preferences.themeMode : 'system';
  } catch {
    return 'system';
  }
}
export async function writeThemeMode(root: string, themeMode: ThemeMode) {
  const destination = path.join(root, 'ui-preferences.json');
  const temporary = destination + '.tmp';
  await fs.mkdir(root, { recursive: true });
  await fs.writeFile(temporary, JSON.stringify({ themeMode }, null, 2) + '\n', 'utf8');
  await fs.rename(temporary, destination);
}
