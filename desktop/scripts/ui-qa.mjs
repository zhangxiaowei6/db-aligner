import { navigationQA } from './navigation-qa.mjs';
import { interactionRevisionsQA } from './interaction-revisions-qa.mjs';
import { motionQA } from './motion-qa.mjs';
import { multiDatabaseQA } from './multi-database-qa.mjs';
/** Browser UI acceptance against the production React bundle.
 * Requires npm run build. Uses a local Chrome/Edge installation (or Playwright's browser).
 * Never reads the normal client's database or connects to a database server. */
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { promises as fs, existsSync } from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { performanceQA } from './performance-qa.mjs';
import { recordConfirmationQA } from './record-confirmation-qa.mjs';
import { updatesQA } from './updates-qa.mjs';
const require = createRequire(import.meta.url);
const desktop = path.resolve(import.meta.dirname, '..');
const repo = path.resolve(desktop, '..');
const output = process.env.DB_ALIGNER_QA_OUTPUT_DIR;
const screenshots = output
  ? path.join(path.resolve(output), 'screenshots')
  : path.join(repo, 'docs', 'screenshots', 'react-ant-design');
const report = { browser: [], errors: [] };
await fs.mkdir(screenshots, { recursive: true });
const executablePath =
  process.env.DB_ALIGNER_QA_BROWSER ||
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
  const target = path.join(screenshots, name + '.png');
  const temporary = target + `.${process.pid}.tmp`;
  try {
    await fs.writeFile(temporary, await page.screenshot({ animations: 'disabled' }));
    await fs.rename(temporary, target);
  } finally {
    await fs.rm(temporary, { force: true });
  }
}
async function motionSettled(page, selector) {
  // Motion registers its entrance on animation frames after mounting the dialog.
  await page.evaluate(
    () =>
      new Promise((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(resolve))),
      ),
  );
  await page.waitForFunction(
    (target) =>
      [...document.querySelectorAll(target)].every((element) =>
        element.getAnimations().every((animation) => animation.playState !== 'running'),
      ),
    selector,
  );
}
async function modalSettled(page) {
  await motionSettled(page, '.ant-modal');
}
async function assertFreshSync(page) {
  await page.getByRole('heading', { level: 1, name: '新建同步', exact: true }).waitFor();
  const databases = await page.locator('.source-target-form').innerText();
  assert(databases.includes('选择来源数据库'));
  assert(databases.includes('选择目标库'));
  assert(!databases.includes('shop_'));
  assert.equal(await page.getByRole('checkbox', { name: / 表结构$| 基础数据$/ }).count(), 0);
  assert.equal(await page.getByRole('textbox', { name: '搜索表', exact: true }).inputValue(), '');
  assert(await page.getByRole('radio', { name: '全部表', exact: true }).isChecked());
  assert(
    (await page
      .getByRole('tab', { name: '同步结构', exact: true })
      .getAttribute('aria-selected')) === 'true',
  );
  assert(await page.getByRole('button', { name: '开始比较', exact: true }).isDisabled());
  assert(await page.getByRole('button', { name: '应用模板', exact: true }).isDisabled());
  assert.equal(await page.getByText(/已应用：/).count(), 0);
  assert.equal(await page.getByRole('region', { name: '比较进度' }).count(), 0);
  assert.equal(
    await page.locator('.scope-panel .anticon-check, .scope-panel .anticon-close').count(),
    0,
  );
  for (const name of ['普通 / 唯一索引', '外键', '表字符集与排序规则']) {
    assert(
      !(await page
        .locator('.structure-defaults')
        .getByRole('checkbox', { name, exact: true })
        .isChecked()),
    );
  }
}
async function applyScopeTemplate(page) {
  await page.getByRole('combobox', { name: '选择同步模板', exact: true }).click();
  await page
    .locator('.ant-select-dropdown:visible .ant-select-item-option')
    .filter({
      hasText: '基础字典与菜单',
    })
    .click();
  await page.getByRole('button', { name: '应用模板', exact: true }).click();
  await page.getByText('已应用：基础字典与菜单', { exact: true }).waitFor();
}
async function newSyncQA(browser, theme) {
  const context = await browser.newContext({
    viewport: { width: 1488, height: 1056 },
    colorScheme: theme,
  });
  const page = await context.newPage();
  observe(page);
  try {
    await page.goto('http://127.0.0.1:4183/?preview=1');
    await page.getByRole('heading', { level: 1, name: '差异预览', exact: true }).waitFor();
    await page.getByRole('menuitem', { name: /新建同步/ }).click();
    await assertFreshSync(page);
    await shot(page, `new-sync-empty-${theme}`);
    await page.setViewportSize({ width: 1180, height: 760 });
    await footerCheck(page, `new-sync-empty-minimum-${theme}`);
    await shot(page, `new-sync-empty-minimum-${theme}`);
    await page.setViewportSize({ width: 1488, height: 1056 });
    report.browser.push({ check: 'new-sync-sidebar-clears-completed-plan', theme, passed: true });
    for (const origin of ['scope', 'settings', 'history']) {
      await applyScopeTemplate(page);
      await page.getByRole('textbox', { name: '搜索表', exact: true }).fill('sysdict');
      await page.locator('.scope-table-search').getByText('已选表', { exact: true }).click();
      await page.getByRole('tab', { name: '同步数据', exact: true }).click();
      await page.getByRole('checkbox', { name: 'sys_dict 基础数据', exact: true }).check();
      await page.getByRole('textbox', { name: 'sys_dict 匹配键', exact: true }).fill('code');
      await page.getByRole('textbox', { name: '搜索表', exact: true }).fill('sysdict');
      if (origin !== 'scope') {
        await page
          .getByRole('menuitem', { name: origin === 'settings' ? /设置/ : /同步历史/ })
          .click();
      }
      await page.getByRole('menuitem', { name: /新建同步/ }).click();
      await assertFreshSync(page);
      await page.getByRole('tab', { name: '同步数据', exact: true }).click();
      assert.equal(await page.getByRole('checkbox', { name: / 基础数据$/ }).count(), 0);
      assert.equal(
        await page.getByRole('textbox', { name: '搜索表', exact: true }).inputValue(),
        '',
      );
      await page.getByRole('tab', { name: '同步结构', exact: true }).click();
      report.browser.push({
        check: 'new-sync-sidebar-clears-both-mode-drafts',
        origin,
        theme,
        passed: true,
      });
    }
  } finally {
    await context.close();
  }
}
async function longDiffQA(browser, theme) {
  const fixture = await build({
    entryPoints: [path.join(desktop, 'src/preview.ts')],
    bundle: true,
    format: 'iife',
    globalName: 'DiffFixture',
    write: false,
  });
  const context = await browser.newContext({
    viewport: { width: 1488, height: 1056 },
    colorScheme: theme,
  });
  const page = await context.newPage();
  observe(page);
  try {
    await page.addInitScript({
      content: `${fixture.outputFiles[0].text}
        const plan = structuredClone(DiffFixture.previewPlan);
        const target = plan.targets[0];
        const sample = target.changes.find(change => change.kind === 'MODIFY_COLUMN');
        const names = Array.from({ length: 80 }, (_, index) => 'qa_table_' + String(index).padStart(3, '0'));
        plan.tables = names.map(name => ({ ...plan.tables[0], name, structure: true, data: false }));
        target.changes = names.map((name, index) => ({
          ...sample, id: 'qa-change-' + index, table: name, label: 'qa_field_' + String(index).padStart(3, '0'),
          sql: 'ALTER TABLE ' + name + ' MODIFY COLUMN qa_field_' + String(index).padStart(3, '0') + ' BIGINT;'
        }));
        const sourceTable = plan.sourceSnapshot[sample.table];
        const beforeTable = target.before[sample.table];
        const snapshot = (table, name, index) => ({
          ...table, name,
          columns: table.columns.map(column => column.name === sample.label
            ? { ...column, name: 'qa_field_' + String(index).padStart(3, '0') } : column)
        });
        plan.sourceSnapshot = Object.fromEntries(names.map((name, index) => [name, snapshot(sourceTable, name, index)]));
        target.before = Object.fromEntries(names.map((name, index) => [name, snapshot(beforeTable, name, index)]));
        plan.targets = [target];
        window.diffFixturePending = 0;
        window.__DBALIGNER_PREVIEW_BRIDGE__ = {
          ...DiffFixture.previewBridge,
          invoke(method, params) {
            if (method === 'sync.compare.start') return Promise.resolve({ compareId: params.compareId });
            if (method === 'sync.compare.get') return Promise.resolve({
              compareId: params.compareId, status: 'COMPLETED', plan,
              progress: { table: '', phase: '', rows: 0, completed: 160, total: 160 }
            });
            window.diffFixturePending++;
            return DiffFixture.previewBridge.invoke(method, params).finally(() => window.diffFixturePending--);
          }
        };`,
    });
    await page.goto('http://127.0.0.1:4183/?preview=1');
    await page.getByRole('heading', { level: 1, name: '差异预览', exact: true }).waitFor();
    await page.getByRole('button', { name: '上一步', exact: true }).click();
    await page.getByText('显示 6 / 6 张表', { exact: false }).waitFor();
    await page
      .getByRole('status')
      .filter({ hasText: '正在检查目标库表清单…' })
      .waitFor({ state: 'hidden' });
    await page.waitForFunction(() => window.diffFixturePending === 0);
    await page.getByRole('button', { name: '开始比较', exact: true }).click();
    await modalSettled(page);
    await page.getByRole('button', { name: '确认并开始比较', exact: true }).click();
    await page.getByRole('heading', { level: 1, name: '差异预览', exact: true }).waitFor();
    await page
      .locator('.page-body')
      .evaluate((element) =>
        Promise.all(element.getAnimations().map((animation) => animation.finished)),
      );
    for (const width of [1488, 1180, 960]) {
      await page.setViewportSize({ width, height: width === 1488 ? 1056 : 760 });
      const list = page.locator('.diff-layout > section');
      const inspector = page.getByLabel('差异明细', { exact: true });
      await list.evaluate((element) => {
        element.scrollTop = element.scrollHeight;
      });
      const lastRow = list.locator('tr').filter({ hasText: 'qa_field_079' });
      await lastRow.click();
      assert((await inspector.innerText()).includes('qa_field_079'));
      const selectedBefore = await list.evaluate((element) => element.scrollTop);
      const bounds = await inspector.boundingBox();
      const listBounds = await list.boundingBox();
      const footerBounds = await page.locator('#page-footer').boundingBox();
      const breadcrumbs = await page.locator('.page-scroll > .ant-breadcrumb').count();
      assert(
        bounds.height > 80 && listBounds.height > 80,
        `both difference panes need usable height: inspector=${JSON.stringify(bounds)}, list=${JSON.stringify(listBounds)}, footer=${JSON.stringify(footerBounds)}, breadcrumbs=${breadcrumbs}`,
      );
      assert(bounds.y >= 0 && bounds.y + bounds.height <= footerBounds.y + 1);
      assert.equal(await inspector.evaluate((element) => element.scrollTop), 0);
      assert.equal(await page.locator('.page-scroll').evaluate((element) => element.scrollTop), 0);
      await inspector.evaluate((element) => {
        element.scrollTop = element.scrollHeight;
      });
      assert.equal(await list.evaluate((element) => element.scrollTop), selectedBefore);
      assert((await inspector.locator('.sql-view').innerText()).includes('qa_table_079'));
      await lastRow.press('ArrowUp');
      const previous = list.locator('tr').filter({ hasText: 'qa_field_078' });
      await previous.focus();
      await previous.press('Enter');
      assert.equal(await inspector.evaluate((element) => element.scrollTop), 0);
      assert((await inspector.innerText()).includes('qa_field_078'));
      await shot(page, `diff-long-list-${width}-${theme}`);
      await footerCheck(page, `diff-long-list-footer-${width}-${theme}`);
      report.browser.push({
        check: 'diff-long-list-independent-scroll-and-keyboard',
        theme,
        width,
        passed: true,
      });
    }
  } catch (error) {
    await shot(page, `diff-long-list-failure-${theme}`);
    throw error;
  } finally {
    await context.close();
  }
}
async function syncModeQA(browser, theme) {
  const context = await browser.newContext({
    viewport: { width: 1488, height: 1056 },
    colorScheme: theme,
  });
  const page = await context.newPage();
  observe(page);
  try {
    await page.goto('http://127.0.0.1:4183/?preview=1');
    await page.getByRole('heading', { level: 1, name: '差异预览', exact: true }).waitFor();
    await page.getByRole('button', { name: '上一步', exact: true }).click();
    assert.equal(await page.getByRole('radio', { name: /同步结构|同步数据/ }).count(), 0);
    await page.getByRole('tab', { name: '同步结构', exact: true }).click();
    const search = page.getByRole('textbox', { name: '搜索表', exact: true });
    for (const name of ['普通 / 唯一索引', '外键', '表字符集与排序规则']) {
      assert(
        !(await page
          .locator('.structure-defaults')
          .getByRole('checkbox', { name, exact: true })
          .isChecked()),
      );
    }
    await search.fill('sys_dict');
    assert.equal(await page.getByRole('checkbox', { name: / 表结构$/ }).count(), 1);
    assert(await page.getByText('显示 1 / 6 张表', { exact: false }).isVisible());
    assert(await page.getByRole('button', { name: '取消选择搜索结果', exact: true }).isVisible());
    await search.fill('  SYSDICT  ');
    assert.equal(await page.getByRole('checkbox', { name: / 表结构$/ }).count(), 1);
    assert(await page.getByRole('checkbox', { name: 'sys_dict 表结构', exact: true }).isVisible());
    assert((await page.locator('.scope-table-search').innerText()).includes('当前类型已选 3 张'));
    await page.locator('.scope-table-search').getByText('已选表', { exact: true }).click();
    await search.fill('');
    assert.equal(await page.getByRole('checkbox', { name: / 表结构$/ }).count(), 3);
    await page.locator('.scope-table').scrollIntoViewIfNeeded();
    await shot(page, `scope-selected-filter-${theme}`);
    await page.locator('.scope-table-search').getByText('全部表', { exact: true }).click();
    await search.fill('');
    assert.equal(await page.getByText(/数据同步仅处理源库/).count(), 0);
    assert(
      await page.getByText('删除与高风险结构变更默认不选中，在差异预览中逐项确认。').isVisible(),
    );
    await page.locator('.page-scroll').evaluate((el) => {
      el.scrollTop = el.scrollHeight;
    });
    await shot(page, `scope-structure-mode-${theme}`);
    await page.getByRole('tab', { name: '同步数据', exact: true }).click();
    assert(await page.getByText(/数据同步仅处理源库/).isVisible());
    assert(await page.getByRole('radio', { name: '全部表', exact: true }).isChecked());
    assert((await page.getByText(/数据量限制：源库和每个目标库/).innerText()).includes('20,000'));
    assert(
      (await page.getByText(/多表或多目标比较会读取/).innerText()).includes(
        '分批选表不能绕过单表行数上限',
      ),
    );
    assert.equal(
      await page.getByText('删除与高风险结构变更默认不选中，在差异预览中逐项确认。').count(),
      0,
    );
    assert.equal(await page.getByRole('checkbox', { name: / 表结构$/ }).count(), 0);
    assert.equal(await page.getByRole('columnheader', { name: /结构细项/ }).count(), 0);
    assert.equal(await page.locator('.structure-defaults').count(), 0);
    const key = page.getByRole('textbox', { name: 'sys_dict 匹配键', exact: true });
    assert.equal(await key.inputValue(), '');
    await page.getByRole('button', { name: '全选所有表', exact: true }).click();
    assert(await page.getByRole('button', { name: '取消全选', exact: true }).isVisible());
    assert.equal(
      await page.getByRole('checkbox', { name: / 基础数据$/, checked: true }).count(),
      6,
    );
    await page.getByRole('button', { name: '取消全选', exact: true }).click();
    for (const name of ['sys_dict', 'sys_menu', 'sys_user']) {
      await page.getByRole('checkbox', { name: `${name} 基础数据`, exact: true }).check();
    }
    await key.fill('code');
    await page.locator('.scope-table-search').getByText('已选表', { exact: true }).click();
    await search.fill('sysuser');
    assert.equal(await page.getByRole('checkbox', { name: / 基础数据$/ }).count(), 1);
    await page.getByRole('tab', { name: '同步结构', exact: true }).click();
    assert(await page.getByRole('radio', { name: '全部表', exact: true }).isChecked());
    await page.getByRole('tab', { name: '同步数据', exact: true }).click();
    assert(await page.getByRole('radio', { name: '已选表', exact: true }).isChecked());
    assert.equal(await search.inputValue(), 'sysuser');
    await page.locator('.scope-table-search').getByText('全部表', { exact: true }).click();
    await search.fill('');
    await page.setViewportSize({ width: 1180, height: 760 });
    await footerCheck(page, `scope-data-minimum-${theme}`);
    await shot(page, `scope-data-minimum-${theme}`);
    await page.setViewportSize({ width: 1488, height: 1056 });
    await page.locator('.page-scroll').evaluate((el) => {
      el.scrollTop = el.scrollHeight;
    });
    await shot(page, `scope-data-mode-${theme}`);
    await footerCheck(page, `scope-data-mode-${theme}`);
    await page.getByRole('tab', { name: '同步结构', exact: true }).click();
    assert.equal(await key.count(), 0);
    assert.equal(await page.getByRole('columnheader', { name: /匹配键/ }).count(), 0);
    assert(await page.getByRole('checkbox', { name: 'sys_dict 表结构', exact: true }).isChecked());
    await page.getByRole('tab', { name: '同步数据', exact: true }).click();
    assert.equal(await key.inputValue(), 'code');
    await page.getByRole('button', { name: '开始比较', exact: true }).click();
    const confirmation = page.getByRole('dialog', { name: '确认比较范围', exact: true });
    await confirmation.waitFor();
    assert((await confirmation.innerText()).includes('将在上述目标库自动跳过'));
    assert(await confirmation.getByRole('button', { name: '确认并开始比较' }).isDisabled());
    await confirmation.getByRole('checkbox', { name: /性能影响/ }).check();
    await shot(page, `compare-data-skip-${theme}`);
    await confirmation.getByRole('button', { name: '确认并开始比较' }).click();
    await page.getByRole('heading', { level: 1, name: '基础数据差异', exact: true }).waitFor();
    await page
      .getByText(/已自动跳过：目标库不存在该表/)
      .first()
      .waitFor();
    assert.equal(await page.getByRole('tab', { name: '表结构', exact: true }).count(), 0);
    assert.equal(
      await page.getByRole('tab', { name: '基础数据', exact: true }).getAttribute('aria-selected'),
      'true',
    );
    await page.getByText('code = ORDER_STATUS', { exact: true }).first().click();
    await page.getByText('字段值对比', { exact: true }).waitFor();
    assert((await page.locator('.diff-inspector').innerText()).includes('ORDER_STATUS'));
    await shot(page, `diff-data-compatible-${theme}`);
    await page.getByText('先同步字段结构', { exact: true }).first().click();
    await page
      .locator('.diff-inspector')
      .getByText('目标表缺少源字段，请先同步结构', { exact: true })
      .waitFor();
    await shot(page, `diff-data-skip-${theme}`);
    await page.getByRole('button', { name: '上一步', exact: true }).click();
    await page.getByRole('tab', { name: '同步结构', exact: true }).click();
    await page.getByText('正在检查目标库表清单…', { exact: true }).waitFor({ state: 'hidden' });
    await page.getByRole('button', { name: '开始比较', exact: true }).click();
    await page
      .getByRole('dialog', { name: '确认比较范围', exact: true })
      .getByRole('button', { name: '确认并开始比较', exact: true })
      .click();
    await page.getByRole('heading', { level: 1, name: '差异预览', exact: true }).waitFor();
    assert.equal(await page.getByRole('tab', { name: '基础数据', exact: true }).count(), 0);
    assert.equal(
      await page.getByRole('tab', { name: '表结构', exact: true }).getAttribute('aria-selected'),
      'true',
    );
    await shot(page, `diff-structure-mode-${theme}`);
    report.browser.push({
      check: 'exclusive-sync-mode-and-per-target-missing-data-skip',
      theme,
      passed: true,
    });
  } catch (error) {
    await page.screenshot({
      path: path.join(repo, '.local-data', `sync-mode-qa-failure-${theme}.png`),
      animations: 'disabled',
    });
    await fs.writeFile(
      path.join(repo, '.local-data', `sync-mode-qa-failure-${theme}.txt`),
      await page.locator('body').innerText(),
    );
    throw error;
  } finally {
    await context.close();
  }
}
async function selectedScopeQA(browser, theme) {
  const fixture = await build({
    entryPoints: [path.join(desktop, 'src/preview.ts')],
    bundle: true,
    format: 'iife',
    globalName: 'ScopeFixture',
    write: false,
  });
  const context = await browser.newContext({
    viewport: { width: 1180, height: 760 },
    colorScheme: theme,
  });
  const page = await context.newPage();
  observe(page);
  try {
    await page.addInitScript({
      content: `${fixture.outputFiles[0].text}
        window.__DBALIGNER_PREVIEW_BRIDGE__ = {
          ...ScopeFixture.previewBridge,
          invoke(method, params) {
            if (method === 'sync.compare') return Promise.resolve(structuredClone(ScopeFixture.previewPlan));
            if (method === 'tables.list') return Promise.resolve(
              Array.from({ length: 32 }, (_, index) => ({
                name: 'qa_selected_' + String(index).padStart(3, '0') + '_long_table_name_for_scope_review',
                comment: index === 31 ? '订单说明' : '测试表说明'
              }))
            );
            return ScopeFixture.previewBridge.invoke(method, params);
          }
        };`,
    });
    await page.goto('http://127.0.0.1:4183/?preview=1');
    await page.getByRole('heading', { level: 1, name: '差异预览', exact: true }).waitFor();
    await page.getByRole('button', { name: '上一步', exact: true }).click();
    await page.getByRole('button', { name: '全选所有表', exact: true }).click();
    const summary = page.locator('.scope-table-search');
    assert((await summary.innerText()).includes('当前类型已选 32 张'));
    assert.equal(
      await page.getByRole('button', { name: '查看全部已选表', exact: true }).count(),
      0,
    );
    const search = page.getByRole('textbox', { name: '搜索表', exact: true });
    await search.fill('订单');
    assert.equal(await page.getByRole('checkbox', { name: / 表结构$/ }).count(), 1);
    assert((await summary.innerText()).includes('当前类型已选 32 张'));
    await search.fill('no-match');
    assert(await page.getByRole('button', { name: '全选搜索结果', exact: true }).isDisabled());
    await page.locator('.scope-table-search').getByText('已选表', { exact: true }).click();
    assert(await page.getByText('没有符合条件的已选表，请调整搜索或切换到全部表').isVisible());
    await search.fill('');
    const list = page.locator('.scope-table');
    await list.locator('.ant-pagination-item').last().click();
    assert((await list.innerText()).includes('qa_selected_031'));
    await page
      .getByRole('checkbox', {
        name: 'qa_selected_031_long_table_name_for_scope_review 表结构',
        exact: true,
      })
      .click();
    assert.equal(await page.getByRole('checkbox', { name: / 表结构$/, checked: true }).count(), 11);
    assert((await summary.innerText()).includes('当前类型已选 31 张'));
    await footerCheck(page, `scope-selected-filter-minimum-${theme}`);
    await shot(page, `scope-selected-filter-minimum-${theme}`);
    report.browser.push({
      check: 'scope-search-and-selected-filter-pagination',
      theme,
      passed: true,
    });
  } finally {
    await context.close();
  }
}
async function organizationQA(browser, theme) {
  const context = await browser.newContext({
    viewport: { width: 1488, height: 1056 },
    colorScheme: theme,
  });
  const page = await context.newPage();
  observe(page);
  try {
    await page.goto('http://127.0.0.1:4183/?preview=1');
    await page.getByRole('heading', { level: 1, name: '差异预览', exact: true }).waitFor();
    assert.equal(await page.getByRole('button', { name: '新建分组', exact: true }).count(), 0);
    await page
      .locator('.sidebar-label')
      .getByRole('button', { name: '数据库连接', exact: true })
      .click();
    assert.equal(await page.getByRole('button', { name: '编辑分组', exact: true }).count(), 0);
    const groupLabel = (id) =>
      page.locator(`.tree-label[data-group-id="${id}"]:not([data-connection-id])`);
    await groupLabel('preview-source-group').click({ button: 'right' });
    await page.getByRole('menuitem', { name: '编辑分组', exact: true }).click();
    const manager = page.getByRole('dialog', { name: '编辑分组', exact: true });
    assert.equal(await manager.getByRole('textbox').count(), 1);
    await modalSettled(page);
    assert.equal(await manager.getByRole('textbox').inputValue(), '测试环境');
    await shot(page, `group-edit-${theme}`);
    await manager.getByRole('button', { name: /^取\s*消$/ }).click();
    await manager.waitFor({ state: 'hidden' });
    await groupLabel('preview-source-group').click({ button: 'right' });
    await page.getByRole('menuitem', { name: '新增分组', exact: true }).click();
    const creator = page.getByRole('dialog', { name: '新增分组', exact: true });
    await modalSettled(page);
    await creator.getByRole('textbox', { name: '分组名称', exact: true }).fill('QA 空分组');
    await shot(page, `group-create-${theme}`);
    await creator.getByRole('button', { name: /^保\s*存$/ }).click();
    await creator.waitFor({ state: 'hidden' });
    const connectionLabel = (id) => page.locator(`.tree-label[data-connection-id="${id}"]`);
    const treeRow = (label) => page.getByRole('treeitem').filter({ has: label });
    for (const id of ['preview-source-group', 'preview-target-group']) {
      await treeRow(groupLabel(id)).locator('.ant-tree-switcher').click();
    }
    await connectionLabel('test').waitFor();
    await page.locator('.ant-tree-treenode-motion').waitFor({ state: 'detached' });
    await connectionLabel('test').click();
    assert.equal(await page.locator('.ant-tree-treenode-selected').count(), 1);
    await connectionLabel('test').click();
    assert.equal(await page.locator('.ant-tree-treenode-selected').count(), 0);
    await connectionLabel('test').click();
    const treeBounds = await page.locator('.tree-scroll').boundingBox();
    await page.mouse.click(treeBounds.x + 6, treeBounds.y + treeBounds.height - 6);
    assert.equal(await page.locator('.ant-tree-treenode-selected').count(), 0);
    async function startDrag(label, target, fraction = 0.5) {
      // Persisting the preceding move temporarily disables native dragging.
      await label.locator('xpath=ancestor::*[@draggable="true"][1]').waitFor();
      await page.locator('.ant-tree-treenode-motion').waitFor({ state: 'detached' });
      const sourceBounds = await label.boundingBox();
      const destinationBounds = await treeRow(target).boundingBox();
      await page.mouse.move(
        sourceBounds.x + sourceBounds.width / 2,
        sourceBounds.y + sourceBounds.height / 2,
      );
      await page.mouse.down();
      await page.mouse.move(
        sourceBounds.x + sourceBounds.width / 2 + 12,
        sourceBounds.y + sourceBounds.height / 2 + 4,
        { steps: 4 },
      );
      await page.mouse.move(
        destinationBounds.x + destinationBounds.width - 16,
        destinationBounds.y + destinationBounds.height * fraction,
        { steps: 10 },
      );
      await page.mouse.move(
        destinationBounds.x + destinationBounds.width - 15,
        destinationBounds.y + destinationBounds.height * fraction,
      );
      assert.equal(await page.locator('.ant-tree-treenode.dragging').count(), 1);
      assert.equal(await page.locator('.ant-tree-treenode-selected').count(), 0);
      assert((await page.locator('.ant-tree-drop-indicator').count()) <= 1);
      const indicator = page.locator('.ant-tree-drop-indicator');
      if (await indicator.count()) {
        const visibleLine = await indicator.evaluate((el) => {
          const rect = el.getBoundingClientRect();
          let top = rect.top,
            bottom = rect.bottom,
            left = rect.left,
            right = rect.right;
          for (let parent = el.parentElement; parent; parent = parent.parentElement) {
            const style = getComputedStyle(parent);
            const bounds = parent.getBoundingClientRect();
            if (style.overflowY !== 'visible') {
              top = Math.max(top, bounds.top);
              bottom = Math.min(bottom, bounds.bottom);
            }
            if (style.overflowX !== 'visible') {
              left = Math.max(left, bounds.left);
              right = Math.min(right, bounds.right);
            }
          }
          return { width: right - left, height: bottom - top, totalWidth: rect.width };
        });
        assert(
          visibleLine.width > 80 && visibleLine.height >= 1.5,
          `drop line clipped: ${JSON.stringify(visibleLine)}`,
        );
      }
    }
    async function cleared() {
      await page.waitForFunction(
        () =>
          !document.querySelector(
            '.ant-tree-treenode.dragging, .ant-tree-drop-indicator, .ant-tree-treenode-selected, .ant-tree-node-selected',
          ),
      );
    }
    const cursorLabel = connectionLabel('test');
    const cursorBounds = await cursorLabel.boundingBox();
    await page.mouse.move(
      cursorBounds.x + cursorBounds.width / 2,
      cursorBounds.y + cursorBounds.height / 2,
    );
    assert.equal(await cursorLabel.evaluate((el) => getComputedStyle(el).cursor), 'pointer');
    await page.mouse.down();
    await page.waitForTimeout(150);
    assert.equal(await cursorLabel.getAttribute('data-drag-ready'), null);
    assert.equal(await cursorLabel.evaluate((el) => getComputedStyle(el).cursor), 'pointer');
    await page.mouse.up();
    await page.mouse.down();
    await page.waitForTimeout(450);
    assert.equal(await cursorLabel.getAttribute('data-drag-ready'), 'true');
    assert.equal(await cursorLabel.evaluate((el) => getComputedStyle(el).cursor), 'grab');
    await shot(page, `tree-long-press-${theme}`);
    await page.mouse.up();
    assert.equal(await cursorLabel.getAttribute('data-drag-ready'), null);
    report.browser.push({
      check: 'tree-pointer-short-click-400ms-long-press-and-release',
      theme,
      passed: true,
    });
    await startDrag(connectionLabel('test'), groupLabel('preview-target-group'));
    await shot(page, `tree-drag-${theme}`);
    await page.mouse.up();
    await cleared();
    await page
      .getByRole('row')
      .filter({ has: page.getByRole('button', { name: '编辑连接 测试服务器', exact: true }) })
      .getByText('目标环境', { exact: true })
      .waitFor();
    if (
      (await treeRow(groupLabel('preview-target-group')).getAttribute('aria-expanded')) !== 'true'
    )
      await treeRow(groupLabel('preview-target-group')).locator('.ant-tree-switcher').click();
    await page.waitForFunction(
      () =>
        document.querySelector('.tree-label[data-connection-id="test"]')?.dataset.groupId ===
        'preview-target-group',
    );
    await startDrag(connectionLabel('test'), connectionLabel('target0'), 0.08);
    await shot(page, `tree-drop-before-${theme}`);
    await page.mouse.up();
    await cleared();
    await page.waitForFunction(
      () =>
        document.querySelector(
          '.tree-label[data-group-id="preview-target-group"][data-connection-id]',
        )?.dataset.connectionId === 'test',
    );
    await startDrag(connectionLabel('test'), groupLabel('preview-source-group'));
    await page.keyboard.press('Escape');
    await page.mouse.up();
    await cleared();
    assert.equal(
      await connectionLabel('test').getAttribute('data-group-id'),
      'preview-target-group',
    );
    await startDrag(connectionLabel('test'), groupLabel('preview-source-group'));
    await page.mouse.move(1000, 400, { steps: 8 });
    await page.mouse.up();
    await cleared();
    assert.equal(
      await connectionLabel('test').getAttribute('data-group-id'),
      'preview-target-group',
    );
    // Collapse group children so both sibling group gaps are unambiguous.
    for (const id of ['preview-source-group', 'preview-target-group']) {
      if ((await treeRow(groupLabel(id)).getAttribute('aria-expanded')) === 'true')
        await treeRow(groupLabel(id)).locator('.ant-tree-switcher').click();
    }
    assert.equal(
      await treeRow(groupLabel('preview-target-group')).evaluate(
        (el) => getComputedStyle(el).cursor,
      ),
      'pointer',
    );
    await startDrag(groupLabel('preview-target-group'), groupLabel('preview-source-group'), 0.08);
    await shot(page, `group-sort-${theme}`);
    await page.mouse.up();
    await cleared();
    await page.waitForFunction(
      () =>
        document.querySelector('.tree-label[data-node-type="group"]')?.dataset.groupId ===
        'preview-target-group',
    );
    await treeRow(groupLabel('preview-target-group')).locator('.ant-tree-switcher').click();
    await connectionLabel('test').waitFor();
    const empty = page.locator('.tree-label').filter({ hasText: /^QA 空分组$/ });
    const emptyId = await empty.getAttribute('data-group-id');
    await startDrag(connectionLabel('test'), empty);
    await page.mouse.up();
    await cleared();
    // Empty groups start collapsed. Wait for the persisted move in the management list,
    // then expand the group before checking its rendered child.
    await page
      .getByRole('row')
      .filter({ hasText: '测试服务器' })
      .getByText('QA 空分组', { exact: true })
      .waitFor();
    if ((await treeRow(empty).getAttribute('aria-expanded')) !== 'true')
      await treeRow(empty).locator('.ant-tree-switcher').click();
    await page.waitForFunction(
      (id) =>
        document.querySelector('.tree-label[data-connection-id="test"]')?.dataset.groupId === id,
      emptyId,
    );
    report.browser.push({
      check: 'native-html5-tree-drag-selection-cancel-invalid-empty-and-reorder',
      theme,
      passed: true,
    });
    await page
      .locator('.page-scroll')
      .getByRole('button', { name: '新建连接', exact: true })
      .click();
    const editor = page.getByRole('dialog', { name: '新建连接', exact: true });
    await editor.waitFor();
    // Modal entrance completion focuses the dialog. Wait for it before typing into
    // the custom select popup, including when screenshots fast-forward animations.
    await modalSettled(page);
    assert.equal(await editor.getByRole('button', { name: '新增分组', exact: true }).count(), 0);
    await editor.getByRole('combobox', { name: '连接分组', exact: true }).click();
    await page.getByRole('textbox', { name: '新增连接分组名称', exact: true }).fill('QA 下拉新增');
    await shot(page, `group-select-create-${theme}`);
    await page.getByRole('button', { name: '新增', exact: true }).click();
    await page.locator('.ant-select-content').filter({ hasText: 'QA 下拉新增' }).waitFor();
    await page.keyboard.press('Escape');
    await editor.getByRole('button', { name: /^取\s*消$/ }).click();
    await editor.waitFor({ state: 'hidden' });
    report.browser.push({ check: 'group-edit-icon-and-dropdown-create', theme, passed: true });
    await page.getByRole('menuitem', { name: /新建同步/ }).click();
    await page.getByText('正在检查目标库表清单…', { exact: true }).waitFor({ state: 'hidden' });
    const sourcePicker = page.getByRole('combobox', { name: '来源数据库', exact: true });
    await sourcePicker.focus();
    await sourcePicker.press('ArrowDown');
    await page.locator('.ant-select-dropdown:visible .ant-select-item-option').first().waitFor();
    await motionSettled(page, '.ant-select-dropdown');
    assert.deepEqual(
      await page.locator('.ant-select-dropdown:visible .ant-select-item-option').allTextContents(),
      [
        '目标服务器 1 · MySQL / shop_a',
        '目标服务器 2 · MySQL / shop_b',
        '目标服务器 3 · MySQL / shop_c',
        '测试服务器 · MySQL / shop_test',
      ],
    );
    await page.keyboard.press('Escape');
    report.browser.push({
      check: 'database-options-follow-persisted-group-and-member-order',
      theme,
      passed: true,
    });
  } catch (error) {
    await page.screenshot({
      path: path.join(repo, '.local-data', 'organization-qa-failure.png'),
      animations: 'disabled',
    });
    await fs.writeFile(
      path.join(repo, '.local-data', 'organization-qa-failure.txt'),
      await page.locator('body').innerText(),
    );
    throw error;
  } finally {
    await context.close();
  }
}
async function connectionFormQA(browser, theme) {
  const context = await browser.newContext({
    viewport: { width: 1488, height: 1056 },
    colorScheme: theme,
  });
  const page = await context.newPage();
  observe(page);
  try {
    await page.goto('http://127.0.0.1:4183/?preview=1');
    await page.getByRole('heading', { level: 1, name: '差异预览', exact: true }).waitFor();
    await page.getByRole('button', { name: '新建连接', exact: true }).first().click();
    const editor = page.getByRole('dialog', { name: '新建连接', exact: true });
    await editor.waitFor();
    await modalSettled(page);
    assert.equal(await page.locator('h1').innerText(), '差异预览');
    for (const text of [
      '请输入连接名称，例如：开发环境',
      '请输入 IP 或域名，例如：127.0.0.1',
      '请输入端口，默认 3306',
      '请输入数据库用户名',
      '请输入连接密码',
      '留空显示可访问数据库；多个库用英文逗号分隔',
    ])
      assert.equal(await editor.getByPlaceholder(text, { exact: true }).count(), 1);
    assert(
      (await editor.innerText()).includes('请选择至少一个工作区') ||
        (await editor.getByRole('combobox', { name: '关联工作区' }).count()) === 1,
    );
    assert(
      await editor
        .getByPlaceholder('请输入连接名称，例如：开发环境')
        .evaluate((element) => !element.spellcheck),
    );
    await shot(page, `connection-placeholders-${theme}`);
    await editor.getByRole('button', { name: '保存连接', exact: true }).click();
    await editor.getByText('请输入连接名称', { exact: true }).waitFor();
    await editor.getByRole('checkbox', { name: '启用 SSL，验证证书与服务器名称' }).check();
    await editor.getByPlaceholder('请选择 PEM 证书文件，留空使用系统信任').waitFor();
    await editor.getByPlaceholder('请选择 PKCS#12 证书文件，可留空').fill('C:\\QA\\client.p12');
    await editor.getByPlaceholder('请输入客户端证书密码').waitFor();
    await page.setViewportSize({ width: 1180, height: 760 });
    await editor.locator('.ant-modal-body').evaluate((element) => {
      element.scrollTop = element.scrollHeight;
    });
    const saveBounds = await editor
      .locator('.connection-dialog-footer button.ant-btn-primary')
      .boundingBox();
    assert(saveBounds && saveBounds.y + saveBounds.height <= 760);
    await shot(page, `connection-ssl-minimum-${theme}`);
    await editor.getByRole('button', { name: /^取\s*消$/ }).click();
    await editor.waitFor({ state: 'hidden' });
    assert.equal(await page.locator('h1').innerText(), '差异预览');
    const group = page.locator('.tree-label[data-node-type="group"]').first();
    await group.click({ button: 'right' });
    await page.getByRole('menuitem', { name: '新增分组', exact: true }).click();
    const create = page.getByRole('dialog', { name: '新增分组', exact: true });
    await create.getByRole('textbox', { name: '分组名称' }).fill('QA 待删除空分组');
    await create.getByRole('button', { name: /^保\s*存$/ }).click();
    await create.waitFor({ state: 'hidden' });
    const empty = page
      .locator('.tree-label[data-node-type="group"]')
      .filter({ hasText: 'QA 待删除空分组' });
    await empty.click();
    await empty.click({ button: 'right' });
    await page.getByRole('menuitem', { name: '删除分组', exact: true }).click();
    const confirmation = page.getByRole('dialog', { name: '删除分组', exact: true });
    await confirmation.waitFor();
    await shot(page, `group-delete-confirmation-${theme}`);
    await confirmation.getByRole('button', { name: /^取\s*消$/ }).click();
    await confirmation.waitFor({ state: 'hidden' });
    await empty.waitFor();
    await empty.click({ button: 'right' });
    await page.getByRole('menuitem', { name: '删除分组', exact: true }).click();
    await confirmation.getByRole('button', { name: /^删\s*除$/ }).click();
    await empty.waitFor({ state: 'detached' });
    await group.click({ button: 'right' });
    await page.getByRole('menuitem', { name: '新增分组', exact: true }).click();
    await create.getByRole('textbox', { name: '分组名称' }).fill('数据库连接');
    await create.getByRole('button', { name: /^保\s*存$/ }).click();
    await create.waitFor({ state: 'hidden' });
    const defaultGroup = page
      .locator('.tree-label[data-node-type="group"]')
      .filter({ hasText: /^数据库连接$/ });
    await defaultGroup.click({ button: 'right' });
    await page.getByRole('menuitem', { name: '删除分组', exact: true }).click();
    await confirmation.getByRole('button', { name: /^删\s*除$/ }).click();
    await defaultGroup.waitFor({ state: 'detached' });
    await confirmation.waitFor({ state: 'hidden' });
    for (const heading of ['差异预览', '新建同步', '同步历史', '设置']) {
      if (heading !== '差异预览')
        await page.getByRole('menuitem', { name: new RegExp(heading) }).click();
      const originalHeading = await page.locator('h1').innerText();
      await page.locator('aside').getByRole('button', { name: '新建连接', exact: true }).click();
      await editor.waitFor();
      await modalSettled(page);
      assert.equal(await page.locator('h1').innerText(), originalHeading);
      const groupPicker = editor.getByRole('combobox', { name: '连接分组', exact: true });
      await groupPicker.focus();
      await groupPicker.press('ArrowDown');
      const options = page.locator('.ant-select-dropdown:visible .ant-select-item-option');
      await options.first().waitFor();
      await motionSettled(page, '.ant-select-dropdown');
      assert.deepEqual(await options.allTextContents(), [
        '测试环境',
        '目标环境',
        'PostgreSQL 演示',
      ]);
      await shot(page, `connection-new-in-place-${heading}-${theme}`);
      await page.keyboard.press('Escape');
      await editor.getByRole('button', { name: /^取\s*消$/ }).click();
      await editor.waitFor({ state: 'hidden' });
      assert.equal(await page.locator('h1').innerText(), originalHeading);
      await page.locator('aside').getByRole('button', { name: '新建连接', exact: true }).click();
      await editor.waitFor();
      await modalSettled(page);
      await editor.getByPlaceholder('请输入连接名称，例如：开发环境').fill(`QA ${heading}`);
      await editor.getByPlaceholder('请输入数据库用户名').fill('qa');
      await editor.getByLabel('密码', { exact: true }).fill('fixture-only');
      await editor.getByRole('button', { name: '保存连接', exact: true }).click();
      await editor.waitFor({ state: 'hidden' });
      assert.equal(await page.locator('h1').innerText(), originalHeading);
      assert.equal(await defaultGroup.count(), 0);
      report.browser.push({
        check: 'new-connection-preserves-page-cancel-save-and-excludes-deleted-groups',
        theme,
        page: originalHeading,
        passed: true,
      });
    }
    report.browser.push({
      check: 'connection-placeholders-ssl-spellcheck-validation-and-empty-group-delete',
      theme,
      passed: true,
    });
  } finally {
    await context.close();
  }
}
async function reducedMotionModalQA(browser) {
  const context = await browser.newContext({
    viewport: { width: 1488, height: 1056 },
    colorScheme: 'light',
    reducedMotion: 'reduce',
  });
  const page = await context.newPage();
  observe(page);
  try {
    await page.goto('http://127.0.0.1:4183/?preview=1');
    await page.getByRole('heading', { level: 1, name: '差异预览', exact: true }).waitFor();
    assert(await page.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches));
    for (let index = 0; index < 2; index++) {
      await page.getByRole('button', { name: '新建连接', exact: true }).first().click();
      const dialog = page.getByRole('dialog', { name: '新建连接', exact: true });
      await dialog.waitFor();
      await dialog.getByPlaceholder('请输入连接名称，例如：开发环境').fill(`减少动态效果 ${index}`);
      if (index === 0) await shot(page, 'connection-reduced-motion');
      await dialog.getByRole('button', { name: /^取\s*消$/ }).click();
      await page.locator('.ant-modal-wrap').waitFor({ state: 'detached', timeout: 3000 });
    }
    await page.evaluate(() => {
      window.__pageAnimations = [];
      const animate = Element.prototype.animate;
      Element.prototype.animate = function (...args) {
        if (this.dataset.transition) window.__pageAnimations.push(this.dataset.transition);
        return animate.apply(this, args);
      };
    });
    await page.getByRole('menuitem', { name: /同步模板/ }).click();
    await page.getByRole('heading', { level: 1, name: '同步模板' }).waitFor();
    await page.getByRole('menuitem', { name: /同步历史/ }).click();
    await page.getByRole('heading', { level: 1, name: '同步历史' }).waitFor();
    assert.equal(
      await page.evaluate(() => window.__pageAnimations.length),
      0,
      '减少动态效果时不应播放页面动效',
    );
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await page.getByRole('menuitem', { name: /同步模板/ }).click();
    await page.waitForFunction(() =>
      window.__pageAnimations.some((identity) => identity.includes('/templates/')),
    );
    await page.getByRole('menuitem', { name: /同步历史/ }).click();
    await page.waitForFunction(() =>
      window.__pageAnimations.some((identity) => identity.includes('/history/')),
    );
    report.browser.push({
      check: 'reduced-motion-modal-twice-and-page-navigation-animation',
      passed: true,
    });
  } finally {
    await context.close();
  }
}

async function connectionActionsQA(browser, theme) {
  const context = await browser.newContext({
    viewport: { width: 1488, height: 1056 },
    colorScheme: theme,
  });
  const page = await context.newPage();
  observe(page);
  try {
    await page.goto('http://127.0.0.1:4183/?preview=1');
    await page.getByRole('heading', { level: 1, name: '差异预览', exact: true }).waitFor();
    const group = page.locator('.tree-label[data-node-type="group"]').first();
    async function menuCheck(label, type) {
      await page.waitForFunction(() => !document.querySelector('.ant-tree-treenode-motion'));
      await label.click({ button: 'right', position: { x: 10, y: 10 } });
      const anchor = {
        group: '编辑分组',
        connection: '编辑连接',
        database: '导出表结构…',
        table: '查看表结构',
      }[type];
      const menu = page
        .locator('.ant-dropdown:visible')
        .filter({ has: page.getByRole('menuitem', { name: anchor, exact: true }) })
        .last();
      await menu.waitFor();
      const items = menu.locator('.ant-dropdown-menu-item:not(.ant-dropdown-menu-item-divider)');
      await items.nth({ group: 5, connection: 5, database: 4, table: 4 }[type] - 1).waitFor();
      const icons = await items.evaluateAll((operations) =>
        operations.map((item) => ({
          name: item.textContent,
          hasIcon: !!item.querySelector('.ant-dropdown-menu-item-icon'),
        })),
      );
      assert.equal(icons.length, { group: 5, connection: 5, database: 4, table: 4 }[type]);
      for (const item of icons) assert(item.hasIcon, `${type}: missing menu icon on ${item.name}`);
      await shot(page, `context-${type}-${theme}`);
      await page.keyboard.press('Escape');
      await page.getByRole('heading', { level: 1, name: '差异预览', exact: true }).click();
      report.browser.push({ check: `context-menu-icons-${type}`, theme, passed: true });
    }
    await menuCheck(group, 'group');
    const rowFor = (label) => label.locator('xpath=ancestor::*[@role="treeitem"][1]');
    await rowFor(group).locator('.ant-tree-switcher').click();
    const connection = page.locator('.tree-label[data-connection-id="test"]');
    await connection.waitFor();
    await menuCheck(connection, 'connection');
    await rowFor(connection).locator('.ant-tree-switcher').click();
    const database = page.locator('.tree-label[data-node-type="database"]').first();
    await database.waitFor();
    await menuCheck(database, 'database');
    await rowFor(database).locator('.ant-tree-switcher').click();
    const table = page.locator('.tree-label[data-node-type="table"]').first();
    await table.waitFor();
    await menuCheck(table, 'table');
    await page
      .locator('.sidebar-label')
      .getByRole('button', { name: '数据库连接', exact: true })
      .click();
    assert.equal(await page.getByRole('button', { name: '编辑分组', exact: true }).count(), 0);
    const row = page
      .getByRole('row')
      .filter({ has: page.getByRole('button', { name: '编辑连接 测试服务器', exact: true }) });
    const test = row.getByRole('button', { name: '测试连接 测试服务器', exact: true });
    assert.deepEqual(
      (await row.getByRole('button').allTextContents()).map((text) => text.replace(/\s/g, '')),
      ['测试连接', '编辑', '删除'],
    );
    assert.equal(await row.getByRole('button', { name: /更换分组/ }).count(), 0);
    async function layoutCheck(state) {
      const layout = await row.locator('.connection-actions-scroll').evaluate((el) => {
        const buttons = [...el.querySelectorAll('button')].map((button) =>
          button.getBoundingClientRect(),
        );
        const cell = el.closest('td').getBoundingClientRect();
        const scroll = el.getBoundingClientRect();
        return {
          tops: buttons.map((b) => b.top),
          bottom: Math.max(...buttons.map((b) => b.bottom)),
          scrollBottom: scroll.bottom,
          clippedInsideCell: scroll.left >= cell.left && scroll.right <= cell.right,
          overflow: el.scrollWidth > el.clientWidth,
        };
      });
      assert(Math.max(...layout.tops) - Math.min(...layout.tops) <= 1, `${state}: buttons wrapped`);
      assert(
        layout.bottom <= layout.scrollBottom + 1 && layout.clippedInsideCell,
        `${state}: buttons overlap`,
      );
      report.browser.push({ check: `connection-actions-${state}`, theme, ...layout });
    }
    await test.click();
    await layoutCheck('testing');
    await row.locator('.connection-test-button.test-success').waitFor();
    assert.equal(await row.locator('.connection-test-feedback').count(), 0);
    assert.match(
      await row.locator('.visually-hidden[role="status"]').innerText(),
      /连接成功.*8.4.8/,
    );
    await page.mouse.move(20, 20);
    await test.focus();
    await page.getByRole('tooltip').filter({ hasText: '连接成功' }).waitFor();
    assert.match(await page.getByRole('tooltip').innerText(), /8.4.8.*虚构预览数据.*点击再次测试/);
    await test.blur();
    await test.hover();
    await page.getByRole('tooltip').waitFor();
    await shot(page, `connection-test-tooltip-${theme}`);
    await page.mouse.move(20, 20);
    for (const width of [1488, 1180, 900]) {
      await page.setViewportSize({ width, height: 760 });
      await layoutCheck(`success-${width}`);
      assert(
        await row
          .locator('.connection-actions-scroll')
          .evaluate((el) => el.scrollWidth <= el.clientWidth),
        `unexpected action scrollbar at ${width}`,
      );
    }
    const resize = page.getByRole('separator', { name: '调整操作宽度', exact: true });
    await resize.focus();
    for (let i = 0; i < 25; i++) await resize.press('ArrowLeft');
    await layoutCheck('narrow-column');
    assert(
      await row
        .locator('.connection-actions-scroll')
        .evaluate((el) => el.scrollWidth > el.clientWidth),
    );
    await row.locator('.connection-actions-scroll').evaluate((el) => {
      el.scrollLeft = el.scrollWidth;
    });
    await row.getByRole('button', { name: '编辑连接 测试服务器', exact: true }).click();
    const editor = page.getByRole('dialog', { name: '编辑连接', exact: true });
    await modalSettled(page);
    assert.equal(await editor.getByLabel('密码', { exact: true }).inputValue(), '********');
    await editor.getByLabel('密码', { exact: true }).fill('preview-fail');
    await editor.getByRole('button', { name: '保存连接', exact: true }).click();
    await editor.waitFor({ state: 'hidden' });
    // Restore a readable column before checking the complete failure message.
    await resize.focus();
    for (let i = 0; i < 27; i++) await resize.press('ArrowRight');
    await test.click();
    assert.equal(await row.locator('.test-success').count(), 0);
    await row.locator('.connection-test-feedback.test-error').waitFor();
    assert.match(
      await row.locator('.connection-test-feedback').innerText(),
      /连接失败.*密码验证失败/,
    );
    await layoutCheck('failure');
    await shot(page, `connection-test-failure-${theme}`);
    await page.setViewportSize({ width: 1488, height: 1056 });
    await page.getByRole('button', { name: '管理工作区', exact: true }).click();
    await page.getByRole('heading', { level: 1, name: '工作区管理', exact: true }).waitFor();
    assert.equal(await page.getByRole('dialog').count(), 0);
    const workspaceRow = page
      .getByRole('row')
      .filter({ has: page.getByRole('button', { name: '编辑工作区 跨境电商项目', exact: true }) });
    await workspaceRow
      .getByRole('button', { name: '编辑工作区 跨境电商项目', exact: true })
      .click();
    const workspaceEditor = page.getByRole('dialog', { name: '编辑工作区', exact: true });
    await modalSettled(page);
    assert.equal(
      await workspaceEditor.getByLabel('工作区名称', { exact: true }).getAttribute('placeholder'),
      '请输入工作区名称，例如：业务系统',
    );
    assert.equal(
      await workspaceEditor.getByLabel('说明', { exact: true }).getAttribute('placeholder'),
      '请输入工作区说明（选填）',
    );
    assert.equal(await workspaceEditor.getByRole('checkbox').count(), 0);
    await workspaceEditor.getByRole('combobox', { name: '关联连接', exact: true }).click();
    await page
      .locator('.ant-select-dropdown:visible .ant-select-item-option')
      .filter({ hasText: '目标服务器 1' })
      .click();
    await page.keyboard.press('Escape');
    assert.equal(await workspaceEditor.getByRole('button', { name: /删\s*除/ }).count(), 0);
    await workspaceEditor.getByLabel('工作区名称', { exact: true }).fill('未保存草稿');
    await shot(page, `workspace-edit-${theme}`);
    await workspaceEditor.getByRole('button', { name: /^取\s*消$/ }).click();
    await workspaceEditor.waitFor({ state: 'hidden' });
    await workspaceRow.getByText('跨境电商项目', { exact: true }).click();
    await workspaceRow.getByText('跨境电商项目', { exact: true }).dblclick();
    assert.equal(await page.getByRole('dialog').count(), 0);
    await workspaceRow
      .getByRole('button', { name: '编辑工作区 跨境电商项目', exact: true })
      .click();
    assert.equal(
      await workspaceEditor.getByLabel('工作区名称', { exact: true }).inputValue(),
      '跨境电商项目',
    );
    await workspaceEditor.getByLabel('工作区名称', { exact: true }).fill('QA 工作区');
    await workspaceEditor.getByRole('button', { name: '保存工作区', exact: true }).click();
    await workspaceEditor.waitFor({ state: 'hidden' });
    await page.getByRole('cell', { name: 'QA 工作区', exact: true }).waitFor();
    await shot(page, `workspace-list-${theme}`);
    await page.getByRole('button', { name: /新建工作区/ }).click();
    const newWorkspace = page.getByRole('dialog', { name: '新建工作区', exact: true });
    await modalSettled(page);
    assert.equal(
      await newWorkspace.getByLabel('工作区名称', { exact: true }).getAttribute('placeholder'),
      '请输入工作区名称，例如：业务系统',
    );
    assert.equal(
      await newWorkspace.getByLabel('说明', { exact: true }).getAttribute('placeholder'),
      '请输入工作区说明（选填）',
    );
    assert.equal(await newWorkspace.getByText('选择关联连接', { exact: true }).count(), 1);
    await shot(page, `workspace-create-placeholders-${theme}`);
    assert.equal(await newWorkspace.getByLabel('工作区名称', { exact: true }).inputValue(), '');
    await newWorkspace.getByRole('button', { name: /^取\s*消$/ }).click();
    report.browser.push({
      check: 'workspace-list-button-only-edit-save-cancel-and-create',
      theme,
      passed: true,
    });
    await page.getByRole('menuitem', { name: /同步模板/ }).click();
    await page.getByRole('heading', { level: 1, name: '同步模板', exact: true }).waitFor();
    assert.equal(await page.getByRole('dialog').count(), 0);
    const templateRow = page
      .getByRole('row')
      .filter({ has: page.getByRole('button', { name: '编辑模板 基础字典与菜单', exact: true }) });
    await templateRow.getByRole('button', { name: '编辑模板 基础字典与菜单', exact: true }).click();
    const templateEditor = page.getByRole('dialog', { name: '编辑同步模板', exact: true });
    await modalSettled(page);
    assert.equal(await templateEditor.getByRole('button', { name: /删\s*除/ }).count(), 0);
    await templateEditor.getByLabel('模板名称', { exact: true }).fill('未保存模板');
    await shot(page, `template-edit-${theme}`);
    const bounds = await templateEditor
      .getByRole('button', { name: '保存模板', exact: true })
      .boundingBox();
    assert(bounds.y + bounds.height < 1056);
    await templateEditor.getByRole('button', { name: /^取\s*消$/ }).click();
    await templateEditor.waitFor({ state: 'hidden' });
    await templateRow.getByText('基础字典与菜单', { exact: true }).click();
    await templateRow.getByText('基础字典与菜单', { exact: true }).dblclick();
    assert.equal(await page.getByRole('dialog').count(), 0);
    await templateRow.getByRole('button', { name: '编辑模板 基础字典与菜单', exact: true }).click();
    assert.equal(
      await templateEditor.getByLabel('模板名称', { exact: true }).inputValue(),
      '基础字典与菜单',
    );
    await templateEditor.getByLabel('模板名称', { exact: true }).fill('QA 保存模板');
    await templateEditor.getByRole('button', { name: '保存模板', exact: true }).click();
    await templateEditor.waitFor({ state: 'hidden' });
    await page.getByRole('cell', { name: 'QA 保存模板', exact: true }).waitFor();
    await shot(page, `template-list-${theme}`);
    await page.getByRole('button', { name: /新建模板/ }).click();
    const templateCreator = page.getByRole('dialog', { name: '新建同步模板', exact: true });
    assert.equal(await templateCreator.getByLabel('模板名称', { exact: true }).inputValue(), '');
    await templateCreator.getByRole('button', { name: /^取\s*消$/ }).click();
    report.browser.push({
      check: 'template-list-button-only-edit-save-cancel-create-and-external-delete',
      theme,
      passed: true,
    });
  } finally {
    await context.close();
  }
}
async function contextFeedbackQA(browser, theme) {
  const context = await browser.newContext({
    viewport: { width: 1488, height: 1056 },
    colorScheme: theme,
  });
  const page = await context.newPage();
  observe(page);
  // Delay only the preview fixture's database/test calls, leaving UI timers intact.
  await page.addInitScript(() => {
    const original = window.setTimeout.bind(window);
    window.setTimeout = (fn, ms, ...args) =>
      original(fn, window.__qaDelay && [150, 200, 350].includes(ms) ? 1400 : ms, ...args);
  });
  try {
    await page.goto('http://127.0.0.1:4183/?preview=1');
    await page.getByRole('heading', { level: 1, name: '差异预览', exact: true }).waitFor();
    const rowFor = (label) => label.locator('xpath=ancestor::*[@role="treeitem"][1]');
    await rowFor(page.locator('.tree-label[data-node-type="group"]').first())
      .locator('.ant-tree-switcher')
      .click();
    const connection = page.locator('.tree-label[data-connection-id="test"]');
    await connection.waitFor();
    await page.waitForFunction(() => !document.querySelector('.ant-tree-treenode-motion'));
    await rowFor(connection).locator('.ant-tree-switcher').click();
    const database = page.locator('.tree-label[data-node-key="test/shop_test"]');
    await database.waitFor();
    const menu = page.locator('.ant-dropdown:visible');
    const item = (name) => menu.getByRole('menuitem', { name: new RegExp('^' + name) });
    let openedKey;
    const open = async (node) => {
      const key = await node.getAttribute('data-node-key');
      if (openedKey !== key) {
        await page.keyboard.press('Escape');
        await menu.waitFor({ state: 'hidden' });
      }
      openedKey = key;
      await node.click({ button: 'right', position: { x: 10, y: 10 } });
      await menu.waitFor();
    };
    const checkIdle = async (operation) => {
      assert.equal(
        await operation.locator('.anticon-check,.anticon-close,.anticon-loading').count(),
        0,
      );
      await page.mouse.move(20, 20);
      await operation.hover();
      await page.waitForTimeout(150);
      assert.equal(await page.getByRole('tooltip').count(), 0);
    };
    await open(connection);
    const testStarted = Date.now();
    await item('测试连接').click();
    await item('测试连接').locator('.anticon-check').waitFor();
    assert(Date.now() - testStarted >= 300);
    assert(await menu.isVisible());
    await page.mouse.move(20, 20);
    await item('测试连接').hover();
    await page.getByRole('tooltip').filter({ hasText: '连接成功' }).waitFor();
    await shot(page, `context-test-success-${theme}`);
    const testColor = await item('测试连接')
      .locator('.refresh-menu-result')
      .evaluate((el) => getComputedStyle(el).color);
    const refreshStarted = Date.now();
    await item('刷新数据库').click();
    await item('刷新数据库').locator('.anticon-check').waitFor();
    assert(Date.now() - refreshStarted >= 300);
    assert.equal(
      await item('刷新数据库')
        .locator('.refresh-menu-result')
        .evaluate((el) => getComputedStyle(el).color),
      testColor,
    );
    await page.mouse.move(20, 20);
    await item('刷新数据库').hover();
    await page.getByRole('tooltip').filter({ hasText: '数据库成功' }).waitFor();
    await shot(page, `context-refresh-success-${theme}`);
    await open(connection);
    await checkIdle(item('测试连接'));
    await checkIdle(item('刷新数据库'));
    await page.evaluate(() => {
      window.__qaDelay = true;
    });
    for (const name of ['测试连接', '刷新数据库']) {
      await item(name).click();
      await item(name).locator('.anticon-loading').waitFor();
      assert.equal(await item(name).getAttribute('aria-disabled'), 'true');
      await open(connection);
      await item(name).locator('.anticon-loading').waitFor({ state: 'hidden' });
      await checkIdle(item(name));
    }
    await open(database);
    const tablesStarted = Date.now();
    await item('刷新数据表').click();
    await item('刷新数据表').locator('.anticon-loading').waitFor();
    await open(database);
    await item('刷新数据表').locator('.anticon-loading').waitFor({ state: 'hidden' });
    assert(Date.now() - tablesStarted >= 300);
    await checkIdle(item('刷新数据表'));
    await page.evaluate(() => {
      window.__qaDelay = false;
    });
    await item('刷新数据表').click();
    await item('刷新数据表').locator('.anticon-check').waitFor();
    await item('刷新数据表').locator('.refresh-menu-result').focus();
    await page.getByRole('tooltip').filter({ hasText: '数据表成功' }).waitFor();
    await shot(page, `context-table-refresh-${theme}`);
    await page.keyboard.press('Escape');
    await menu.waitFor({ state: 'hidden' });
    // Edit in place in both the difference view and the scope view.
    for (const heading of ['差异预览', '新建同步']) {
      if (heading === '新建同步')
        await page.getByRole('button', { name: '上一步', exact: true }).click();
      await open(connection);
      await item('编辑连接').click();
      const editor = page.getByRole('dialog', { name: '编辑连接', exact: true });
      await editor.waitFor();
      await modalSettled(page);
      assert.equal(await page.locator('h1').innerText(), heading);
      await shot(
        page,
        `connection-edit-in-place-${heading === '差异预览' ? 'diff' : 'scope'}-${theme}`,
      );
      if (heading === '差异预览') await editor.getByRole('button', { name: /^取\s*消$/ }).click();
      else await editor.getByRole('button', { name: '保存连接', exact: true }).click();
      await editor.waitFor({ state: 'hidden' });
      assert.equal(await page.locator('h1').innerText(), heading);
    }
    const syncRefresh = page.getByRole('button', { name: '刷新数据库', exact: true });
    await syncRefresh.click();
    await syncRefresh.locator('.anticon-check').waitFor();
    const before = await syncRefresh.getAttribute('class');
    await page.evaluate(() => {
      window.__qaDelay = true;
    });
    await open(connection);
    await item('刷新数据库').click();
    await item('刷新数据库').locator('.anticon-loading').waitFor();
    assert.equal(await syncRefresh.getAttribute('class'), before);
    await item('刷新数据库').locator('.anticon-check').waitFor();
    assert.equal(await syncRefresh.getAttribute('class'), before);
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: '将当前范围保存为模板', exact: true }).click();
    const template = page.getByRole('dialog', { name: '新建同步模板', exact: true });
    await template.waitFor();
    const templateRefresh = template.getByRole('button', { name: '刷新数据库', exact: true });
    await checkIdle(templateRefresh);
    await modalSettled(page);
    await Promise.all([
      page.waitForFunction(() => document.querySelector('.ant-modal .ant-btn-loading')),
      templateRefresh.click(),
    ]);
    assert.equal(await syncRefresh.getAttribute('class'), before);
    await templateRefresh.locator('.anticon-check').waitFor();
    await shot(page, `refresh-module-isolation-${theme}`);
    await template.getByRole('button', { name: /^取\s*消$/ }).click();
    await template.waitFor({ state: 'hidden' });
    await open(database);
    await item('导出表结构').click();
    await page.getByRole('heading', { level: 1, name: '导出表结构', exact: true }).waitFor();
    await checkIdle(page.getByRole('button', { name: '刷新数据库', exact: true }));
    await page.evaluate(() => {
      window.__qaDelay = false;
    });
    await open(connection);
    await item('测试连接').click();
    await item('测试连接').locator('.anticon-check').waitFor();
    await page.keyboard.press('Escape');
    await page
      .locator('.sidebar-label')
      .getByRole('button', { name: '数据库连接', exact: true })
      .click();
    const row = page
      .getByRole('row')
      .filter({ has: page.getByRole('button', { name: '编辑连接 测试服务器', exact: true }) });
    await checkIdle(row.getByRole('button', { name: '测试连接 测试服务器', exact: true }));
    // Saved fixture password drives real preview errors without altering application logic.
    await row.getByRole('button', { name: '编辑连接 测试服务器', exact: true }).click();
    const editor = page.getByRole('dialog', { name: '编辑连接', exact: true });
    await modalSettled(page);
    await editor.getByLabel('密码', { exact: true }).fill('preview-fail');
    await editor.getByRole('button', { name: '保存连接', exact: true }).click();
    await editor.waitFor({ state: 'hidden' });
    await open(connection);
    await item('测试连接').click();
    await item('测试连接').locator('.anticon-close').waitFor();
    await page.mouse.move(20, 20);
    await item('测试连接').hover();
    await page.getByRole('tooltip').filter({ hasText: '密码验证失败' }).waitFor();
    await shot(page, `context-test-failure-${theme}`);
    await item('刷新数据库').click();
    await item('刷新数据库').locator('.anticon-close').waitFor();
    await page.mouse.move(20, 20);
    await item('刷新数据库').hover();
    await page.getByRole('tooltip').filter({ hasText: '数据库失败' }).waitFor();
    await shot(page, `context-refresh-failure-${theme}`);
    await open(connection);
    await checkIdle(item('测试连接'));
    await checkIdle(item('刷新数据库'));
    report.browser.push({
      check: 'context-feedback-session-isolation-and-in-place-edit',
      theme,
      passed: true,
    });
  } catch (error) {
    await page.screenshot({
      path: path.join(repo, '.local-data', `context-qa-failure-${theme}.png`),
      animations: 'disabled',
    });
    await fs.writeFile(
      path.join(repo, '.local-data', `context-qa-failure-${theme}.txt`),
      await page.locator('body').innerText(),
    );
    throw error;
  } finally {
    await context.close();
  }
}
async function refreshAndTemplateQA(browser, theme) {
  const context = await browser.newContext({
    viewport: { width: 1488, height: 1056 },
    colorScheme: theme,
  });
  const page = await context.newPage();
  observe(page);
  try {
    await page.goto('http://127.0.0.1:4183/?preview=1');
    await page.getByRole('heading', { level: 1, name: '差异预览', exact: true }).waitFor();
    await page.getByRole('button', { name: '上一步', exact: true }).click();
    const refresh = page.getByRole('button', { name: '刷新数据库', exact: true });
    for (let i = 0; i < 2; i++) {
      await refresh.click();
      await page.waitForFunction(() =>
        document
          .querySelector('.bottom-gap .connection-test-button')
          ?.classList.contains('ant-btn-loading'),
      );
      assert.equal(await refresh.locator('.anticon-check').count(), 0);
      await refresh.locator('.anticon-check').waitFor();
      assert.equal(await refresh.isEnabled(), true);
    }
    await page.mouse.move(20, 20);
    await refresh.hover();
    await page.getByRole('tooltip').filter({ hasText: '刷新数据库成功' }).waitFor();
    await shot(page, `refresh-success-${theme}`);
    await page.mouse.move(20, 20);
    await refresh.focus();
    await page.getByRole('tooltip').filter({ hasText: '刷新数据库成功' }).waitFor();
    await refresh.blur();
    await page.mouse.move(20, 20);
    const targets = page.getByRole('button', { name: '刷新目标表清单', exact: true });
    await targets.click();
    await targets.locator('.anticon-check').waitFor();
    await targets.click();
    await targets.locator('.anticon-check').waitFor();
    assert.equal(
      await page
        .locator('.scope-template-toolbar')
        .getByRole('button', { name: '将当前范围保存为模板', exact: true })
        .count(),
      0,
    );
    await page.getByRole('button', { name: '将当前范围保存为模板', exact: true }).click();
    const editor = page.getByRole('dialog', { name: '新建同步模板', exact: true });
    await modalSettled(page);
    await page.getByRole('heading', { level: 1, name: '新建同步', exact: true }).waitFor();
    await shot(page, `template-save-in-scope-${theme}`);
    await editor.getByRole('button', { name: /^取\s*消$/ }).click();
    await editor.waitFor({ state: 'hidden' });
    await page.getByRole('heading', { level: 1, name: '新建同步', exact: true }).waitFor();
    await page.getByRole('button', { name: '将当前范围保存为模板', exact: true }).click();
    await modalSettled(page);
    await editor.getByLabel('模板名称', { exact: true }).fill('QA 第二模板');
    await editor.getByRole('button', { name: '保存模板', exact: true }).click();
    await editor.waitFor({ state: 'hidden' });
    await page.getByRole('heading', { level: 1, name: '新建同步', exact: true }).waitFor();
    report.browser.push({
      check: 'save-current-scope-template-without-navigation',
      theme,
      passed: true,
    });
    const choose = page.getByRole('combobox', { name: '选择同步模板', exact: true });
    await choose.click();
    await page
      .locator('.ant-select-dropdown:visible .ant-select-item-option')
      .filter({ hasText: 'QA 第二模板' })
      .click();
    assert.equal(await page.getByText('已应用：QA 第二模板', { exact: true }).count(), 0);
    const apply = page.getByRole('button', { name: '应用模板', exact: true });
    await apply.click();
    await page.getByText('已应用：QA 第二模板', { exact: true }).waitFor();
    assert(await page.getByRole('radio', { name: '已选表', exact: true }).isChecked());
    await page.getByRole('button', { name: '再次应用模板', exact: true }).waitFor();
    for (const width of [1904, 1488, 1180, 900]) {
      await page.setViewportSize({ width, height: 1056 });
      const geometry = await page.locator('.scope-template-toolbar').evaluate((toolbar) => {
        const select = toolbar.querySelector('.ant-select').getBoundingClientRect();
        const actions = [...toolbar.querySelectorAll('.scope-template-actions button')].map(
          (button) => button.getBoundingClientRect(),
        );
        return {
          selectWidth: select.width,
          centers: actions.map((button) =>
            button.top < select.bottom && button.bottom > select.top
              ? Math.abs(button.top + button.height / 2 - select.top - select.height / 2)
              : 0,
          ),
          overlap: actions.some(
            (button) => button.left < select.right && button.top < select.bottom,
          ),
        };
      });
      assert(geometry.selectWidth >= 220);
      assert(
        geometry.centers.every((delta) => delta <= 1),
        JSON.stringify(geometry),
      );
      assert.equal(geometry.overlap, false);
      report.browser.push({
        check: 'template-toolbar-vertical-alignment',
        theme,
        width,
        passed: true,
      });
    }
    await page.setViewportSize({ width: 1488, height: 1056 });
    await shot(page, `template-apply-${theme}`);
    await page
      .locator('.sidebar-label')
      .getByRole('button', { name: '数据库连接', exact: true })
      .click();
    await page.getByRole('button', { name: '编辑连接 测试服务器', exact: true }).click();
    const connection = page.getByRole('dialog', { name: '编辑连接', exact: true });
    await modalSettled(page);
    await connection.getByLabel('密码', { exact: true }).fill('preview-fail');
    await connection.getByRole('button', { name: '保存连接', exact: true }).click();
    await connection.waitFor({ state: 'hidden' });
    await page.getByRole('menuitem', { name: /新建同步/ }).click();
    await page.waitForFunction(() => !document.querySelector('.bottom-gap .ant-btn-loading'));
    for (let i = 0; i < 2; i++) {
      await refresh.click();
      await refresh.locator('.anticon-close').waitFor();
      assert.equal(await refresh.isEnabled(), true);
    }
    await page.mouse.move(20, 20);
    await refresh.hover();
    await page.getByRole('tooltip').filter({ hasText: '密码验证失败' }).waitFor();
    await shot(page, `refresh-failure-${theme}`);
    report.browser.push({
      check: 'refresh-success-and-failure-repeat-loading-hover-focus-and-searchable-template-apply',
      theme,
      passed: true,
    });
  } catch (error) {
    await page.screenshot({
      path: path.join(repo, '.local-data', 'refresh-qa-failure.png'),
      animations: 'disabled',
    });
    await fs.writeFile(
      path.join(repo, '.local-data', 'refresh-qa-failure.txt'),
      await page.locator('body').innerText(),
    );
    throw error;
  } finally {
    await context.close();
  }
}
async function templateWorkspaceQA(browser, theme) {
  const context = await browser.newContext({
    viewport: { width: 1180, height: 760 },
    colorScheme: theme,
  });
  const page = await context.newPage();
  observe(page);
  try {
    await page.goto('http://127.0.0.1:4183/?preview=1');
    await page.getByRole('heading', { level: 1, name: '差异预览', exact: true }).waitFor();
    await page.getByText('remark', { exact: true }).first().waitFor();
    await page.getByRole('button', { name: '管理工作区', exact: true }).click();
    await page.getByRole('heading', { level: 1, name: '工作区管理', exact: true }).waitFor();
    await page.getByRole('button', { name: '编辑工作区 跨境电商项目', exact: true }).click();
    const editor = page.getByRole('dialog', { name: '编辑工作区', exact: true });
    await editor.waitFor();
    await modalSettled(page);
    await editor.getByLabel('工作区名称', { exact: true }).fill('');
    await editor.getByLabel('说明', { exact: true }).fill('');
    for (const [dialog, mode] of [
      [editor, 'edit'],
      [null, 'create'],
    ]) {
      if (!dialog) await page.getByRole('button', { name: /新建工作区/ }).click();
      const form = dialog || page.getByRole('dialog', { name: '新建工作区', exact: true });
      await modalSettled(page);
      assert.equal(
        await form.getByLabel('工作区名称', { exact: true }).getAttribute('placeholder'),
        '请输入工作区名称，例如：业务系统',
      );
      assert.equal(
        await form.getByLabel('说明', { exact: true }).getAttribute('placeholder'),
        '请输入工作区说明（选填）',
      );
      if (!dialog) assert.equal(await form.getByText('选择关联连接', { exact: true }).count(), 1);
      await shot(page, `workspace-${mode}-placeholders-${theme}`);
      await form.getByRole('button', { name: /^取\s*消$/ }).click();
      await form.waitFor({ state: 'hidden' });
      report.browser.push({ check: `workspace-${mode}-placeholders-minimum`, theme, passed: true });
    }
    await page.getByRole('menuitem', { name: /同步模板/ }).click();
    await page.getByRole('button', { name: '应用模板 基础字典与菜单', exact: true }).click();
    await page.getByText('已应用：基础字典与菜单', { exact: true }).waitFor();
    const selected = page.getByRole('radio', { name: '已选表', exact: true });
    assert(await selected.isChecked());
    assert.equal(
      await page.locator('.scope-table').getByText('orders', { exact: true }).count(),
      0,
    );
    await page.locator('.scope-table-search').scrollIntoViewIfNeeded();
    await shot(page, `template-selected-tables-minimum-${theme}`);
    await footerCheck(page, `template-selected-tables-minimum-${theme}`);
    await page.locator('.scope-table-search').getByText('全部表', { exact: true }).click();
    await page.locator('.scope-table').getByText('orders', { exact: true }).waitFor();
    await page.getByRole('button', { name: '再次应用模板', exact: true }).click();
    await page.getByText('已应用：基础字典与菜单', { exact: true }).waitFor();
    assert(await selected.isChecked());
    report.browser.push({
      check: 'apply-and-reapply-template-selects-selected-table-filter',
      theme,
      passed: true,
    });
  } finally {
    await context.close();
  }
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
  let browser, lastPage;
  try {
    for (let attempt = 0; attempt < 60; attempt++) {
      if (vite.exitCode !== null)
        throw new Error('UI QA 预览服务已退出，请确认 4183 端口未被其他验收占用');
      try {
        if ((await fetch('http://127.0.0.1:4183')).ok) break;
      } catch {}
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    browser = await chromium.launch({ headless: true, executablePath });
    if (process.argv.includes('--navigation')) {
      await navigationQA(browser, { desktop, report, observe, shot, modalSettled });
      return;
    }
    if (process.argv.includes('--motion')) {
      await motionQA(browser, { desktop, report, observe, shot, modalSettled });
      return;
    }
    if (process.argv.includes('--interaction-revisions')) {
      await interactionRevisionsQA(browser, { desktop, report, observe, shot, modalSettled });
      return;
    }
    if (process.argv.includes('--multi-database')) {
      await multiDatabaseQA(browser, { report, observe, shot, modalSettled });
      return;
    }
    if (process.argv.includes('--updates')) {
      await updatesQA(browser, { repo, report, observe, shot, footerCheck });
      return;
    }
    if (process.argv.includes('--record-confirmation')) {
      await recordConfirmationQA(browser, {
        desktop,
        report,
        observe,
        shot,
        modalSettled,
        footerCheck,
      });
      return;
    }
    if (process.argv.includes('--connection-form')) {
      for (const theme of ['light', 'dark']) await connectionFormQA(browser, theme);
      return;
    }
    if (process.argv.includes('--reduced-motion')) {
      await reducedMotionModalQA(browser);
      return;
    }
    if (process.argv.includes('--performance')) {
      await performanceQA(browser, { repo, report, observe, shot, footerCheck });
      return;
    }
    if (process.argv.includes('--diff-scroll')) {
      for (const theme of ['light', 'dark']) await longDiffQA(browser, theme);
      return;
    }
    if (process.argv.includes('--tree-organization')) {
      for (const theme of ['light', 'dark']) await organizationQA(browser, theme);
      return;
    }
    if (process.argv.includes('--context-feedback')) {
      for (const theme of ['light', 'dark']) await contextFeedbackQA(browser, theme);
      return;
    }
    if (process.argv.includes('--template-workspace')) {
      for (const theme of ['light', 'dark']) {
        await templateWorkspaceQA(browser, theme);
      }
      return;
    }
    if (process.argv.includes('--sync-modes')) {
      for (const theme of ['light', 'dark']) {
        await syncModeQA(browser, theme);
        await selectedScopeQA(browser, theme);
      }
      return;
    }
    for (const mode of ['light', 'dark']) {
      await longDiffQA(browser, mode);
      const context = await browser.newContext({
        viewport: { width: 1488, height: 1056 },
        colorScheme: mode,
      });
      const page = await context.newPage();
      lastPage = page;
      observe(page);
      await page.goto('http://127.0.0.1:4183/?preview=1');
      await page.getByRole('heading', { level: 1, name: '差异预览', exact: true }).waitFor();
      await page.getByText('remark', { exact: true }).first().waitFor();
      assert.equal(await page.title(), 'DBAligner');
      assert(
        await page.getByText('浏览器交互预览 · 所有驱动安装、同步与恢复均为内存模拟').isVisible(),
      );
      await shot(page, `diff-${mode}`);
      const first = page.getByRole('checkbox', { name: '选择 remark', exact: true });
      await first.uncheck();
      assert(!(await first.isChecked()), 'remark selection did not clear');
      await first.check();
      assert.equal(await page.getByRole('tab', { name: '基础数据', exact: true }).count(), 0);
      assert.equal(await page.getByText('idx_code', { exact: true }).count(), 0);
      report.browser.push({
        check: `preview-showcase-current-structure-defaults-${mode}`,
        passed: true,
      });
      await page.getByRole('menuitem', { name: /设置/ }).click();
      await page.getByRole('heading', { level: 1, name: '设置', exact: true }).waitFor();
      await page.getByText(mode === 'dark' ? '深色' : '浅色', { exact: true }).click();
      await page.locator(`[data-theme="${mode}"]`).waitFor();
      assert(
        await page
          .getByText('DBAligner · 数据库结构与基础数据同步工具 · 开源许可 Apache-2.0', {
            exact: true,
          })
          .isVisible(),
      );
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
      lastPage = page;
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
      lastPage = page;
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
                el.querySelector('.tree-label')?.getAttribute('title') === label &&
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
      report.browser.push({ check: 'lazy-tree-single-table-sections', passed: true });
      await page.getByRole('button', { name: '导出表结构', exact: true }).click();
      await page.getByRole('heading', { level: 1, name: '导出表结构', exact: true }).waitFor();
      await page.getByText('仅 CREATE TABLE', { exact: true }).waitFor();
      assert(
        !(await page.locator('.sql-view').innerText()).includes('CREATE TABLE'),
        'single-table entry should wait for manual generation',
      );
      await page.getByRole('button', { name: /生成预览 SQL/ }).click();
      await page.waitForFunction(() =>
        document.querySelector('.sql-view').innerText.includes('CREATE TABLE'),
      );
      assert(
        !(await page
          .locator('.sql-view')
          .innerText()
          .then((text) => text.includes('DROP TABLE'))),
        'default export includes DROP',
      );
      await page.getByText('包含 DROP TABLE', { exact: true }).click();
      assert(
        !(await page.locator('.sql-view').innerText()).includes('CREATE TABLE'),
        'changing DROP must clear the previous preview',
      );
      await page.getByRole('button', { name: /生成预览 SQL/ }).click();
      await page.waitForFunction(() =>
        document.querySelector('.sql-view').innerText.includes('DROP TABLE'),
      );
      report.browser.push({ check: 'schema-export-default-and-drop-preview', passed: true });
      await page.getByRole('menuitem', { name: /同步模板/ }).click();
      await page.getByRole('heading', { level: 1, name: '同步模板', exact: true }).waitFor();
      await page.getByRole('button', { name: '编辑模板 基础字典与菜单', exact: true }).click();
      const templateName = page.getByRole('textbox', { name: '模板名称' });
      await templateName.fill('QA 模板草稿');
      await page
        .getByRole('dialog', { name: '编辑同步模板' })
        .getByRole('button', { name: /^取\s*消$/ })
        .click();
      await page.getByRole('cell', { name: '基础字典与菜单', exact: true }).dblclick();
      assert.equal(await page.getByRole('dialog').count(), 0);
      await page.getByRole('button', { name: '编辑模板 基础字典与菜单', exact: true }).click();
      assert.equal(await templateName.inputValue(), '基础字典与菜单');
      await page
        .getByRole('dialog', { name: '编辑同步模板' })
        .getByRole('button', { name: /^取\s*消$/ })
        .click();
      await page.getByRole('button', { name: '应用模板 基础字典与菜单', exact: true }).click();
      await page.getByRole('heading', { level: 1, name: '新建同步', exact: true }).waitFor();
      await page.getByText('目标缺失', { exact: true }).first().waitFor();
      assert(await page.getByRole('radio', { name: '已选表', exact: true }).isChecked());
      await shot(page, `template-selected-tables-${workflowTheme}`);
      report.browser.push({ check: 'missing-target-scope-indication', passed: true });
      assert.equal(await page.getByRole('textbox', { name: 'sys_dict 匹配键' }).count(), 0);
      const dictRow = page
        .getByRole('row')
        .filter({ has: page.getByText('sys_dict', { exact: true }) });
      await dictRow.getByRole('button', { name: /7 \/ 7 项/ }).click();
      const dictOptions = page.getByRole('group', { name: 'sys_dict 结构细项', exact: true });
      assert.equal(await dictOptions.getByRole('checkbox').count(), 7);
      await dictOptions.getByRole('checkbox', { name: '字段顺序', exact: true }).uncheck();
      await shot(page, `table-options-${workflowTheme}`);
      await page.getByRole('heading', { level: 1, name: '新建同步', exact: true }).click();
      await dictOptions.waitFor({ state: 'hidden' });
      assert((await dictRow.innerText()).includes('6 / 7 项'));
      await page.getByRole('button', { name: '开始比较', exact: true }).click();
      const comparison = page.getByRole('dialog', { name: '确认比较范围', exact: true });
      await comparison.waitFor();
      await comparison.getByText('逐表设置', { exact: true }).first().waitFor();
      assert.equal(await comparison.getByRole('checkbox', { name: /性能影响/ }).count(), 0);
      await shot(page, `compare-confirmation-${workflowTheme}`);
      await comparison.getByRole('button', { name: '确认并开始比较' }).click();
      await page.getByRole('region', { name: '比较进度' }).waitFor();
      await page.waitForFunction(() =>
        document.querySelector('.compare-progress-panel')?.innerText.includes('比较表'),
      );
      await page.getByRole('menuitem', { name: /设置/ }).click();
      assert.equal(await page.getByRole('region', { name: '比较进度' }).count(), 0);
      await page.getByRole('menuitem', { name: /新建同步/ }).click();
      await page.getByRole('region', { name: '比较进度' }).waitFor();
      await shot(page, `compare-running-${workflowTheme}`);
      await page.getByRole('button', { name: '停止比较', exact: true }).click();
      await page.getByText('比较已停止', { exact: true }).waitFor();
      await shot(page, `compare-stopped-${workflowTheme}`);
      await page.getByRole('menuitem', { name: /新建同步/ }).click();
      await assertFreshSync(page);
      await shot(page, `new-sync-after-stop-${workflowTheme}`);
      report.browser.push({ check: 'new-sync-sidebar-clears-stopped-comparison', passed: true });
      await applyScopeTemplate(page);
      await dictRow.getByRole('button', { name: /7 \/ 7 项/ }).click();
      await dictOptions.getByRole('checkbox', { name: '字段顺序', exact: true }).uncheck();
      await page.getByRole('heading', { level: 1, name: '新建同步', exact: true }).click();
      await dictOptions.waitFor({ state: 'hidden' });
      await shot(page, `scope-options-${workflowTheme}`);
      await page.getByRole('button', { name: '开始比较', exact: true }).click();
      await comparison.waitFor();
      await comparison.getByRole('button', { name: '确认并开始比较' }).click();
      await page.getByRole('heading', { level: 1, name: '差异预览', exact: true }).waitFor();
      await page.getByRole('button', { name: '复制完整 SQL', exact: true }).click();
      assert((await page.evaluate(() => navigator.clipboard.readText())).includes('ALTER TABLE'));
      await page.getByRole('button', { name: '仅保存记录', exact: true }).click();
      const saveConfirmation = page.getByRole('dialog');
      await saveConfirmation.waitFor();
      await saveConfirmation.getByRole('button', { name: '确认保存', exact: true }).click();
      await page.getByRole('heading', { level: 1, name: '同步记录详情', exact: true }).waitFor();
      for (const label of ['执行结果', '外部执行校验', '执行脚本', '回滚脚本']) {
        await page.getByRole('tab', { name: label, exact: true }).click();
        if (label === '执行脚本' || label === '回滚脚本') {
          assert.equal(await page.getByRole('combobox', { name: '记录脚本目标库' }).count(), 0);
          const sections = page.locator('.record-sql-sections > section');
          assert((await sections.count()) > 1, 'all target scripts must be shown together');
          await page.waitForFunction(
            () =>
              !document
                .querySelector('.record-sql-sections')
                ?.innerText.includes('正在加载脚本内容'),
          );
          await shot(
            page,
            `record-${label === '执行脚本' ? 'execution' : 'rollback'}-all-targets-${workflowTheme}`,
          );
          await footerCheck(page, `record-all-targets-${label}-${workflowTheme}`);
        }
      }
      await page.getByRole('button', { name: '登记外部执行', exact: true }).click();
      const external = page.getByRole('dialog', { name: '登记外部执行', exact: true });
      await external.waitFor();
      assert((await external.getByRole('checkbox').count()) > 0);
      await external.getByRole('button', { name: /^取\s*消$/ }).click();
      await external.waitFor({ state: 'hidden' });
      report.browser.push({
        check: 'template-options-confirm-data-compare-cancel-navigation-retry-copy-save-record',
        passed: true,
      });
      await page.getByRole('menuitem', { name: /同步历史/ }).click();
      await page.getByRole('heading', { level: 1, name: '同步历史', exact: true }).waitFor();
      await page.locator('thead').getByRole('checkbox').check();
      await page.getByRole('button', { name: '标记版本', exact: true }).click();
      await page.getByRole('dialog', { name: '标记版本', exact: true }).waitFor();
      await page.getByRole('textbox', { name: '版本号' }).fill('v-qa');
      await page.getByRole('textbox', { name: '版本说明' }).fill('页面验收');
      await page.getByRole('checkbox', { name: '将已属于其他版本的记录移动至此版本' }).check();
      await page.getByRole('button', { name: '确认标记', exact: true }).click();
      await page.getByRole('dialog').waitFor({ state: 'hidden' });
      await page.getByRole('tab', { name: '版本', exact: true }).click();
      await page.getByRole('button', { name: /v-qa/ }).click();
      await page.getByRole('heading', { name: '版本详情', exact: true }).waitFor();
      await page.getByRole('button', { name: '返回版本列表', exact: true }).click();
      await page
        .getByRole('row')
        .filter({ has: page.getByRole('button', { name: 'v-qa', exact: true }) })
        .getByRole('button', { name: /^编\s*辑$/ })
        .click();
      await page.getByRole('textbox', { name: '版本说明' }).fill('更新说明');
      await page.getByRole('button', { name: /保\s*存/ }).click();
      await page.getByRole('dialog').waitFor({ state: 'hidden' });
      report.browser.push({ check: 'history-selection-version-drawer-and-edit', passed: true });
      await page.locator('aside').getByRole('button', { name: '新建连接', exact: true }).click();
      await page.getByLabel('连接名称', { exact: true }).fill('QA 连接');
      await page.getByRole('textbox', { name: '用户名' }).fill('qa_user');
      await page.getByLabel('密码', { exact: true }).fill('fixture-only');
      await page.getByRole('button', { name: '保存连接', exact: true }).click();
      await page.getByRole('dialog').waitFor({ state: 'hidden' });
      await page.getByRole('heading', { level: 1, name: '同步历史', exact: true }).waitFor();
      await page
        .locator('.sidebar-label')
        .getByRole('button', { name: '数据库连接', exact: true })
        .click();
      await page.getByRole('cell', { name: 'QA 连接', exact: true }).waitFor();
      await page.getByRole('cell', { name: 'QA 连接', exact: true }).click();
      assert.equal(await page.getByRole('dialog').count(), 0);
      await page.getByRole('button', { name: '编辑连接 QA 连接', exact: true }).click();
      await page.getByLabel('连接名称', { exact: true }).fill('未保存');
      await page
        .getByRole('dialog')
        .getByRole('button', { name: /^取\s*消$/, exact: true })
        .click();
      await page.getByRole('dialog').waitFor({ state: 'hidden' });
      await page.getByRole('cell', { name: 'QA 连接', exact: true }).click();
      assert.equal(await page.getByRole('dialog').count(), 0);
      await page.getByRole('button', { name: '编辑连接 QA 连接', exact: true }).click();
      assert.equal(await page.getByLabel('连接名称', { exact: true }).inputValue(), 'QA 连接');
      await page
        .getByRole('checkbox', { name: '启用 SSL，验证证书与服务器名称', exact: true })
        .check();
      await page.getByText('客户端证书（PKCS#12，可选）', { exact: true }).waitFor();
      await page
        .getByRole('dialog')
        .getByRole('button', { name: /^取\s*消$/, exact: true })
        .click();
      await page.getByRole('dialog').waitFor({ state: 'hidden' });
      await page.getByRole('button', { name: '管理工作区', exact: true }).click();
      assert.equal(await page.getByRole('dialog').count(), 0);
      await page.getByRole('button', { name: '编辑工作区 跨境电商项目', exact: true }).click();
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
      const rollback = page.getByRole('checkbox', { name: '恢复 idx_code', exact: true });
      assert(await rollback.nth(0).isChecked());
      assert.equal(await rollback.count(), 1);
      await rollback.nth(0).uncheck();
      assert(await page.getByRole('button', { name: '执行所选回滚', exact: true }).isDisabled());
      await rollback.nth(0).check();
      await page.getByRole('button', { name: '执行所选回滚', exact: true }).click();
      const confirmation = page.getByRole('dialog', {
        name: '模拟恢复（只修改内存示例）',
        exact: true,
      });
      await confirmation.waitFor();
      await modalSettled(page);
      assert(
        (await confirmation.getByRole('region', { name: '原同步来源数据库' }).innerText()).includes(
          'shop_test',
        ),
      );
      assert(
        (await confirmation.getByRole('region', { name: '目标数据库' }).innerText()).includes(
          'shop_a',
        ),
      );
      assert(
        !(await confirmation.getByRole('region', { name: '目标数据库' }).innerText()).includes(
          'shop_b',
        ),
      );
      assert((await confirmation.innerText()).includes('共恢复 1 项已选变更'));
      assert(
        (await confirmation.getByRole('region', { name: '本次执行脚本' }).innerText()).includes(
          'ALTER TABLE `shop_a`.`sys_menu` DROP INDEX `idx_code`;',
        ),
      );
      await shot(page, `rollback-execution-confirmation-${workflowTheme}`);
      await page.setViewportSize({ width: 1180, height: 760 });
      await modalSettled(page);
      const executeButton = confirmation.getByRole('button', { name: '执行所选回滚' });
      assert(await executeButton.isVisible());
      await executeButton.hover();
      await shot(page, `rollback-execution-confirmation-minimum-${workflowTheme}`);
      await confirmation.getByRole('button', { name: /^取\s*消$/ }).click();
      await confirmation.waitFor({ state: 'hidden' });
      await footerCheck(page, `rollback-${workflowTheme}`);
      report.browser.push({
        check: 'record-bound-rollback-selection-and-cancel-confirmation',
        passed: true,
      });
      for (const item of report.browser.slice(reportStart)) item.theme = workflowTheme;
      await context.close();
    }
    for (const theme of ['light', 'dark']) {
      await newSyncQA(browser, theme);
      await syncModeQA(browser, theme);
      await selectedScopeQA(browser, theme);
      await organizationQA(browser, theme);
    }
    for (const theme of ['light', 'dark']) await connectionFormQA(browser, theme);
    await reducedMotionModalQA(browser);
    for (const theme of ['light', 'dark']) await connectionActionsQA(browser, theme);
    for (const theme of ['light', 'dark']) await refreshAndTemplateQA(browser, theme);
    for (const theme of ['light', 'dark']) await contextFeedbackQA(browser, theme);
  } catch (error) {
    report.errors.push(String(error));
    if (lastPage && !lastPage.isClosed()) {
      await lastPage.screenshot({
        path: path.join(repo, '.local-data', 'ui-qa-failure.png'),
        animations: 'disabled',
      });
      await fs.writeFile(
        path.join(repo, '.local-data', 'ui-qa-failure.txt'),
        await lastPage.locator('body').innerText(),
      );
    }
    throw error;
  } finally {
    await browser?.close();
    vite.kill();
    await log.close();
  }
}
await fs.mkdir(path.join(repo, '.local-data'), { recursive: true });
try {
  await browserQA();
  assert.deepEqual(report.errors, [], 'browser console errors');
  console.log(JSON.stringify(report, null, 2));
} finally {
  await fs.writeFile(
    output
      ? path.join(path.resolve(output), 'ui-qa-report.json')
      : path.join(
          repo,
          'docs',
          process.argv.includes('--navigation')
            ? 'navigation-ui-qa.json'
            : process.argv.includes('--motion')
              ? 'motion-interaction-ui-qa.json'
              : process.argv.includes('--interaction-revisions')
                ? 'interaction-revisions-ui-qa.json'
                : process.argv.includes('--template-workspace')
                  ? 'template-workspace-ui-qa.json'
                  : process.argv.includes('--multi-database')
                    ? 'multi-database-ui-qa.json'
                    : process.argv.includes('--updates')
                      ? 'updates-ui-qa.json'
                      : process.argv.includes('--record-confirmation')
                        ? 'record-confirmation-ui-qa.json'
                        : process.argv.includes('--connection-form')
                          ? 'connection-form-ui-qa.json'
                          : process.argv.includes('--reduced-motion')
                            ? 'reduced-motion-ui-qa.json'
                            : process.argv.includes('--performance')
                              ? 'performance-ui-qa.json'
                              : process.argv.includes('--tree-organization')
                                ? 'tree-organization-qa.json'
                                : process.argv.includes('--context-feedback')
                                  ? 'context-feedback-qa.json'
                                  : process.argv.includes('--sync-modes')
                                    ? 'sync-mode-ui-qa.json'
                                    : process.argv.includes('--diff-scroll')
                                      ? 'diff-scroll-ui-qa.json'
                                      : 'react-ui-qa.json',
        ),
    JSON.stringify(report, null, 2) + '\n',
  );
}
