import assert from 'node:assert/strict';
import path from 'node:path';
import { build } from 'esbuild';

export async function recordConfirmationQA(
  browser,
  { desktop, report, observe, shot, modalSettled, footerCheck },
) {
  const fixture = await build({
    entryPoints: [path.join(desktop, 'src/preview.ts')],
    bundle: true,
    format: 'iife',
    globalName: 'RecordFixture',
    write: false,
  });
  for (const theme of ['light', 'dark']) {
    const context = await browser.newContext({
      viewport: { width: 1488, height: 1056 },
      colorScheme: theme,
      permissions: ['clipboard-read', 'clipboard-write'],
    });
    const page = await context.newPage();
    observe(page);
    try {
      await page.addInitScript({
        content: `${fixture.outputFiles[0].text}
        window.rollbackSubmissions = 0;
        window.dataSync = {
          ...RecordFixture.previewBridge,
          async invoke(method, params) {
            if (method === 'rollback.execute') window.rollbackSubmissions++;
            const result = await RecordFixture.previewBridge.invoke(method, params);
            if (method === 'record.get') result.files = result.record.plan.targets.flatMap(target =>
              ['target.json', '02_sync.sql', '04_rollback.sql'].map(file => target.ref.database + '/' + file)
            );
            if (method === 'rollback.preview') result.items.push({
              ...result.items[0], id: 'qa-other-target', targetKey: 'target2/shop_c',
              sql: Array.from({ length: 80 }, (_, index) => "UPDATE shop_c.sys_dict SET dict_name='恢复配置' WHERE id=" + index + ';')
            }, {
              ...result.items[0], id: 'qa-conflict', targetKey: 'target1/shop_b',
              eligible: false, selected: false, reason: '存在后续结构或数据修改', sql: []
            });
            return result;
          }
        };`,
      });
      await page.goto('http://127.0.0.1:4183/?preview=1');
      await page.getByRole('heading', { level: 1, name: '差异预览', exact: true }).waitFor();
      await page.getByRole('menuitem', { name: /同步历史/ }).click();
      await page.getByRole('button', { name: 'PREVIEW-EXECUTED-007', exact: true }).click();
      await page.getByRole('heading', { name: '同步记录详情', exact: true }).waitFor();
      for (const [tab, name] of [
        ['执行脚本', 'execution'],
        ['回滚脚本', 'rollback'],
      ]) {
        await page.getByRole('tab', { name: tab, exact: true }).click();
        const sections = page.locator('.record-sql-sections > section');
        await page.waitForFunction(
          () =>
            document.querySelectorAll('.record-sql-sections > section code').length === 3 &&
            !document.querySelector('.record-sql-sections').innerText.includes('正在加载脚本内容'),
        );
        assert.equal(await sections.count(), 3);
        assert.equal(await page.getByRole('combobox', { name: '记录脚本目标库' }).count(), 0);
        for (const target of ['shop_a', 'shop_b', 'shop_c']) {
          assert.equal(await page.getByRole('region', { name: `${target} ${tab}` }).count(), 1);
        }
        const sql = await sections.nth(0).locator('code').textContent();
        await sections.nth(0).getByRole('button', { name: '复制完整 SQL' }).click();
        assert.equal(
          (await page.evaluate(() => navigator.clipboard.readText())).replaceAll('\r\n', '\n'),
          sql.replaceAll('\r\n', '\n'),
        );
        await page.waitForFunction(() => !document.querySelector('.ant-message-notice'));
        await shot(page, `record-${name}-all-targets-${theme}`);
        await footerCheck(page, `record-${name}-all-targets-${theme}`);
        await page.setViewportSize({ width: 1180, height: 760 });
        await footerCheck(page, `record-${name}-all-targets-minimum-${theme}`);
        await shot(page, `record-${name}-all-targets-minimum-${theme}`);
        await page.setViewportSize({ width: 1488, height: 1056 });
      }
      await page.getByRole('button', { name: '回滚预览', exact: true }).click();
      await page.getByRole('heading', { name: '回滚预览', exact: true }).waitFor();
      await page.getByRole('button', { name: '执行所选回滚', exact: true }).click();
      const dialog = page.getByRole('dialog', { name: '执行回滚', exact: true });
      await dialog.waitFor();
      await modalSettled(page);
      assert(
        (await dialog.getByRole('region', { name: '原同步来源数据库' }).innerText()).includes(
          'shop_test',
        ),
      );
      const targets = await dialog.getByRole('region', { name: '目标数据库' }).innerText();
      for (const text of ['shop_a', 'shop_c', '192.0.2.20:3306', '192.0.2.22:3306'])
        assert(targets.includes(text));
      assert(!targets.includes('shop_b'));
      assert((await dialog.innerText()).includes('共恢复 2 项已选变更'));
      await dialog.getByRole('combobox', { name: '执行脚本目标库' }).click();
      await page.getByText('目标服务器 3 / shop_c · 1 项变更', { exact: true }).click();
      const script = dialog.getByRole('region', { name: 'shop_c 执行脚本' });
      const sql = await script.locator('code').textContent();
      assert(sql.includes('WHERE id=79;'));
      await script.getByRole('button', { name: '复制完整 SQL' }).click();
      assert.equal(
        (await page.evaluate(() => navigator.clipboard.readText())).replaceAll('\r\n', '\n'),
        sql.replaceAll('\r\n', '\n'),
      );
      await page.waitForFunction(() => !document.querySelector('.ant-message-notice'));
      await shot(page, `rollback-execution-confirmation-${theme}`);
      await page.setViewportSize({ width: 1180, height: 760 });
      await modalSettled(page);
      await dialog.locator('.sync-execution-confirmation').evaluate((element) => {
        element.scrollTop = element.scrollHeight;
      });
      await dialog.getByRole('button', { name: '执行所选回滚' }).hover();
      await shot(page, `rollback-execution-confirmation-minimum-${theme}`);
      await dialog.getByRole('button', { name: /取\s*消/ }).click();
      await dialog.waitFor({ state: 'hidden' });
      assert.equal(await page.evaluate(() => window.rollbackSubmissions), 0);
      report.browser.push({
        check: 'record-all-targets-copy-and-rollback-confirmation',
        theme,
        passed: true,
        targets: 3,
        rollbackTargets: 2,
        canceledWithoutSubmission: true,
      });
    } finally {
      await context.close();
    }
  }
}
