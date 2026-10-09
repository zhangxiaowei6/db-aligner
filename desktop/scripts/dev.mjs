import { spawn } from 'node:child_process';
import electron from 'electron';
const vite = spawn(
  process.execPath,
  ['../node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', '4173', '--strictPort'],
  { stdio: 'inherit' },
);
let child;
const desktopEnv = { ...process.env, DATA_SYNC_DEV: '1' };
delete desktopEnv.ELECTRON_RUN_AS_NODE;
for (let i = 0; i < 60; i++) {
  try {
    if ((await fetch('http://127.0.0.1:4173')).ok) {
      child = spawn(electron, ['.'], {
        stdio: 'inherit',
        env: desktopEnv,
      });
      break;
    }
  } catch {}
  await new Promise((r) => setTimeout(r, 500));
}
if (!child) {
  vite.kill();
  process.exit(1);
}
child.on('exit', () => {
  vite.kill();
  process.exit();
});
process.on('SIGINT', () => {
  child.kill();
  vite.kill();
});
