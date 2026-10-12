import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { storagePaths } from '../electron/storage-paths';

describe('renamed application storage and isolation', () => {
  const appData = path.resolve('fixture-appdata');
  const repo = path.resolve('fixture-repo');
  const defaultProfile = path.join(appData, 'db-aligner-desktop');

  it('uses a fresh DBAligner profile without selecting the old application directory', () => {
    expect(storagePaths(appData, repo, {}, false)).toEqual({
      root: path.join(defaultProfile, 'data'),
      userData: defaultProfile,
    });
  });

  it('keeps development business data in the repository', () => {
    expect(storagePaths(appData, repo, { DB_ALIGNER_DEV: '1' }, false).root).toBe(
      path.join(repo, '.local-data'),
    );
  });

  it.each([false, true])('isolates an explicit home, smoke=%s', (smokeMode) => {
    const isolatedHome = path.join(repo, 'isolated-home');
    expect(
      storagePaths(
        appData,
        repo,
        { DB_ALIGNER_HOME: isolatedHome, DB_ALIGNER_DEV: '1' },
        smokeMode,
      ),
    ).toEqual({ root: isolatedHome, userData: path.join(isolatedHome, 'electron-profile') });
  });

  it('rejects smoke without an explicit home even in development mode', () => {
    expect(() => storagePaths(appData, repo, { DB_ALIGNER_DEV: '1' }, true)).toThrow(
      'Smoke tests require an isolated DB_ALIGNER_HOME',
    );
  });
});
