/** Production tree regression with synthetic tables; never opens a database connection. */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { promises as fs, existsSync } from 'node:fs';
import path from 'node:path';
import { build } from 'esbuild';
import { chromium } from 'playwright';

const require = createRequire(import.meta.url);
const desktop = path.resolve(import.meta.dirname, '..');
const repo = path.resolve(desktop, '..');
const baseline = process.argv.includes('--baseline');
const output = path.join(repo, baseline ? '.local-data/tree-baseline.json' : 'docs/tree-qa.json');
const executablePath =
  process.env.DB_ALIGNER_QA_BROWSER ||
  [
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  ].find(existsSync);
const fixture = await build({
  entryPoints: [path.join(desktop, 'src/preview.ts')],
  bundle: true,
  format: 'iife',
  globalName: 'TreeFixture',
  write: false,
});
await fs.mkdir(path.dirname(output), { recursive: true });
const vite = spawn(
  process.execPath,
  [
    path.join(path.dirname(require.resolve('vite/package.json')), 'bin/vite.js'),
    'preview',
    '--host',
    '127.0.0.1',
    '--port',
    '4184',
    '--strictPort',
  ],
  { cwd: desktop, windowsHide: true, stdio: 'ignore' },
);
const report = {
  recordedAt: new Date().toISOString(),
  baseline,
  environment: { node: process.version, browser: '', viewport: { width: 1488, height: 1056 } },
  cases: [],
  errors: [],
};
if (!baseline && existsSync(path.join(repo, '.local-data/tree-baseline.json'))) {
  report.beforeOptimization = JSON.parse(
    await fs.readFile(path.join(repo, '.local-data/tree-baseline.json'), 'utf8'),
  );
}
let browser;
try {
  for (let i = 0; i < 60; i++) {
    if (vite.exitCode !== null) throw new Error('Tree QA preview server exited');
    try {
      if ((await fetch('http://127.0.0.1:4184')).ok) break;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  browser = await chromium.launch({ headless: true, executablePath });
  report.environment.browser = browser.version();
  for (const theme of baseline ? ['light'] : ['light', 'dark']) {
    for (const count of [1000, 5000]) {
      const context = await browser.newContext({
        viewport: { width: 1488, height: 1056 },
        colorScheme: theme,
      });
      const page = await context.newPage();
      page.on('pageerror', (error) => report.errors.push(error.message));
      page.on('console', (message) => {
        if (message.type() === 'error') report.errors.push(message.text());
      });
      await page.addInitScript({
        content: `${fixture.outputFiles[0].text}
          window.treeTableLoads = 0;
          window.treeRevision = 0;
          window.dbAligner = {
            ...TreeFixture.previewBridge,
            invoke(method, params) {
              if (window.treeLoadDelay && ['databases.list', 'tables.list'].includes(method)) {
                return new Promise(resolve => { window.treeLoadRelease = resolve; }).then(() => {
                  window.treeLoadDelay = false;
                  return window.dbAligner.invoke(method, params);
                });
              }
              if (method === 'tables.list') {
                window.treeTableLoads++;
                if (window.treeRefreshFailure) return Promise.reject(new Error('刷新验收失败（虚构数据）'));
                return Promise.resolve(Array.from({ length: ${count} }, (_, i) => ({
                  name: i === 0 && window.treeRevision > 0 ? 'qa_added_table' : 'qa_table_' + String(i).padStart(5, '0'), comment: '虚构性能验收表'
                })));
              }
              if (method === 'table.get') return TreeFixture.previewBridge.invoke(method, params).then(table => ({ ...table, comment: '结构版本 ' + window.treeRevision }));
              return TreeFixture.previewBridge.invoke(method, params);
            }
          };`,
      });
      await page.goto('http://127.0.0.1:4184/?preview=1&page=settings');
      // Use closest rather than depending on Dropdown's wrapper shape.
      async function toggle(key, expanded) {
        return page.evaluate(
          async ({ key, expanded }) => {
            const label = () =>
              [...document.querySelectorAll('.tree-label')].find(
                (el) => el.dataset.nodeKey === key,
              );
            const started = performance.now();
            label().closest('.ant-tree-treenode').querySelector('.ant-tree-switcher').click();
            do {
              await new Promise(requestAnimationFrame);
              const node = label()?.closest('.ant-tree-treenode');
              if (
                node?.getAttribute('aria-expanded') === String(expanded) &&
                !node.querySelector('.anticon-loading') &&
                !document.querySelector('.ant-tree-treenode-motion') &&
                (key !== 'test/shop_test' ||
                  !!document.querySelector('.tree-label[data-node-type="table"]') === expanded)
              ) {
                await new Promise(requestAnimationFrame);
                return performance.now() - started;
              }
            } while (performance.now() - started < 30000);
            throw new Error('Tree toggle did not settle: ' + key);
          },
          { key, expanded },
        );
      }
      await page.locator('.tree-label[data-node-key="group:preview-source-group"]').waitFor();
      await toggle('group:preview-source-group', true);
      async function expandWithLoading(key) {
        await page.evaluate(() => {
          window.treeLoadDelay = true;
        });
        const label = page.locator(`.tree-label[data-node-key="${key}"]`);
        const row = label.locator('xpath=ancestor::*[@role="treeitem"][1]');
        const startedAt = Date.now();
        await row.locator('.ant-tree-switcher').click();
        await row.getByLabel('正在加载最新清单').waitFor();
        assert.equal(await row.locator('.anticon-loading.anticon-spin').count(), 1);
        assert(!(await label.innerText()).includes('加载中'), 'loading feedback must use the icon');
        assert.equal(await label.getAttribute('aria-busy'), 'true');
        await page.waitForTimeout(450);
        assert(
          await row.getByLabel('正在加载最新清单').isVisible(),
          'pending query must keep the loading icon visible',
        );
        if (count === 1000)
          await page.screenshot({
            path: path.join(
              repo,
              `docs/screenshots/react-ant-design/tree-loading-${key === 'test' ? 'connection' : 'database'}-${theme}.png`,
            ),
            animations: 'disabled',
          });
        await page.evaluate(() => window.treeLoadRelease());
        await row.getByLabel('正在加载最新清单').waitFor({ state: 'hidden' });
        await page.locator('.ant-tree-treenode-motion').waitFor({ state: 'detached' });
        assert.equal(await row.getByLabel('正在加载最新清单').count(), 0);
        return Date.now() - startedAt;
      }
      await expandWithLoading('test');
      const firstExpandMs = await expandWithLoading('test/shop_test');
      const samples = [];
      for (let i = 0; i < 3; i++) {
        const collapseMs = await toggle('test/shop_test', false);
        const expandMs = await toggle('test/shop_test', true);
        assert(expandMs >= 290, 'instant responses must still show loading for at least 300 ms');
        samples.push({ collapseMs, expandMs });
      }
      const parents = [];
      if (!baseline) {
        for (const key of ['test', 'group:preview-source-group']) {
          parents.push({
            key,
            collapseMs: await toggle(key, false),
            expandMs: await toggle(key, true),
          });
          assert.equal(
            await page.locator('.tree-label[data-node-type="table"]').count(),
            0,
            'reopening a parent must keep deeper nodes collapsed',
          );
          const next = key === 'test' ? 'test/shop_test' : 'test';
          assert.equal(
            await page
              .locator(`.tree-label[data-node-key="${next}"]`)
              .evaluate((el) => el.closest('.ant-tree-treenode').getAttribute('aria-expanded')),
            'false',
          );
          if (key !== 'test') {
            await toggle('test', true);
            assert.equal(await page.locator('.tree-label[data-node-type="table"]').count(), 0);
          }
          await toggle('test/shop_test', true);
        }
      }
      const mountedRows = await page.locator('.tree-scroll .ant-tree-treenode').count();
      const tableLoads = await page.evaluate(() => window.treeTableLoads);
      assert.equal(
        tableLoads,
        baseline ? 1 : 6,
        'every explicit database expansion must reload the table list',
      );
      console.log(JSON.stringify({ theme, count, firstExpandMs, samples, mountedRows }));
      if (!baseline) {
        assert(mountedRows < 100, `mounted ${mountedRows} rows for ${count} tables`);
        await page.getByRole('tree').focus();
        const holder = page.locator('.tree-scroll .ant-tree-list-holder');
        await page.keyboard.press('End');
        const last = page.locator(
          `.tree-label[data-node-key="test/shop_test/qa_table_${String(count - 1).padStart(5, '0')}"]`,
        );
        await last.waitFor({ state: 'visible' });
        const holderBounds = await holder.boundingBox();
        await page.mouse.move(
          holderBounds.x + holderBounds.width / 2,
          holderBounds.y + holderBounds.height / 2,
        );
        await page.mouse.wheel(0, -300);
        await page.waitForFunction(() => {
          const el = document.querySelector('.tree-scroll .ant-tree-list-holder');
          return el.scrollTop < el.scrollHeight - el.clientHeight - 100;
        });
        await page.keyboard.press('End');
        await last.click();
        assert.equal(await page.locator('.tree-scroll .ant-tree-node-selected').count(), 1);
        await last.click({ button: 'right' });
        await page.getByRole('menuitem', { name: '查看表结构', exact: true }).waitFor();
        await page.keyboard.press('Escape');
        await page.getByRole('tree').focus();
        await page.setViewportSize({ width: 1180, height: 760 });
        await page.waitForFunction(() => {
          const outer = document.querySelector('.tree-scroll').getBoundingClientRect();
          const holder = document.querySelector('.ant-tree-list-holder').getBoundingClientRect();
          return holder.height > 100 && holder.bottom <= outer.bottom;
        });
        await page.keyboard.press('End');
        await last.scrollIntoViewIfNeeded();
        await last.dblclick();
        await page
          .getByRole('heading', {
            name: `qa_table_${String(count - 1).padStart(5, '0')}`,
            exact: true,
          })
          .waitFor();
        if (count === 5000) {
          await page.screenshot({
            path: path.join(repo, `docs/screenshots/react-ant-design/tree-large-${theme}.png`),
            animations: 'disabled',
          });
        }
        await page.getByRole('tree').focus();
        await page.keyboard.press('Home');
        const database = page.locator('.tree-label[data-node-key="test/shop_test"]');
        await database.click({ button: 'right', position: { x: 10, y: 10 } });
        await page.evaluate(() => {
          window.treeRevision = 1;
        });
        await page.getByRole('menuitem', { name: /^刷新数据表/ }).click();
        await page.getByLabel('正在刷新表结构').waitFor({ state: 'hidden' });
        await page
          .locator('.page-heading .hint')
          .filter({ hasText: /^结构版本 1$/ })
          .waitFor();
        await page.waitForFunction(() =>
          document.querySelector('.ant-dropdown:has(.test-success)'),
        );
        await page.locator('.tree-label[data-node-key="test/shop_test/qa_added_table"]').waitFor();
        assert.equal(
          await page.locator('.tree-label[data-node-key="test/shop_test/qa_table_00000"]').count(),
          0,
        );
        await database.click({ button: 'right', position: { x: 10, y: 10 } });
        assert.equal(
          await page
            .getByRole('menuitem', { name: /^刷新数据表/ })
            .locator('.anticon-check')
            .count(),
          0,
        );
        if (count === 5000)
          await page.screenshot({
            path: path.join(repo, `docs/screenshots/react-ant-design/tree-refresh-${theme}.png`),
            animations: 'disabled',
          });
        await page.evaluate(() => {
          window.treeRefreshFailure = true;
        });
        await database.click({ button: 'right', position: { x: 10, y: 10 } });
        await page.getByRole('menuitem', { name: /^刷新数据表/ }).click();
        await page.getByLabel('正在刷新表结构').waitFor({ state: 'hidden' });
        await page.waitForFunction(() => document.querySelector('.ant-dropdown:has(.test-error)'));
        const refresh = page.getByRole('menuitem', { name: /^刷新数据表/ });
        assert.equal(await refresh.locator('.anticon-close').count(), 1);
        await refresh.hover();
        await page.getByRole('tooltip').filter({ hasText: '刷新验收失败' }).waitFor();
        await page.evaluate(() => {
          window.treeRefreshFailure = false;
          window.treeRevision = 2;
        });
        await refresh.click();
        await page.getByLabel('正在刷新表结构').waitFor({ state: 'hidden' });
        await page
          .locator('.page-heading .hint')
          .filter({ hasText: /^结构版本 2$/ })
          .waitFor();
        await page.waitForFunction(() =>
          document.querySelector('.ant-dropdown:has(.test-success)'),
        );
        await page.keyboard.press('Escape');
        await toggle('test/shop_test', false);
        await database.click({ button: 'right', position: { x: 10, y: 10 } });
        await page.getByRole('menuitem', { name: /^刷新数据表/ }).click();
        await page.getByLabel('正在刷新表结构').waitFor({ state: 'hidden' });
        assert.equal(
          await page.locator('.tree-label[data-node-type="table"]').count(),
          0,
          'refresh must not reopen a collapsed branch',
        );
        await page
          .getByRole('menuitem', { name: /^刷新数据表/ })
          .locator('.anticon-check')
          .waitFor();
        await page.keyboard.press('Escape');
        await toggle('test/shop_test', true);
        assert.equal(
          await page.evaluate(() => window.treeTableLoads),
          tableLoads + 5,
          'reopening the refreshed branch must also reload metadata',
        );
      }
      report.cases.push({
        theme,
        tables: count,
        firstExpandMs,
        samples,
        parents,
        mountedRows,
        tableLoads,
        interactionsPassed: !baseline,
      });
      await context.close();
    }
  }
  assert.deepEqual(report.errors, []);
  console.log(JSON.stringify(report, null, 2));
} catch (error) {
  report.errors.push(error.message);
  throw error;
} finally {
  await browser?.close();
  vite.kill();
  await fs.writeFile(output, JSON.stringify(report, null, 2) + '\n');
}
