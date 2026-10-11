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
  const target = path.join(screenshots, name + '.png');
  const temporary = target + `.${process.pid}.tmp`;
  try {
    await fs.writeFile(temporary, await page.screenshot({ animations: 'disabled' }));
    await fs.rename(temporary, target);
  } finally {
    await fs.rm(temporary, { force: true });
  }
}
async function modalSettled(page) {
  // Motion registers its entrance on animation frames after mounting the dialog.
  await page.evaluate(
    () =>
      new Promise((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(resolve))),
      ),
  );
  await page.waitForFunction(() =>
    [...document.querySelectorAll('.ant-modal')].every((element) =>
      element.getAnimations().every((animation) => animation.playState !== 'running'),
    ),
  );
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
    await page.getByRole('menuitem', { name: /新建同步/ }).click();
    assert.equal(await page.getByRole('radio', { name: /同步结构|同步数据/ }).count(), 0);
    await page.getByRole('tab', { name: '同步结构', exact: true }).click();
    const search = page.getByRole('textbox', { name: '搜索表', exact: true });
    await search.fill('sys_dict');
    assert.equal(await page.getByRole('checkbox', { name: / 表结构$/ }).count(), 1);
    assert(await page.getByText('显示 1 / 6 张表', { exact: false }).isVisible());
    assert(await page.getByRole('button', { name: '取消选择搜索结果', exact: true }).isVisible());
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
    await manager.getByRole('button', { name: /取\s*消/ }).click();
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
    await editor.getByRole('button', { name: /取\s*消/ }).click();
    report.browser.push({ check: 'group-edit-icon-and-dropdown-create', theme, passed: true });
    await page.getByRole('menuitem', { name: /新建同步/ }).click();
    await page.getByRole('combobox', { name: '来源数据库', exact: true }).click();
    await page.locator('.ant-select-dropdown:visible .ant-select-item-option').first().waitFor();
    assert.deepEqual(
      await page.locator('.ant-select-dropdown:visible .ant-select-item-option').allTextContents(),
      [
        '目标服务器 1 / shop_a',
        '目标服务器 2 / shop_b',
        '目标服务器 3 / shop_c',
        '测试服务器 / shop_test',
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
      await items.nth({ group: 4, connection: 5, database: 4, table: 4 }[type] - 1).waitFor();
      const icons = await items.evaluateAll((operations) =>
        operations.map((item) => ({
          name: item.textContent,
          hasIcon: !!item.querySelector('.ant-dropdown-menu-item-icon'),
        })),
      );
      assert.equal(icons.length, { group: 4, connection: 5, database: 4, table: 4 }[type]);
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
    await workspaceEditor.getByRole('button', { name: /取\s*消/ }).click();
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
    assert.equal(await newWorkspace.getByLabel('工作区名称', { exact: true }).inputValue(), '');
    await newWorkspace.getByRole('button', { name: /取\s*消/ }).click();
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
    await templateEditor.getByRole('button', { name: /取\s*消/ }).click();
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
    await templateCreator.getByRole('button', { name: /取\s*消/ }).click();
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
      if (heading === '新建同步') await page.getByRole('menuitem', { name: /新建同步/ }).click();
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
      if (heading === '差异预览') await editor.getByRole('button', { name: /取\s*消/ }).click();
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
    await template.getByRole('button', { name: /取\s*消/ }).click();
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
    await page.getByRole('menuitem', { name: /新建同步/ }).click();
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
    await editor.getByRole('button', { name: /取\s*消/ }).click();
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
      try {
        if ((await fetch('http://127.0.0.1:4183')).ok) break;
      } catch {}
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    browser = await chromium.launch({ headless: true, executablePath });
    if (process.argv.includes('--tree-organization')) {
      for (const theme of ['light', 'dark']) await organizationQA(browser, theme);
      return;
    }
    if (process.argv.includes('--context-feedback')) {
      for (const theme of ['light', 'dark']) await contextFeedbackQA(browser, theme);
      return;
    }
    if (process.argv.includes('--sync-modes')) {
      for (const theme of ['light', 'dark']) await syncModeQA(browser, theme);
      return;
    }
    for (const mode of ['light', 'dark']) {
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
        .getByRole('button', { name: /取\s*消/ })
        .click();
      await page.getByRole('cell', { name: '基础字典与菜单', exact: true }).dblclick();
      assert.equal(await page.getByRole('dialog').count(), 0);
      await page.getByRole('button', { name: '编辑模板 基础字典与菜单', exact: true }).click();
      assert.equal(await templateName.inputValue(), '基础字典与菜单');
      await page
        .getByRole('dialog', { name: '编辑同步模板' })
        .getByRole('button', { name: /取\s*消/ })
        .click();
      await page.getByRole('button', { name: '应用模板 基础字典与菜单', exact: true }).click();
      await page.getByRole('heading', { level: 1, name: '新建同步', exact: true }).waitFor();
      await page.getByText('目标缺失', { exact: true }).first().waitFor();
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
      await comparison.getByText('逐表设置', { exact: true }).waitFor();
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
      assert.equal(await page.getByRole('textbox', { name: 'sys_dict 匹配键' }).count(), 0);
      assert((await dictRow.innerText()).includes('6 / 7 项'));
      await shot(page, `scope-options-${workflowTheme}`);
      await page.getByRole('button', { name: '开始比较', exact: true }).click();
      await comparison.waitFor();
      await comparison.getByRole('button', { name: '确认并开始比较' }).click();
      await page.getByRole('heading', { level: 1, name: '差异预览', exact: true }).waitFor();
      await page.getByRole('button', { name: '复制 SQL', exact: true }).click();
      assert((await page.evaluate(() => navigator.clipboard.readText())).includes('ALTER TABLE'));
      await page.getByRole('button', { name: '仅保存记录', exact: true }).click();
      const saveConfirmation = page.getByRole('dialog');
      await saveConfirmation.waitFor();
      await saveConfirmation.getByRole('button', { name: '确认保存', exact: true }).click();
      await page.getByRole('heading', { level: 1, name: '同步记录详情', exact: true }).waitFor();
      for (const label of ['执行结果', '外部执行校验', '执行脚本', '回滚脚本']) {
        await page.getByRole('tab', { name: label, exact: true }).click();
      }
      await page.getByRole('button', { name: '登记外部执行', exact: true }).click();
      const external = page.getByRole('dialog', { name: '登记外部执行', exact: true });
      await external.waitFor();
      assert((await external.getByRole('checkbox').count()) > 0);
      await external.getByRole('button', { name: /取\s*消/ }).click();
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
      await page.locator('aside').getByRole('button', { name: '新建连接', exact: true }).click();
      await page.getByLabel('连接名称', { exact: true }).fill('QA 连接');
      await page.getByRole('textbox', { name: '用户名' }).fill('qa_user');
      await page.getByRole('button', { name: '保存连接', exact: true }).click();
      await page.getByRole('cell', { name: 'QA 连接', exact: true }).waitFor();
      await page.getByRole('dialog').waitFor({ state: 'hidden' });
      await page.getByRole('cell', { name: 'QA 连接', exact: true }).click();
      assert.equal(await page.getByRole('dialog').count(), 0);
      await page.getByRole('button', { name: '编辑连接 QA 连接', exact: true }).click();
      await page.getByLabel('连接名称', { exact: true }).fill('未保存');
      await page
        .getByRole('dialog')
        .getByRole('button', { name: /取\s*消/, exact: true })
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
        .getByRole('button', { name: /取\s*消/, exact: true })
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
    for (const theme of ['light', 'dark']) {
      await syncModeQA(browser, theme);
      await organizationQA(browser, theme);
    }
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
    path.join(
      repo,
      'docs',
      native
        ? 'react-desktop-qa.json'
        : process.argv.includes('--tree-organization')
          ? 'tree-organization-qa.json'
          : process.argv.includes('--context-feedback')
            ? 'context-feedback-qa.json'
            : process.argv.includes('--sync-modes')
              ? 'sync-mode-ui-qa.json'
              : 'react-ui-qa.json',
    ),
    JSON.stringify(report, null, 2) + '\n',
  );
}
