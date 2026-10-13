import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';

const repo = path.resolve(import.meta.dirname, '..');
const require = createRequire(path.join(repo, 'desktop', 'package.json'));
const electron = path.dirname(require.resolve('electron/package.json'));
const environment = {
  ...process.env,
  ELECTRON_INSTALL_PLATFORM: 'win32',
  ELECTRON_INSTALL_ARCH: 'x64',
  electron_config_cache: path.join(repo, '.tools', 'electron-cache'),
};
delete environment.ELECTRON_SKIP_BINARY_DOWNLOAD;
// Explicitly prepare the runtime: some Electron package versions have no npm postinstall hook.
execFileSync(process.execPath, [path.join(electron, 'install.js')], {
  env: environment,
  stdio: 'inherit',
});
if (!existsSync(path.join(electron, 'dist', 'electron.exe')))
  throw new Error('Windows x64 Electron runtime was not installed');
console.log('Windows x64 Electron runtime is ready.');
