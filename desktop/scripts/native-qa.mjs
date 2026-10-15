/** Isolated WebView2 acceptance for a freshly built Tauri portable client. */
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { randomInt, randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright';

const root = path.resolve(import.meta.dirname, '../..');
const version = JSON.parse(
  await fs.readFile(path.join(root, 'desktop', 'package.json'), 'utf8'),
).version;
const releaseArchive = path.join(root, 'release', `DBAligner-${version}-win-x64.zip`);
const bundle = process.env.DB_ALIGNER_QA_APP
  ? undefined
  : await fs.mkdtemp(path.join(os.tmpdir(), 'dbaligner-qa-bundle-'));
if (bundle) execFileSync('tar.exe', ['-xf', releaseArchive, '-C', bundle]);
const executable = process.env.DB_ALIGNER_QA_APP || path.join(bundle, 'DBAligner.exe');
const output = process.env.DB_ALIGNER_QA_OUTPUT_DIR
  ? path.resolve(process.env.DB_ALIGNER_QA_OUTPUT_DIR)
  : path.join(root, 'docs');
const profile = await fs.mkdtemp(
  path.join(os.tmpdir(), `dbaligner-qa-profile-${randomUUID().slice(0, 8)}-`),
);
await fs.mkdir(path.join(profile, 'webview-profile'), { recursive: true });
const report = { client: 'DBAligner', checks: [], errors: [], screenshots: [] };
await fs.mkdir(path.join(output, 'screenshots', 'react-ant-design'), { recursive: true });

async function launch(port) {
  const child = spawn(executable, [], {
    cwd: root,
    env: {
      ...process.env,
      DB_ALIGNER_HOME: profile,
      DB_ALIGNER_DEV: '1',
      WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${port} --remote-allow-origins=*`,
    },
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stderr = '';
  child.stderr.on('data', (chunk) => (stderr += chunk.toString()));
  let browser;
  try {
    let endpoint;
    for (let i = 0; i < 60; i++) {
      if (child.exitCode !== null) throw new Error(`客户端退出 ${child.exitCode}: ${stderr}`);
      try {
        const response = await fetch(`http://127.0.0.1:${port}/json/version`);
        if (response.ok) {
          endpoint = (await response.json()).webSocketDebuggerUrl;
          break;
        }
      } catch {}
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    if (!endpoint) throw new Error(`无法连接 WebView2: ${stderr}`);
    browser = await chromium.connectOverCDP(endpoint);
    let page;
    for (let i = 0; i < 40; i++) {
      page = browser
        .contexts()
        .flatMap((context) => context.pages())
        .find((candidate) => candidate.url().includes('tauri.localhost'));
      if (page) break;
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    if (!page) {
      const urls = browser
        .contexts()
        .flatMap((context) => context.pages().map((item) => item.url()));
      throw new Error(`客户端主页面未出现：${JSON.stringify(urls)}；${stderr}`);
    }
    page.on('pageerror', (error) => report.errors.push(error.message));
    await page.locator('#app').waitFor({ state: 'attached' });
    await page.getByRole('heading', { name: '新建同步', exact: true }).waitFor();
    return { child, browser, page, stderr: () => stderr };
  } catch (error) {
    await browser?.close().catch(() => {});
    child.kill();
    throw error;
  }
}

async function invoke(page, method, params = {}) {
  return page.evaluate(
    ({ method, params }) =>
      window.__TAURI_INTERNALS__.invoke('dbaligner_invoke', { method, params }),
    { method, params },
  );
}

async function screenshot(page, name) {
  const destination = path.join(output, 'screenshots', 'react-ant-design', name);
  await page.screenshot({ path: destination, animations: 'disabled' });
  report.screenshots.push(name);
}

async function close(client) {
  const exit = new Promise((resolve) => client.child.once('exit', resolve));
  await client.page
    .evaluate(() => window.__TAURI_INTERNALS__.invoke('dbaligner_window', { action: 'close' }))
    .catch(() => {});
  const result = await Promise.race([
    exit,
    new Promise((resolve) => setTimeout(() => resolve('timeout'), 15000)),
  ]);
  await client.browser.close().catch(() => {});
  if (result === 'timeout') {
    client.child.kill();
    throw new Error('客户端正常关闭超时');
  }
  assert.equal(result, 0, `客户端关闭状态 ${result}: ${client.stderr()}`);
}

let client;
const firstPort = randomInt(10000, 20000);
try {
  client = await launch(firstPort);
  const { page } = client;
  assert.equal(await page.title(), 'DBAligner');
  assert(
    await page.evaluate(
      () =>
        '__TAURI_INTERNALS__' in window &&
        !('require' in window) &&
        !('process' in window) &&
        !('dbAligner' in window),
    ),
  );
  report.checks.push('本地页面、隔离桥接与原有新建同步布局');
  const ping = await invoke(page, 'ping');
  assert.equal(ping.protocol, 1);
  const state = await invoke(page, 'state.load');
  assert(state.workspaces.length > 0);
  report.checks.push('受限桥接和随包 Java 引擎');
  await assert.rejects(() => invoke(page, 'engine.prepareUpdate'));
  await assert.rejects(() =>
    invoke(page, 'drivers.install', { driverId: 'postgresql', url: 'https://example.invalid' }),
  );
  await assert.rejects(() => invoke(page, 'updates.check', { url: 'https://example.invalid' }));
  report.checks.push('内部方法、驱动地址及更新源不能由页面覆盖');
  const drivers = await invoke(page, 'drivers.list');
  assert(drivers.some((driver) => driver.id === 'mariadb' && driver.status === 'installed'));
  report.checks.push('内置 MySQL 驱动离线可用');
  await page.evaluate(() =>
    window.__TAURI_INTERNALS__.invoke('plugin:window|internal_toggle_maximize', { label: 'main' }),
  );
  await page.waitForTimeout(500);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  assert(await page.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches));
  for (let index = 0; index < 2; index++) {
    await page.getByRole('button', { name: '新建连接' }).first().click();
    const connectionDialog = page.getByRole('dialog', { name: '新建连接' });
    await connectionDialog.waitFor();
    await connectionDialog.getByPlaceholder('请输入连接名称，例如：开发环境').fill('界面响应验证');
    assert.equal(
      await connectionDialog.getByPlaceholder('请输入连接名称，例如：开发环境').inputValue(),
      '界面响应验证',
    );
    await connectionDialog
      .locator('.connection-dialog-footer button')
      .filter({ hasText: /取\s*消/ })
      .click();
    await page.locator('.ant-modal-wrap').waitFor({ state: 'detached', timeout: 3000 });
  }
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  report.checks.push('最大化安装版在减少动态效果下两次弹窗输入和关闭响应');
  const group = await invoke(page, 'connectionGroups.save', { name: '原生验收分组' });
  assert(group.id);
  const removed = await invoke(page, 'connectionGroups.delete', { groupId: group.id });
  assert(removed.ok);
  report.checks.push('Java 保存及删除命令通过原生宿主');
  await screenshot(page, 'native-client-light.png');
  const dark = await invoke(page, 'appearance.set', { themeMode: 'dark' });
  assert.equal(dark.themeMode, 'dark');
  await page.locator('[data-theme="dark"]').waitFor();
  await screenshot(page, 'native-client-dark.png');
  report.checks.push('浅色、深色及外观事件');
  await close(client);
  client = await launch(firstPort + 1);
  await client.page.locator('[data-theme="dark"]').waitFor();
  const persisted = await invoke(client.page, 'state.load');
  assert(!persisted.connectionGroups.some((item) => item.id === group.id));
  report.checks.push('主题偏好和业务状态重启后保留');
  await close(client);
  client = undefined;
  assert.deepEqual(report.errors, []);
  report.passed = true;
  console.log(JSON.stringify(report, null, 2));
} catch (error) {
  report.passed = false;
  report.errors.push(String(error));
  throw error;
} finally {
  if (client) {
    client.child.kill();
    await client.browser.close().catch(() => {});
  }
  await fs.writeFile(
    path.join(output, 'native-client-ui-qa.json'),
    JSON.stringify(report, null, 2),
  );
  for (const folder of [bundle, profile]) {
    if (!folder) continue;
    const resolved = path.resolve(folder);
    if (
      !resolved.startsWith(path.resolve(os.tmpdir()) + path.sep) ||
      !path.basename(resolved).startsWith('dbaligner-qa-')
    ) {
      throw new Error(`验收临时目录不在预期范围：${resolved}`);
    }
    await fs.rm(resolved, { recursive: true, force: true }).catch(() => {});
  }
}
