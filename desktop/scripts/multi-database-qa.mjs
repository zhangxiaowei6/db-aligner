import assert from 'node:assert/strict';

export async function multiDatabaseQA(browser, { report, observe, shot, modalSettled }) {
  for (const theme of ['light', 'dark']) {
    for (const width of [1488, 1180]) {
      const page = await browser.newPage({
        viewport: { width, height: width === 1180 ? 760 : 1056 },
        colorScheme: theme,
      });
      observe(page);
      await page.goto('http://127.0.0.1:4183/?preview=1&page=connections');
      await page.getByRole('heading', { name: '连接管理', exact: true }).waitFor();
      await page
        .getByRole('button', { name: '编辑连接 PostgreSQL 来源（虚构）', exact: true })
        .click();
      await modalSettled(page);
      const dialog = page.getByRole('dialog', { name: '编辑连接' });
      await dialog.getByRole('button', { name: '安装驱动', exact: true }).click();
      await dialog.getByText('驱动已安装', { exact: true }).waitFor();
      assert.equal(
        await dialog.getByRole('textbox', { name: '端口', exact: true }).inputValue(),
        '5432',
      );
      assert.equal(
        await dialog.getByRole('textbox', { name: '初始连接数据库', exact: true }).inputValue(),
        'postgres',
      );
      await shot(page, `multi-db-driver-${theme}-${width}`);
      await dialog.getByRole('button', { name: '测试连接', exact: true }).click();
      await dialog.getByText(/连接成功/).waitFor();
      await dialog.getByRole('button', { name: '取 消', exact: true }).click();
      await page.getByRole('tree').getByText('PostgreSQL 演示', { exact: true }).dblclick();
      await page.locator('[id$="-pg-source"]:not([id^="undefined-"])').waitFor();
      await page
        .locator('.ant-tree-treenode')
        .filter({ has: page.locator('[data-connection-id="pg-source"]') })
        .locator('.ant-tree-switcher')
        .click();
      await page.getByRole('tree').getByText('demo_pg', { exact: true }).dblclick();
      const schema = page.locator('[data-node-type="schema"]').filter({ hasText: /^public$/ });
      await page
        .locator('.ant-tree-treenode:not([id^="undefined-"])')
        .filter({ has: schema })
        .waitFor();
      await schema.dblclick();
      await page.getByRole('tree').getByText('sys_dict', { exact: true }).waitFor();
      await page.locator('.tree-label[aria-busy="true"]').first().waitFor({ state: 'hidden' });
      await shot(page, `multi-db-tree-${theme}-${width}`);
      await page.getByRole('menuitem', { name: /新建同步/ }).click();
      await page.getByRole('radio', { name: 'PostgreSQL', exact: true }).check();
      await page.getByRole('button', { name: '刷新数据库', exact: true }).click();
      await page.getByRole('combobox', { name: '来源数据库', exact: true }).click();
      await page
        .getByText('PostgreSQL 来源（虚构） · PostgreSQL / demo_pg / reference', { exact: true })
        .click();
      await page.locator('.ant-select-dropdown:visible').waitFor({ state: 'hidden' });
      await page.locator('.scope-table').getByText('sys_dict', { exact: true }).waitFor();
      await page.getByRole('combobox', { name: '目标数据库', exact: true }).click();
      await page
        .locator('.ant-select-dropdown:visible')
        .getByText('PostgreSQL 目标（虚构） · PostgreSQL / demo_pg_target / reference', {
          exact: true,
        })
        .click();
      await page.getByRole('combobox', { name: '目标数据库', exact: true }).press('Escape');
      await page.getByRole('tab', { name: '同步数据', exact: true }).click();
      await page.getByText('正在检查目标库表清单…', { exact: true }).waitFor({ state: 'hidden' });
      await page.locator('[data-row-key="sys_dict"] input[type="checkbox"]').check();
      await page.getByRole('textbox', { name: 'sys_dict 匹配键', exact: true }).fill('code');
      await page.locator('.page-scroll').evaluate((element) => {
        element.scrollTop = 0;
      });
      await shot(page, `multi-db-scope-${theme}-${width}`);
      await page.getByRole('button', { name: '开始比较', exact: true }).click();
      const confirmation = page.getByRole('dialog', { name: '确认比较范围' });
      await modalSettled(page);
      assert((await confirmation.innerText()).includes('demo_pg / reference'));
      assert(!(await confirmation.innerText()).includes('pg:['));
      await confirmation.getByRole('checkbox').check();
      await confirmation.getByRole('button', { name: '确认并开始比较', exact: true }).click();
      await page.getByRole('heading', { name: '基础数据差异', exact: true }).waitFor();
      await page
        .locator('.diff-inspector code')
        .filter({ hasText: 'IS NOT DISTINCT FROM' })
        .waitFor();
      await shot(page, `multi-db-diff-${theme}-${width}`);
      await page.getByRole('button', { name: '执行并保存', exact: true }).click();
      const execute = page.getByRole('dialog', { name: '确认模拟同步（不会连接数据库）' });
      await modalSettled(page);
      assert((await execute.innerText()).includes('demo_pg_target / reference'));
      await shot(page, `multi-db-confirm-${theme}-${width}`);
      await execute.getByRole('button', { name: '确认模拟执行', exact: true }).click();
      await page.getByRole('heading', { name: '同步记录详情', exact: true }).waitFor();
      await page.getByText('【虚构模拟执行】', { exact: true }).waitFor();
      await shot(page, `multi-db-record-${theme}-${width}`);
      await page.getByRole('button', { name: '回滚预览', exact: true }).click();
      await page.getByRole('heading', { name: '回滚预览', exact: true }).waitFor();
      assert((await page.locator('main').innerText()).includes('demo_pg_target / reference'));
      await shot(page, `multi-db-recovery-${theme}-${width}`);
      await page.getByRole('textbox', { name: '回滚备注', exact: true }).fill('预览验证恢复');
      await page.getByRole('button', { name: '执行所选回滚', exact: true }).click();
      const restore = page.getByRole('dialog', { name: '模拟恢复（只修改内存示例）' });
      await modalSettled(page);
      await restore.getByRole('button', { name: '执行所选回滚', exact: true }).click();
      await page.getByRole('heading', { name: '同步记录详情', exact: true }).waitFor();
      await page.getByText('【虚构模拟恢复】预览验证恢复', { exact: true }).waitFor();
      report.browser.push({
        check: `multi-database-${theme}-${width}`,
        databases: ['postgresql'],
        driver: 'memory simulation',
        schemaTree: true,
        comparison: true,
        executionConfirmation: true,
        record: true,
        recovery: true,
      });
      await page.getByRole('menuitem', { name: /新建同步/ }).click();
      await page.getByRole('radio', { name: 'MySQL', exact: true }).check();
      await page.getByRole('combobox', { name: '来源数据库', exact: true }).click();
      await page
        .locator('.ant-select-dropdown:visible')
        .getByText('测试服务器 · MySQL / shop_test', { exact: true })
        .click();
      await page.locator('.ant-select-dropdown:visible').waitFor({ state: 'hidden' });
      await page.locator('.scope-table').getByText('sys_dict', { exact: true }).waitFor();
      await page.getByRole('combobox', { name: '目标数据库', exact: true }).click();
      await page
        .locator('.ant-select-dropdown:visible')
        .getByText('目标服务器 2 · MySQL / shop_b', { exact: true })
        .click();
      await page.getByRole('combobox', { name: '目标数据库', exact: true }).press('Escape');
      await page.getByRole('tab', { name: '同步数据', exact: true }).click();
      await page.getByText('正在检查目标库表清单…', { exact: true }).waitFor({ state: 'hidden' });
      await page.locator('[data-row-key="sys_dict"] input[type="checkbox"]').check();
      await page.getByRole('textbox', { name: 'sys_dict 匹配键', exact: true }).fill('code');
      await shot(page, `multi-db-mysql-scope-${theme}-${width}`);
      await page.getByRole('button', { name: '开始比较', exact: true }).click();
      const mysqlConfirm = page.getByRole('dialog', { name: '确认比较范围' });
      await mysqlConfirm.waitFor();
      await modalSettled(page);
      assert(!(await mysqlConfirm.innerText()).includes('demo_pg'));
      await mysqlConfirm.getByRole('checkbox').check();
      await mysqlConfirm.getByRole('button', { name: '确认并开始比较', exact: true }).click();
      await page.getByRole('heading', { name: '基础数据差异', exact: true }).waitFor();
      await page
        .locator('.diff-inspector code')
        .filter({ hasText: '`shop_b`.`sys_dict`' })
        .waitFor();
      await shot(page, `multi-db-mysql-diff-${theme}-${width}`);
      await page.getByRole('button', { name: '执行并保存', exact: true }).click();
      const mysqlExecute = page.getByRole('dialog', { name: '确认模拟同步（不会连接数据库）' });
      await modalSettled(page);
      await mysqlExecute.getByRole('button', { name: '确认模拟执行', exact: true }).click();
      await page.getByRole('heading', { name: '同步记录详情', exact: true }).waitFor();
      await page.getByRole('button', { name: '回滚预览', exact: true }).click();
      await page.getByRole('heading', { name: '回滚预览', exact: true }).waitFor();
      await page.getByRole('button', { name: '执行所选回滚', exact: true }).click();
      const mysqlRestore = page.getByRole('dialog', { name: '模拟恢复（只修改内存示例）' });
      await modalSettled(page);
      assert((await mysqlRestore.innerText()).includes('shop_b'));
      assert(!(await mysqlRestore.innerText()).includes('demo_pg'));
      await mysqlRestore.getByRole('button', { name: '执行所选回滚', exact: true }).click();
      await page.getByRole('heading', { name: '同步记录详情', exact: true }).waitFor();
      await page.getByText('【虚构模拟恢复】', { exact: true }).waitFor();
      report.browser.push({
        check: `mysql-complete-${theme}-${width}`,
        database: 'mysql',
        comparison: true,
        execution: true,
        recovery: true,
      });
      await page.close();
    }
  }
}
