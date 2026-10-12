import path from 'node:path';

/** Keep business data and Chromium's profile under the selected application identity. */
export function storagePaths(
  appData: string,
  repo: string,
  env: { DB_ALIGNER_HOME?: string; DB_ALIGNER_DEV?: string },
  smokeMode: boolean,
) {
  if (smokeMode && !env.DB_ALIGNER_HOME)
    throw new Error('Smoke tests require an isolated DB_ALIGNER_HOME');
  const defaultProfile = path.join(appData, 'db-aligner-desktop');
  const root =
    env.DB_ALIGNER_HOME ||
    (env.DB_ALIGNER_DEV === '1'
      ? path.join(repo, '.local-data')
      : path.join(defaultProfile, 'data'));
  return {
    root,
    // Explicit homes also isolate Chromium's profile during native acceptance.
    userData: env.DB_ALIGNER_HOME ? path.join(root, 'electron-profile') : defaultProfile,
  };
}
