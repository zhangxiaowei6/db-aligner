/** UI acceptance against the production bundle and an isolated native client.
 * Requires npm run build. Uses a local Chrome/Edge installation (or Playwright's browser).
 * Never reads the normal client's database or connects to a database server. */
import { chromium, _electron as electron } from 'playwright';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { promises as fs, existsSync } from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
const require = createRequire(import.meta.url);
const desktop = path.resolve(import.meta.dirname, '..');
const repo = path.resolve(desktop, '..');
const screenshots = path.join(repo, 'docs', 'screenshots', 'react-ant-design');
const report = { browser: [], desktop: [], errors: [] };
await fs.mkdir(screenshots, { recursive: true });
const native = process.argv.includes('--desktop');
const executablePath =
  process.env.DATA_SYNC_QA_BROWSER ||
  [
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  ].find(existsSync);
function observe(page) {
  page.on('pageerror', (e) => report.errors.push(e.message));
  page.on('console', (msg) => {
    if (msg.type() === 'error') report.errors.push(msg.text());
  });
}
async function footerCheck(page, label) {
  await page.locator('.page-scroll').evaluate((el) => {
    el.scrollTop = el.scrollHeight;
  });
  const bounds = await page.evaluate(() => {
    const scroll = document.querySelector('.page-scroll').getBoundingClientRect();
    const footer = document.querySelector('#page-footer').getBoundingClientRect();
    const control = document
      .querySelector('#page-footer button:last-child')
      .getBoundingClientRect();
    const hit = document.elementFromPoint(
      control.x + control.width / 2,
      control.y + control.height / 2,
    );
    return {
      scrollBottom: scroll.bottom,
      footerTop: footer.top,
      footerBottom: footer.bottom,
      windowHeight: innerHeight,
      hitFooter: !!hit?.closest('#page-footer'),
    };
  });
  assert(bounds.scrollBottom <= bounds.footerTop + 1, `${label}: content overlaps footer`);
  assert(bounds.footerBottom <= bounds.windowHeight + 1, `${label}: footer outside viewport`);
  assert(bounds.hitFooter, `${label}: footer controls obscured`);
  report.browser.push({ check: label, ...bounds });
}
async function shot(page, name) {
  await page.screenshot({ path: path.join(screenshots, name + '.png'), animations: 'disabled' });
}
async function browserQA() {
  const log = await fs.open(path.join(repo, '.local-data', 'ui-qa-preview.log'), 'w');
  const vite = spawn(
    process.execPath,
    [
      path.join(path.dirname(require.resolve('vite/package.json')), 'bin', 'vite.js'),
      'preview',
      '--host',
      '127.0.0.1',
      '--port',
      '4183',
      '--strictPort',
    ],
    { cwd: desktop, windowsHide: true, stdio: ['ignore', log.fd, log.fd] },
  );
  let browser;
  try {
    for (let attempt = 0; attempt < 60; attempt++) {
      try {
        if ((await fetch('http://127.0.0.1:4183')).ok) break;
      } catch {}
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    browser = await chromium.launch({ headless: true, executablePath });
    for (const mode of ['light', 'dark']) {
      const context = await browser.newContext({
        viewport: { width: 1488, height: 1056 },
        colorScheme: mode,
      });
      const page = await context.newPage();
      observe(page);
      await page.goto('http://127.0.0.1:4183/?preview=1');
      await page.getByRole('heading', { level: 1, name: '差异预览', exact: true }).waitFor();
      await page.getByText('remark', { exact: true }).first().waitFor();
      await shot(page, `diff-${mode}`);
      const first = page.getByRole('checkbox', { name: '选择 remark', exact: true });
      await first.uncheck();
      assert(
        (await page.locator('.ant-checkbox-indeterminate').count()) > 0,
        'group half-selection is missing',
      );
      await first.check();
      await page.getByRole('tab', { name: '基础数据', exact: true }).click();
      await page.getByText('字段值对比', { exact: true }).waitFor();
      assert(
        (await page.locator('.diff-inspector').innerText()).includes('ORDER_STATUS'),
        'data inspector has stale structure details',
      );
      await page.getByRole('menuitem', { name: /设置/ }).click();
      await page.getByRole('heading', { level: 1, name: '设置', exact: true }).waitFor();
      await page.getByText(mode === 'dark' ? '深色' : '浅色', { exact: true }).click();
      await page.locator(`[data-theme="${mode}"]`).waitFor();
      const input = page.getByRole('spinbutton', { name: '最大并行目标库' });
      await input.fill('7');
      await input.blur();
      assert.equal(await input.inputValue(), '7');
      await footerCheck(page, `settings-${mode}`);
      await page.locator('.page-scroll').evaluate((el) => {
        el.scrollTop = 0;
      });
      await shot(page, `settings-${mode}`);
      await page.getByRole('button', { name: '管理已归档资料', exact: true }).click();
      await page.getByRole('dialog', { name: '管理归档资料', exact: true }).waitFor();
      const drawer = page.getByRole('dialog', { name: '管理归档资料', exact: true });
      await page.waitForFunction(() => {
        const el = document.querySelector('[role="dialog"]');
        const box = el?.getBoundingClientRect();
        return (
          box &&
          box.width > 0 &&
          box.right <= innerWidth + 1 &&
          el.contains(document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2))
        );
      });
      const overlay = await drawer.evaluate((el) => {
        const box = el.getBoundingClientRect();
        const hit = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);
        return {
          onTop: el.contains(hit),
          bg: getComputedStyle(el).backgroundColor,
          rect: { x: box.x, y: box.y, width: box.width, height: box.height },
        };
      });
      await shot(page, `drawer-${mode}`);
      assert(overlay.onTop, `${mode}: drawer under page`);
      report.browser.push({ check: `drawer-${mode}`, ...overlay });
      await page.getByRole('button', { name: /Close|关闭/ }).click();
      await drawer.waitFor({ state: 'hidden' });
      await page.getByRole('button', { name: '导入连接', exact: true }).click();
      await page.getByRole('textbox', { name: '会话内容' }).fill('fictional QA sample');
      await page.getByRole('button', { name: '解析会话', exact: true }).click();
      await page.getByRole('checkbox', { name: '选择 示例连接 01', exact: true }).waitFor();
      assert(
        await page.getByRole('checkbox', { name: '选择 示例连接 05', exact: true }).isDisabled(),
        'unsupported row must be disabled',
      );
      await page.getByRole('checkbox', { name: '选择 示例连接 01', exact: true }).uncheck();
      assert(
        (await page.locator('.ant-checkbox-indeterminate').count()) > 0,
        'import select-all half-selection missing',
      );
      await page.locator('.ant-pagination-next button').click();
      const nextRow = page.getByRole('checkbox', { name: '选择 示例连接 21', exact: true });
      await nextRow.waitFor();
      assert(await nextRow.isChecked());
      await nextRow.uncheck();
      await page.locator('.ant-pagination-prev button').click();
      assert(
        !(await page.getByRole('checkbox', { name: '选择 示例连接 01', exact: true }).isChecked()),
      );
      report.browser.push({ check: `import-pagination-selection-${mode}`, passed: true });
      await footerCheck(page, `import-${mode}-bottom`);
      await shot(page, `import-bottom-${mode}`);
      await page.locator('.page-scroll').evaluate((el) => {
        el.scrollTop = 0;
      });
      await shot(page, `import-${mode}`);
      // Check the exact layering issue at the minimum window and across common scaling factors.
      for (const [width, height] of [
        [1180, 760],
        [2048, 1114],
        [1707, 928],
        [2560, 1392],
      ]) {
        await page.setViewportSize({ width, height });
        await footerCheck(page, `import-${mode}-${width}x${height}`);
      }
      await context.close();
    }
    // Device pixel ratio plus the CSS viewport represents a 2560x1392 display at 100/125/150%.
    for (const factor of [1, 1.25, 1.5]) {
      const context = await browser.newContext({
        deviceScaleFactor: factor,
        viewport: { width: Math.round(2560 / factor), height: Math.round(1392 / factor) },
        colorScheme: 'light',
      });
      const page = await context.newPage();
      observe(page);
      await page.goto('http://127.0.0.1:4183/?preview=1&page=import');
      await page.getByRole('textbox', { name: '会话内容' }).fill('fictional QA sample');
      await page.getByRole('button', { name: '解析会话', exact: true }).click();
      await page.getByRole('checkbox', { name: '选择 示例连接 01', exact: true }).waitFor();
      await footerCheck(page, `import-dpr-${factor}`);
      await context.close();
    }
    for (const workflowTheme of ['light', 'dark']) {
      const reportStart = report.browser.length;
      const context = await browser.newContext({
        viewport: { width: 1488, height: 1056 },
        colorScheme: workflowTheme,
        permissions: ['clipboard-read', 'clipboard-write'],
      });
      const page = await context.newPage();
      observe(page);
      await page.goto('http://127.0.0.1:4183/?preview=1');
      await page.getByRole('heading', { level: 1, name: '差异预览', exact: true }).waitFor();
      async function expand(label) {
        await page.locator('.ant-tree-treenode-motion').waitFor({ state: 'detached' });
        const node = page
          .getByRole('treeitem')
          .filter({ has: page.getByText(label, { exact: true }) });
        await node.locator('.ant-tree-switcher').click();
        await page.waitForFunction(
          (label) =>
            [...document.querySelectorAll('[role="treeitem"]')].some(
              (el) =>
                el.querySelector('.tree-label')?.textContent === label &&
                el.getAttribute('aria-expanded') === 'true',
            ),
          label,
        );
        await page.locator('.ant-tree-treenode-motion').waitFor({ state: 'detached' });
      }
      await expand('测试环境');
      await expand('测试服务器');
      await expand('shop_test');
      await page.locator('.tree-label').getByText('sys_dict', { exact: true }).dblclick();
      await page.getByRole('heading', { level: 1, name: 'sys_dict', exact: true }).waitFor();
      for (const label of ['索引（2）', '外键（0）', '建表 SQL', '字段']) {
        await page.getByRole('tab', { name: label, exact: true }).click();
      }
      report.browser.push({ check: 'lazy-tree-table-tabs', passed: true });
      await page.getByRole('button', { name: '导出表结构', exact: true }).click();
      await page.getByRole('heading', { level: 1, name: '导出表结构', exact: true }).waitFor();
      await page.getByText('仅 CREATE TABLE', { exact: true }).waitFor();
      assert(
        !(await page
          .locator('.sql-view')
          .innerText()
          .then((text) => text.includes('DROP TABLE'))),
        'default export includes DROP',
      );
      await page.getByText('包含 DROP TABLE', { exact: true }).click();
      await page.waitForFunction(() =>
        document.querySelector('.sql-view').innerText.includes('DROP TABLE'),
      );
      report.browser.push({ check: 'schema-export-default-and-drop-preview', passed: true });
      await page.getByRole('menuitem', { name: /同步模板/ }).click();
      await page.getByRole('heading', { level: 1, name: '同步模板', exact: true }).waitFor();
      const templateName = page.getByRole('textbox', { name: '模板名称' });
      await templateName.fill('QA 模板草稿');
      await page.getByRole('button', { name: '取消修改', exact: true }).click();
      assert.equal(await templateName.inputValue(), '基础字典与菜单');
      await page.getByRole('button', { name: '应用模板', exact: true }).click();
      await page.getByRole('heading', { level: 1, name: '新建同步', exact: true }).waitFor();
      assert.equal(
        await page.getByRole('textbox', { name: 'sys_dict 匹配键' }).inputValue(),
        'code',
      );
      await page.getByRole('button', { name: '开始比较', exact: true }).click();
      await page.getByRole('heading', { level: 1, name: '差异预览', exact: true }).waitFor();
      await page.getByRole('button', { name: '复制 SQL', exact: true }).click();
      assert((await page.evaluate(() => navigator.clipboard.readText())).includes('ALTER TABLE'));
      await page.getByRole('button', { name: '仅保存记录', exact: true }).click();
      await page.getByRole('heading', { level: 1, name: '同步记录详情', exact: true }).waitFor();
      for (const label of ['执行结果', '外部执行校验', '脚本与恢复资料']) {
        await page.getByRole('tab', { name: label, exact: true }).click();
      }
      await page.getByRole('button', { name: '登记外部执行', exact: true }).click();
      const external = page.getByRole('dialog', { name: '登记外部执行', exact: true });
      await external.waitFor();
      assert((await external.getByRole('checkbox').count()) > 0);
      await external.getByRole('button', { name: /取\s*消/ }).click();
      await external.waitFor({ state: 'hidden' });
      report.browser.push({
        check: 'template-cancel-apply-compare-copy-save-record',
        passed: true,
      });
      await page.getByRole('menuitem', { name: /同步历史/ }).click();
      await page.getByRole('heading', { level: 1, name: '同步历史', exact: true }).waitFor();
      await page.locator('thead').getByRole('checkbox').check();
      await page.getByRole('button', { name: '标记版本', exact: true }).click();
      await page.getByRole('dialog', { name: '标记版本', exact: true }).waitFor();
      await page.getByRole('textbox', { name: '版本号' }).fill('v-qa');
      await page.getByRole('textbox', { name: '版本说明' }).fill('页面验收');
      await page.getByRole('button', { name: '确认标记', exact: true }).click();
      await page.getByRole('dialog').waitFor({ state: 'hidden' });
      await page.getByRole('tab', { name: '版本', exact: true }).click();
      await page.getByRole('button', { name: /v-qa/ }).click();
      await page.getByRole('heading', { name: 'v-qa', exact: true }).waitFor();
      await page.getByRole('button', { name: '编辑说明', exact: true }).click();
      await page.getByRole('textbox', { name: '版本说明' }).fill('更新说明');
      await page.getByRole('button', { name: /保\s*存/ }).click();
      await page.getByRole('dialog').waitFor({ state: 'hidden' });
      report.browser.push({ check: 'history-selection-version-drawer-and-edit', passed: true });
      await page.getByRole('button', { name: '添加连接', exact: true }).click();
      await page.getByLabel('连接名称', { exact: true }).fill('QA 连接');
      await page.getByRole('textbox', { name: '用户名' }).fill('qa_user');
      await page.getByRole('button', { name: '保存连接', exact: true }).click();
      await page.getByRole('cell', { name: 'QA 连接', exact: true }).waitFor();
      await page.getByLabel('连接名称', { exact: true }).fill('未保存');
      await page.getByRole('button', { name: '取消修改', exact: true }).click();
      assert.equal(await page.getByLabel('连接名称', { exact: true }).inputValue(), 'QA 连接');
      await page
        .getByRole('checkbox', { name: '启用 SSL，验证证书与服务器名称', exact: true })
        .check();
      await page.getByText('客户端证书（PKCS#12，可选）', { exact: true }).waitFor();
      await page.getByRole('button', { name: '管理工作区', exact: true }).click();
      await page.getByRole('textbox', { name: '工作区名称' }).fill('QA 项目');
      await page.getByRole('button', { name: '保存工作区', exact: true }).click();
      await page.getByRole('cell', { name: 'QA 项目', exact: true }).waitFor();
      report.browser.push({
        check: 'connection-draft-save-cancel-ssl-workspace-save',
        passed: true,
      });
      await page.getByRole('menuitem', { name: /同步历史/ }).click();
      await page.getByRole('tab', { name: '同步记录', exact: true }).click();
      await page.getByRole('button', { name: 'PREVIEW-EXECUTED-007', exact: true }).click();
      await page.getByRole('heading', { name: '同步记录详情', exact: true }).waitFor();
      await page.getByRole('button', { name: '回滚预览', exact: true }).click();
      await page.getByRole('heading', { name: '回滚预览', exact: true }).waitFor();
      const rollback = page.getByRole('checkbox', { name: '恢复 ORDER_STATUS', exact: true });
      assert(await rollback.nth(0).isChecked());
      assert(await rollback.nth(1).isDisabled());
      await rollback.nth(0).uncheck();
      assert(await page.getByRole('button', { name: '执行所选回滚', exact: true }).isDisabled());
      await rollback.nth(0).check();
      await page.getByRole('button', { name: '执行所选回滚', exact: true }).click();
      const confirmation = page.getByRole('dialog', { name: '执行回滚', exact: true });
      await confirmation.waitFor();
      await confirmation.getByRole('button', { name: /取\s*消/ }).click();
      await confirmation.waitFor({ state: 'hidden' });
      await footerCheck(page, `rollback-${workflowTheme}`);
      report.browser.push({
        check: 'rollback-selection-blocked-and-cancel-confirmation',
        passed: true,
      });
      for (const item of report.browser.slice(reportStart)) item.theme = workflowTheme;
      await context.close();
    }
  } finally {
    await browser?.close();
    vite.kill();
    await log.close();
  }
}
async function desktopQA() {
  const root = await fs.mkdtemp(path.join(repo, '.local-data', 'react-native-qa-'));
  const env = { ...process.env, DATA_SYNC_HOME: root };
  delete env.DATA_SYNC_DEV;
  delete env.ELECTRON_RUN_AS_NODE;
  let application;
  async function launch() {
    application = await electron.launch({
      executablePath: process.env.DATA_SYNC_QA_APP || require('electron'),
      args: process.env.DATA_SYNC_QA_APP ? [] : [path.join(desktop, 'dist-electron', 'main.cjs')],
      env,
    });
    const page = await application.firstWindow();
    observe(page);
    await page.getByRole('heading', { level: 1, name: '新建同步', exact: true }).waitFor();
    await page.getByText('我的项目', { exact: true }).first().waitFor();
    return page;
  }
  try {
    let page = await launch();
    const overlay = await page.evaluate(() => {
      const controls = navigator.windowControlsOverlay;
      const area = controls?.getTitlebarAreaRect();
      return {
        visible: controls?.visible,
        area: area && { x: area.x, y: area.y, width: area.width, height: area.height },
        width: innerWidth,
        customButtons: !!document.querySelector('.window-actions'),
      };
    });
    assert(
      overlay.visible && overlay.area.width < overlay.width && !overlay.customButtons,
      'native window controls overlay missing',
    );
    report.desktop.push({ check: 'native-controls', ...overlay });
    await application.evaluate(
      ({ BrowserWindow }) =>
        new Promise((resolve) => {
          const win = BrowserWindow.getAllWindows()[0];
          win.once('maximize', () => resolve(true));
          win.maximize();
        }),
    );
    assert(
      await application.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows()[0].isMaximized(),
      ),
    );
    await application.evaluate(
      ({ BrowserWindow }) =>
        new Promise((resolve) => {
          const win = BrowserWindow.getAllWindows()[0];
          win.once('unmaximize', () => resolve(true));
          win.unmaximize();
        }),
    );
    report.desktop.push({ check: 'maximize-restore', passed: true });
    await application.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0].minimize();
    });
    assert(
      await application.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows()[0].isMinimized(),
      ),
    );
    await application.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0].restore();
    });
    report.desktop.push({ check: 'minimize-restore', passed: true });
    await page.getByRole('menuitem', { name: /设置/ }).click();
    await page.getByText('深色', { exact: true }).click();
    await page.locator('[data-theme="dark"]').waitFor();
    const preference = JSON.parse(
      await fs.readFile(path.join(root, 'ui-preferences.json'), 'utf8'),
    );
    assert.equal(preference.themeMode, 'dark');
    await shot(page, 'native-settings-dark');
    console.log('Native QA: first close');
    const exit = application.waitForEvent('close', { timeout: 15000 });
    await application.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0].close();
    });
    await exit;
    application = undefined;
    console.log('Native QA: restart');
    page = await launch();
    await page.locator('[data-theme="dark"]').waitFor();
    report.desktop.push({ check: 'theme-restart-persistence', passed: true });
    await page.evaluate(async () => {
      await window.dataSync.invoke('appearance.set', { themeMode: 'system' });
    });
    await application.evaluate(({ nativeTheme }) => {
      nativeTheme.themeSource = 'dark';
    });
    await page.locator('[data-theme="dark"]').waitFor();
    await application.evaluate(({ nativeTheme }) => {
      nativeTheme.themeSource = 'light';
    });
    await page.locator('[data-theme="light"]').waitFor();
    report.desktop.push({ check: 'native-theme-events', passed: true });
    // Insert a status-only fixture into the isolated local store, without starting a job or contacting a server.
    const { DatabaseSync } = await import('node:sqlite');
    const db = new DatabaseSync(path.join(root, 'state.sqlite'));
    db.prepare('INSERT INTO entities(kind,id,json) VALUES(?,?,?)').run(
      'record',
      'qa-running-fixture',
      JSON.stringify({
        id: 'qa-running-fixture',
        workspaceId: 'default',
        status: 'RUNNING',
        mode: 'EXECUTE_AND_SAVE',
        createdAt: new Date().toISOString(),
        remark: 'UI QA status fixture',
        parentId: '',
        archivePath: '',
        selectedIds: [],
        results: [],
      }),
    );
    db.close();
    await application.evaluate(({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows()[0];
      win.close();
      win.close();
    });
    await page.getByRole('dialog', { name: '关闭客户端', exact: true }).waitFor();
    assert.equal(await page.getByRole('dialog').count(), 1);
    await shot(page, 'native-close-confirmation');
    await page.getByRole('button', { name: /取\s*消/ }).click();
    await page.getByRole('dialog').waitFor({ state: 'hidden' });
    assert.equal(
      await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length),
      1,
    );
    const close = application.waitForEvent('close', { timeout: 15000 });
    await application.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0].close();
    });
    await page.getByRole('dialog').waitFor();
    await page
      .getByRole('button', { name: /^关\s*闭$/ })
      .click()
      .catch((error) => {
        if (!page.isClosed()) throw error;
      });
    await close;
    application = undefined;
    report.desktop.push({
      check: 'running-task-close-cancel-confirm',
      passed: true,
      fixture: 'status-only record in isolated local store; no database server or task execution',
    });
  } finally {
    await application?.close();
  }
}
await fs.mkdir(path.join(repo, '.local-data'), { recursive: true });
try {
  if (native) await desktopQA();
  else await browserQA();
  assert.deepEqual(report.errors, [], 'browser console errors');
  console.log(JSON.stringify(report, null, 2));
} finally {
  await fs.writeFile(
    path.join(repo, 'docs', native ? 'react-desktop-qa.json' : 'react-ui-qa.json'),
    JSON.stringify(report, null, 2) + '\n',
  );
}
