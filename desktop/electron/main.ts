import { app, BrowserWindow, ipcMain, dialog, safeStorage, shell, nativeTheme } from 'electron';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createInterface } from 'node:readline';
import { existsSync, mkdirSync, promises as fs } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { smoke } from './smoke.js';
import { isThemeMode, readThemeMode, writeThemeMode } from './appearance.js';
import type { Appearance, ThemeMode } from '../src/types.js';
import { connectionTestError } from '../src/connection-validation.js';
import { storagePaths } from './storage-paths.js';
import updater from 'electron-updater';
import { Updates } from './updates.js';
import { UpdateInstallGate } from './update-install.js';

const { autoUpdater } = updater;
const updateGate = new UpdateInstallGate();
let updates: Updates;

const repo = path.resolve(__dirname, '../..');
let win: BrowserWindow, engine: ChildProcessWithoutNullStreams, ready: Promise<void>;
let stopping = false;
let themeMode: ThemeMode = 'system';
let appearanceWrites = Promise.resolve();
let closeApproved = false;
let closeRequested = false;
let rendererReady = false;
function appearance(): Appearance {
  return { themeMode, resolvedTheme: nativeTheme.shouldUseDarkColors ? 'dark' : 'light' };
}
function overlayStyle() {
  return {
    color: nativeTheme.shouldUseDarkColors ? '#000000' : '#f5f5f5',
    symbolColor: nativeTheme.shouldUseDarkColors ? '#d9d9d9' : '#1f1f1f',
    height: 40,
  };
}
function updateAppearance() {
  if (!win || win.isDestroyed()) return;
  win.setBackgroundColor(nativeTheme.shouldUseDarkColors ? '#141414' : '#ffffff');
  if (process.platform === 'win32' || process.platform === 'linux')
    win.setTitleBarOverlay(overlayStyle());
  win.webContents.send('dbaligner:event', {
    event: 'appearance-changed',
    appearance: appearance(),
  });
}
const pending = new Map<
  string,
  { resolve: (v: unknown) => void; reject: (e: Error) => void; timer: NodeJS.Timeout }
>();
const smokeMode = app.commandLine.hasSwitch('smoke-test');
const { root, userData } = storagePaths(app.getPath('appData'), repo, process.env, smokeMode);
mkdirSync(userData, { recursive: true });
app.setPath('userData', userData);
let encrypted: Record<string, string> = {};
const importFiles = new Map<string, string>();
const importPasswords = new Map<string, string>();
const methods = new Set([
  'ping',
  'state.load',
  'entity.save',
  'connectionGroups.save',
  'connectionGroups.delete',
  'connectionGroups.move',
  'connections.move',
  'entity.delete',
  'connections.test',
  'databases.list',
  'tables.list',
  'table.get',
  'imports.parse',
  'sync.compare',
  'sync.compare.start',
  'sync.compare.get',
  'sync.compare.cancel',
  'sync.save',
  'record.get',
  'record.file',
  'record.cancel',
  'record.verify',
  'version.save',
  'rollback.preview',
  'rollback.execute',
  'external.declare',
  'external.verify',
  'schema.export',
  'config.export',
  'config.import',
  'archives.clear',
]);
async function readSecrets() {
  try {
    encrypted = JSON.parse(await fs.readFile(path.join(root, 'credentials.json'), 'utf8'));
  } catch {
    encrypted = {};
  }
}
async function saveSecrets() {
  await fs.mkdir(root, { recursive: true });
  const p = path.join(root, 'credentials.json');
  await fs.writeFile(p + '.tmp', JSON.stringify(encrypted), { mode: 0o600 });
  await fs.rename(p + '.tmp', p);
}
async function secrets() {
  const r: Record<string, string> = {};
  for (const [id, v] of Object.entries(encrypted)) {
    try {
      const decrypted = await safeStorage.decryptStringAsync(Buffer.from(v, 'base64'));
      r[id] = decrypted.result;
      if (decrypted.shouldReEncrypt) {
        encrypted[id] = (await safeStorage.encryptStringAsync(decrypted.result)).toString('base64');
        await saveSecrets();
      }
    } catch {
      /* unusable credentials must be filled again */
    }
  }
  return r;
}
function startEngine() {
  stopping = false;
  const java = app.isPackaged
    ? path.join(process.resourcesPath, 'runtime', 'bin', 'java.exe')
    : path.join(repo, '.tools', 'jdk', 'bin', 'java.exe');
  const location = app.isPackaged
    ? path.join(process.resourcesPath, 'engine')
    : path.join(repo, 'engine', 'target');
  ready = new Promise<void>((resolve, reject) => {
    engine = spawn(
      java,
      [
        '-Dfile.encoding=UTF-8',
        '-cp',
        path.join(location, 'engine.jar') + ';' + path.join(location, 'lib', '*'),
        'io.dbaligner.EngineMain',
      ],
      { env: { ...process.env, DB_ALIGNER_HOME: root }, windowsHide: true },
    );
    const timeout = setTimeout(() => reject(new Error('Java 引擎启动超时，请查看诊断日志')), 60000);
    engine.stderr.on('data', (d: Buffer) => {
      void fs.appendFile(path.join(root, 'engine.log'), d).catch(() => {});
    });
    createInterface({ input: engine.stdout }).on('line', (line: string) => {
      try {
        const n = JSON.parse(line);
        if (n.event === 'ready') {
          updateGate.engineStarted();
          clearTimeout(timeout);
          resolve();
        } else if (n.event) {
          win?.webContents.send('dbaligner:event', n);
        } else if (pending.has(n.id)) {
          const p = pending.get(n.id)!;
          clearTimeout(p.timer);
          pending.delete(n.id);
          if (n.error) p.reject(new Error(n.error.message));
          else p.resolve(n.result);
        }
      } catch {
        /* non-protocol output is not sent to renderer */
      }
    });
    engine.on('error', (e) => {
      clearTimeout(timeout);
      reject(e);
    });
    engine.on('exit', () => {
      clearTimeout(timeout);
      const e = new Error(stopping ? '引擎已关闭' : 'Java 引擎退出，未完成任务需核验');
      reject(e);
      for (const p of pending.values()) {
        clearTimeout(p.timer);
        p.reject(e);
      }
      pending.clear();
      if (!stopping)
        win?.webContents.send('dbaligner:event', { event: 'engine-error', message: e.message });
    });
  });
  ready.catch(() => {});
}
async function call(method: string, params: Record<string, unknown> = {}) {
  await ready;
  const id = randomUUID();
  return new Promise<unknown>((resolve, reject) => {
    const timer = setTimeout(
      () => {
        updateGate.uncertain();
        pending.delete(id);
        reject(new Error('请求超时；执行任务不会因此自动撤销，请查看记录'));
      },
      ['sync.compare.start', 'sync.compare.get', 'sync.compare.cancel'].includes(method)
        ? 15_000
        : 30 * 60 * 1000,
    );
    pending.set(id, { resolve, reject, timer });
    engine.stdin.write(JSON.stringify({ id, method, params }) + '\n');
  });
}
async function stopEngine() {
  stopping = true;
  if (!engine || engine.exitCode !== null) return;
  await new Promise<void>((resolve) => {
    engine.once('exit', () => resolve());
    engine.stdin.end();
    setTimeout(() => {
      if (engine.exitCode === null) engine.kill();
      resolve();
    }, 5000).unref();
  });
}
async function invoke(method: string, params: Record<string, unknown> = {}) {
  if (method.startsWith('updates.')) {
    if (Object.keys(params).length) throw new Error('更新接口不接受自定义参数');
    if (method === 'updates.get') return updates.get();
    if (method === 'updates.check') return updates.check();
    if (method === 'updates.download') return updates.download();
    if (method === 'updates.install') return updates.install();
    throw new Error('不允许的更新接口');
  }
  return updateGate.request(() => invokeBusiness(method, params));
}

async function invokeBusiness(method: string, params: Record<string, unknown> = {}) {
  if (method === 'appearance.get') return appearance();
  if (method === 'appearance.set') {
    const selected = params.themeMode;
    if (!isThemeMode(selected)) throw new Error('无效主题选项');
    const saved = appearanceWrites.then(async () => {
      await writeThemeMode(root, selected);
      themeMode = selected;
      nativeTheme.themeSource = selected;
      updateAppearance();
    });
    appearanceWrites = saved.catch(() => {});
    await saved;
    return appearance();
  }
  if (method === 'files.read') {
    const selected = await dialog.showOpenDialog(win, {
      properties: ['openFile'],
      filters: [{ name: '数据库会话与配置', extensions: ['ncx', 'json', 'xml'] }],
    });
    if (selected.canceled) return null;
    const stat = await fs.stat(selected.filePaths[0]);
    if (stat.size > 5_000_000) throw new Error('文件超过 5 MB');
    const content = await fs.readFile(selected.filePaths[0], 'utf8');
    if (params.intent === 'sessions') {
      if (importFiles.size >= 20) importFiles.delete(importFiles.keys().next().value!);
      const token = randomUUID();
      importFiles.set(token, content);
      return { name: path.basename(selected.filePaths[0]), content: '', token };
    }
    return { name: path.basename(selected.filePaths[0]), content };
  }
  if (method === 'files.chooseDirectory') {
    const d = await dialog.showOpenDialog(win, {
      properties: ['openDirectory', 'createDirectory'],
    });
    return d.canceled ? null : d.filePaths[0];
  }
  if (method === 'files.chooseCertificate') {
    const d = await dialog.showOpenDialog(win, {
      properties: ['openFile'],
      filters: [{ name: '证书', extensions: ['pem', 'crt', 'cer', 'p12', 'pfx'] }],
    });
    return d.canceled ? null : d.filePaths[0];
  }
  if (method === 'files.save') {
    const d = await dialog.showSaveDialog(win, {
      defaultPath: String(params.name || 'export.sql'),
    });
    if (d.canceled || !d.filePath) return null;
    await fs.writeFile(d.filePath, String(params.content || ''), 'utf8');
    return d.filePath;
  }
  if (method === 'files.openArchives') {
    const s = (await call('state.load')) as { settings: { archivePath: string } };
    await shell.openPath(s.settings.archivePath);
    return true;
  }
  if (method === 'record.export') {
    const d = await dialog.showSaveDialog(win, {
      defaultPath: String(params.name || 'db-aligner-scripts.zip'),
      filters: [{ name: '脚本包', extensions: ['zip'] }],
    });
    if (d.canceled || !d.filePath) return null;
    await call(method, { ...params, destination: d.filePath });
    return d.filePath;
  }
  if (method === 'backup.export') {
    const d = await dialog.showSaveDialog(win, {
      defaultPath: 'db-aligner-backup.zip',
      filters: [{ name: '本地备份', extensions: ['zip'] }],
    });
    if (d.canceled || !d.filePath) return null;
    await call(method, { destination: d.filePath });
    return d.filePath;
  }
  if (method === 'backup.import') {
    const d = await dialog.showOpenDialog(win, {
      properties: ['openFile'],
      filters: [{ name: 'DBAligner 备份', extensions: ['zip'] }],
    });
    if (d.canceled) return null;
    await call('backup.export', {
      destination: path.join(root, 'before-restore-' + Date.now() + '.zip'),
    });
    const stage = (await call('backup.prepareRestore', { source: d.filePaths[0] })) as {
      folder: string;
      sqlite: string;
    };
    await stopEngine();
    for (const suffix of ['-wal', '-shm'])
      await fs.rm(path.join(root, 'state.sqlite' + suffix), { force: true });
    await fs.copyFile(stage.sqlite, path.join(root, 'state.sqlite'));
    startEngine();
    await call('backup.finishRestore', { folder: stage.folder });
    return true;
  }
  if (!methods.has(method)) throw new Error('不允许的客户端接口');
  let updatedSecrets: Record<string, string> | undefined;
  if (method === 'imports.parse' && params.fileToken) {
    const content = importFiles.get(String(params.fileToken));
    if (content === undefined) throw new Error('会话文件已过期，请重新选择');
    params = { format: params.format, content };
  }
  if (method === 'entity.save' && params.kind === 'connection') {
    const v = { ...(params.value as Record<string, unknown>) };
    if (!v.id) v.id = randomUUID();
    const id = String(v.id);
    updatedSecrets = { ...encrypted };
    if ((typeof v.password !== 'string' || v.password === '') && v.importCredentialId)
      v.password = importPasswords.get(String(v.importCredentialId)) || '';
    if (typeof v.password === 'string' && v.password !== '') {
      if (!(await safeStorage.isAsyncEncryptionAvailable()))
        throw new Error('系统加密不可用，连接密码未保存');
      updatedSecrets[id] = (await safeStorage.encryptStringAsync(v.password)).toString('base64');
    }
    if (typeof v.certificatePassword === 'string' && v.certificatePassword !== '') {
      updatedSecrets[id + ':certificate'] = (
        await safeStorage.encryptStringAsync(v.certificatePassword)
      ).toString('base64');
    }
    if (v.clearPassword === true) {
      delete updatedSecrets[id];
    }
    delete v.importCredentialId;
    delete v.password;
    delete v.certificatePassword;
    delete v.clearPassword;
    v.hasPassword = !!updatedSecrets[id];
    params = { ...params, value: v };
  }
  const credentials = await secrets();
  if (method === 'connections.test' && params.config) {
    const c = { ...(params.config as Record<string, unknown>) };
    const validation = connectionTestError(c);
    if (validation) throw new Error(validation);
    const original = String(c.id || '');
    c.id = randomUUID();
    credentials[String(c.id)] =
      typeof c.password === 'string' && c.password !== ''
        ? c.password
        : c.importCredentialId
          ? importPasswords.get(String(c.importCredentialId)) || ''
          : credentials[original] || '';
    credentials[String(c.id) + ':certificate'] =
      typeof c.certificatePassword === 'string' && c.certificatePassword !== ''
        ? c.certificatePassword
        : credentials[original + ':certificate'] || '';
    delete c.password;
    delete c.certificatePassword;
    delete c.importCredentialId;
    params = { ...params, config: c };
  }
  const response = await call(method, { ...params, $secrets: credentials });
  if (updatedSecrets) {
    encrypted = updatedSecrets;
    await saveSecrets();
  }
  if (method === 'imports.parse' && Array.isArray(response)) {
    for (const row of response) {
      if (row.password) {
        if (importPasswords.size >= 1000)
          importPasswords.delete(importPasswords.keys().next().value!);
        importPasswords.set(String(row.id), String(row.password));
        row.credentialStatus = '已读取密码，可直接导入';
      }
      delete row.password;
    }
  }
  if (method === 'entity.delete' && params.kind === 'connection') {
    delete encrypted[String(params.id)];
    delete encrypted[String(params.id) + ':certificate'];
    await saveSecrets();
  }
  if (method === 'state.load') {
    const state = response as { connections: Record<string, unknown>[] };
    for (const c of state.connections)
      c.hasPassword = Object.prototype.hasOwnProperty.call(credentials, String(c.id));
  }
  return response;
}
app.whenReady().then(async () => {
  await fs.mkdir(root, { recursive: true });
  themeMode = await readThemeMode(root);
  nativeTheme.themeSource = themeMode;
  await readSecrets();
  startEngine();
  win = new BrowserWindow({
    width: 1488,
    height: 1056,
    minWidth: 1180,
    minHeight: 760,
    show: !smokeMode,
    titleBarStyle: 'hidden',
    titleBarOverlay: overlayStyle(),
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#141414' : '#ffffff',
    title: 'DBAligner',
    icon: app.isPackaged
      ? path.join(process.resourcesPath, 'app-icon.png')
      : path.join(repo, 'desktop/build/icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
    },
  });
  win.setMenuBarVisibility(false);
  const updateEnabled =
    app.isPackaged &&
    !smokeMode &&
    process.env.DB_ALIGNER_DEV !== '1' &&
    existsSync(path.join(path.dirname(process.execPath), 'Uninstall DBAligner.exe'));
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = false;
  autoUpdater.allowPrerelease = false;
  autoUpdater.allowDowngrade = false;
  autoUpdater.logger = null;
  autoUpdater.setFeedURL({
    provider: 'github',
    owner: 'zhangxiaowei6',
    repo: 'db-aligner',
    private: false,
  });
  async function recoverUpdateEngine() {
    if (engine.exitCode !== null) {
      startEngine();
      await ready;
    } else {
      await call('engine.resumeUpdate');
    }
    stopping = false;
    closeApproved = false;
  }
  updates = new Updates(
    autoUpdater,
    app.getVersion(),
    updateEnabled,
    (state) => {
      if (!win.isDestroyed())
        win.webContents.send('dbaligner:event', { event: 'update-state', state });
    },
    () =>
      updateGate.install({
        prepare: async () => {
          const result = (await call('engine.prepareUpdate')) as { prepared?: boolean };
          if (result.prepared !== true) throw new Error('引擎未确认可以更新');
        },
        stop: async () => {
          stopping = true;
          // Do not reuse stopEngine(): update installation must never kill the engine.
          await new Promise<void>((resolve, reject) => {
            engine.once('exit', (code) =>
              code === 0 ? resolve() : reject(new Error('引擎未正常退出，不能安装更新')),
            );
            engine.stdin.end();
          });
        },
        launch: () => {
          closeApproved = true;
          autoUpdater.quitAndInstall(false, true);
        },
        recover: recoverUpdateEngine,
      }),
  );
  autoUpdater.on('error', () => {
    void updateGate.recover(recoverUpdateEngine).catch(() => {
      if (!win.isDestroyed())
        win.webContents.send('dbaligner:event', {
          event: 'engine-error',
          message: '更新失败后无法恢复引擎，请重新启动客户端',
        });
    });
  });
  if (updateEnabled) {
    const check = setTimeout(() => {
      void updates.check();
    }, 10_000);
    check.unref();
    app.once('before-quit', () => clearTimeout(check));
  }
  win.webContents.session.spellCheckerEnabled = false;
  nativeTheme.on('updated', updateAppearance);
  win.on('close', (event) => {
    if (updateGate.installing && !closeApproved) {
      event.preventDefault();
      return;
    }
    if (closeApproved || stopping || smokeMode) return;
    event.preventDefault();
    if (closeRequested) return;
    closeRequested = true;
    if (!rendererReady || win.webContents.isLoadingMainFrame()) {
      closeRequested = false;
      // The renderer cannot answer while loading; use a native confirmation.
      if (
        dialog.showMessageBoxSync(win, {
          type: 'warning',
          title: '关闭客户端',
          message: '客户端正在启动，确认关闭？',
          buttons: ['取消', '关闭'],
          defaultId: 0,
          cancelId: 0,
        }) === 1
      ) {
        closeApproved = true;
        win.close();
      }
      return;
    }
    win.webContents.send('dbaligner:event', { event: 'window-close-request' });
  });
  win.on('closed', () => nativeTheme.removeListener('updated', updateAppearance));
  win.webContents.on('did-start-loading', () => {
    rendererReady = false;
  });
  win.webContents.on('render-process-gone', () => {
    rendererReady = false;
    closeRequested = false;
  });
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (e, url) => {
    if (url.split('#')[0] !== win.webContents.getURL().split('#')[0]) e.preventDefault();
  });
  ipcMain.handle('dbaligner:invoke', (event, method: string, params: Record<string, unknown>) => {
    if (
      event.sender.id !== win.webContents.id ||
      event.senderFrame?.url !== win.webContents.getURL() ||
      event.senderFrame?.parent !== null
    )
      throw new Error('非法调用来源');
    return invoke(method, params);
  });
  ipcMain.on('dbaligner:window', (event, action: string) => {
    if (
      event.sender.id !== win.webContents.id ||
      event.senderFrame?.url !== win.webContents.getURL() ||
      event.senderFrame?.parent !== null
    )
      return;
    if (action === 'renderer-ready') rendererReady = true;
    if (action === 'close-confirmed' && closeRequested) {
      closeApproved = true;
      win.close();
    }
    if (action === 'close-cancelled') closeRequested = false;
    if (action === 'close') win.close();
  });
  if (process.env.DB_ALIGNER_DEV === '1') await win.loadURL('http://127.0.0.1:4173/');
  else await win.loadFile(path.join(__dirname, '../dist/index.html'));
  if (smokeMode) {
    try {
      await smoke(win, root, app.commandLine.getSwitchValue('smoke-fixture'), invoke);
      await stopEngine();
      app.exit(0);
    } catch (e) {
      await fs.writeFile(
        path.join(root, 'smoke-result.json'),
        JSON.stringify({ passed: false, message: e instanceof Error ? e.message : String(e) }),
      );
      await stopEngine();
      app.exit(1);
    }
  }
});
app.on('window-all-closed', () => app.quit());
app.on('before-quit', () => {
  stopping = true;
  engine?.stdin.end();
});
