import assert from 'node:assert/strict';
import path from 'node:path';
import { writeFile } from 'node:fs/promises';
import { build } from 'esbuild';

export async function interactionRevisionsQA(
  browser,
  { desktop, report, observe, shot, modalSettled },
) {
  const fixture = await build({
    entryPoints: [path.join(desktop, 'src/preview.ts')],
    bundle: true,
    format: 'iife',
    globalName: 'InteractionFixture',
    write: false,
  });
  for (const theme of ['light', 'dark']) {
    const context = await browser.newContext({
      viewport: { width: 1488, height: 1056 },
      colorScheme: theme,
    });
    const page = await context.newPage();
    observe(page);
    try {
      await page.addInitScript({
        content: `${fixture.outputFiles[0].text}
        window.qaMotion=[];
        const animate=Element.prototype.animate;
        Element.prototype.animate=function(...args){window.qaMotion.push(this.dataset.transition);return animate.apply(this,args);};
        window.__DBALIGNER_PREVIEW_BRIDGE__={...InteractionFixture.previewBridge,async invoke(method,params){
          const result=await InteractionFixture.previewBridge.invoke(method,params);
          if(method==='state.load') window.qaState=result;
          return result;
        }};`,
      });
      await page.goto('http://127.0.0.1:4183/?preview=1');
      await page.getByRole('heading', { level: 1, name: '差异预览', exact: true }).waitFor();
      await page.getByRole('menuitem', { name: /新建同步/ }).click();
      await page.getByRole('heading', { level: 1, name: '新建同步', exact: true }).waitFor();
      assert(await page.evaluate(() => window.qaMotion.some((id) => id?.includes('/scope/'))));
      assert.equal(
        await page.getByText('每次只同步一种类型；两种类型分别保留选表、搜索和筛选').count(),
        0,
      );
      await page.locator('aside').getByRole('button', { name: '新建连接', exact: true }).click();
      let dialog = page.getByRole('dialog', { name: '新建连接', exact: true });
      await dialog
        .getByPlaceholder('请输入连接名称，例如：开发环境', { exact: true })
        .fill('交互验收连接');
      await dialog.getByPlaceholder('请输入数据库用户名', { exact: true }).fill('preview_user');
      await dialog.getByRole('button', { name: '测试连接', exact: true }).click();
      await dialog.getByRole('combobox', { name: '指定数据库', exact: true }).waitFor();
      await shot(page, `connection-database-select-${theme}`);
      await dialog.getByRole('button', { name: /^取\s*消$/ }).click();
      await page.getByRole('heading', { level: 1, name: '新建同步', exact: true }).waitFor();
      report.browser.push({
        check: 'draft-database-discovery-and-page-preservation',
        theme,
        passed: true,
      });

      for (const label of ['测试环境', '测试服务器', 'shop_test']) {
        const node = page
          .locator('.ant-tree-treenode')
          .filter({ has: page.locator(`.tree-label[title="${label}"]`) });
        if ((await node.getAttribute('aria-expanded')) !== 'true')
          await node.locator('.ant-tree-switcher').click();
        await page.waitForFunction(
          (title) =>
            [...document.querySelectorAll('.ant-tree-treenode')].some(
              (el) =>
                el.querySelector('.tree-label')?.getAttribute('title') === title &&
                el.getAttribute('aria-expanded') === 'true',
            ),
          label,
        );
        await page.locator('.ant-tree-treenode-motion').waitFor({ state: 'detached' });
      }
      for (const table of ['sys_dict', 'sys_menu']) {
        await page.locator('.tree-label').getByText(table, { exact: true }).dblclick();
        await page.getByRole('heading', { level: 1, name: table, exact: true }).waitFor();
        assert(
          await page.evaluate(
            (name) => window.qaMotion.some((id) => id?.endsWith('/' + name)),
            table,
          ),
        );
      }
      await page.getByRole('tab', { name: '建表 SQL', exact: true }).click();
      await shot(page, `table-switch-transition-${theme}`);
      report.browser.push({
        check: 'different-table-identity-and-structure-tab-transition',
        theme,
        passed: true,
      });

      await page.getByRole('menuitem', { name: /同步模板/ }).click();
      await page.getByRole('button', { name: '编辑模板 基础字典与菜单', exact: true }).click();
      dialog = page.getByRole('dialog', { name: '编辑同步模板', exact: true });
      await dialog.getByRole('textbox', { name: '搜索表', exact: true }).waitFor();
      await dialog.getByRole('tab', { name: '同步数据', exact: true }).click();
      await dialog.getByRole('textbox', { name: 'sys_dict 匹配键', exact: true }).waitFor();
      await shot(page, `template-data-selector-${theme}`);
      await dialog.getByRole('tab', { name: '同步结构', exact: true }).click();
      assert.equal(
        await dialog.getByRole('textbox', { name: 'sys_dict 匹配键', exact: true }).count(),
        0,
      );
      await shot(page, `template-structure-selector-${theme}`);
      await dialog.getByRole('button', { name: /^取\s*消$/ }).click();
      report.browser.push({
        check: 'template-shared-table-selector-and-tabs',
        theme,
        passed: true,
      });

      await page.getByRole('menuitem', { name: /同步历史/ }).click();
      await page.locator('thead').getByRole('checkbox').check();
      await page.getByRole('button', { name: '标记版本', exact: true }).click();
      const versionDrawer = page.getByRole('dialog', { name: '标记版本', exact: true });
      await versionDrawer.getByRole('textbox', { name: '版本号' }).fill('v-interaction-qa');
      await versionDrawer
        .getByRole('textbox', { name: '版本说明' })
        .fill('本次版本交互验收说明\n保留版本内同步记录');
      await versionDrawer
        .getByRole('checkbox', { name: '将已属于其他版本的记录移动至此版本' })
        .check();
      await versionDrawer.getByRole('button', { name: '确认标记', exact: true }).click();
      await versionDrawer.waitFor({ state: 'hidden' });
      const record = await page.evaluate(() =>
        window.qaState.records.find(
          (r) =>
            !r.parentId &&
            !window.qaState.records.some((other) => other.parentId === r.id) &&
            !['QUEUED', 'RUNNING'].includes(r.status),
        ),
      );
      let row = page
        .getByRole('row')
        .filter({ has: page.getByRole('button', { name: record.id, exact: true }) });
      await row.getByRole('button', { name: /^编\s*辑$/ }).click();
      dialog = page.getByRole('dialog', { name: '编辑同步记录', exact: true });
      await dialog.getByRole('textbox', { name: '同步记录备注' }).fill('本次交互验收备注');
      await dialog.getByRole('button', { name: /^保\s*存$/ }).click();
      await dialog.waitFor({ state: 'hidden' });
      await row.getByText('本次交互验收备注', { exact: true }).waitFor();
      await row.getByRole('button', { name: /^删\s*除$/ }).click();
      dialog = page.getByRole('dialog', { name: '删除同步记录及本地资料' });
      await dialog
        .getByRole('region', { name: '记录备注' })
        .getByText('本次交互验收备注', { exact: true })
        .waitFor();
      assert(await dialog.getByRole('button', { name: '永久删除' }).isDisabled());
      await dialog.getByRole('textbox', { name: '删除确认标识' }).fill('错误编号');
      assert(await dialog.getByRole('button', { name: '永久删除' }).isDisabled());
      await dialog.getByRole('textbox', { name: '删除确认标识' }).fill(record.id);
      await modalSettled(page);
      await shot(page, `record-delete-confirmation-${theme}`);
      await page.setViewportSize({ width: 1180, height: 760 });
      await modalSettled(page);
      await dialog.getByRole('button', { name: '永久删除' }).hover();
      await shot(page, `record-delete-confirmation-minimum-${theme}`);
      await dialog.getByRole('button', { name: /^取\s*消$/ }).click();
      assert(await row.isVisible());
      await row.getByRole('button', { name: /^删\s*除$/ }).click();
      dialog = page.getByRole('dialog', { name: '删除同步记录及本地资料' });
      await dialog.getByRole('textbox', { name: '删除确认标识' }).fill(record.id);
      await dialog.getByRole('button', { name: '永久删除' }).click();
      await row.waitFor({ state: 'detached' });
      report.browser.push({
        check: 'record-remark-and-typed-delete-with-cancel-and-minimum-window',
        theme,
        passed: true,
      });

      const count = await page.evaluate(() => window.qaState.records.length);
      const version = await page.evaluate(() =>
        window.qaState.versions.find((item) => item.number === 'v-interaction-qa'),
      );
      await page.getByRole('tab', { name: '版本', exact: true }).click();
      await page
        .getByRole('row')
        .filter({ has: page.getByRole('button', { name: version.number, exact: true }) })
        .getByRole('button', { name: /^删\s*除$/ })
        .click();
      dialog = page.getByRole('dialog', { name: '删除版本', exact: true });
      await dialog
        .getByRole('region', { name: '版本说明' })
        .getByText('本次版本交互验收说明\n保留版本内同步记录', { exact: true })
        .waitFor();
      await dialog.getByRole('textbox', { name: '删除确认标识' }).fill(version.number);
      await shot(page, `version-delete-confirmation-${theme}`);
      await dialog.getByRole('button', { name: '永久删除' }).click();
      await dialog.waitFor({ state: 'hidden' });
      assert.equal(await page.evaluate(() => window.qaState.records.length), count);
      assert.equal(
        await page.evaluate(
          (id) => Object.values(window.qaState.versionLinks).filter((value) => value === id).length,
          version.id,
        ),
        0,
      );
      report.browser.push({
        check: 'version-delete-retains-records-and-clears-membership',
        theme,
        passed: true,
      });

      const before = await page.evaluate(() => window.qaMotion.length);
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await page.getByRole('menuitem', { name: /设置/ }).click();
      await page.getByRole('heading', { level: 1, name: '设置', exact: true }).waitFor();
      assert.equal(await page.evaluate(() => window.qaMotion.length), before);
      report.browser.push({
        check: 'common-navigation-motion-and-reduced-motion',
        theme,
        passed: true,
      });
    } catch (error) {
      await page.screenshot({ path: path.join(desktop, '../.tools/interaction-failure.png') });
      await writeFile(
        path.join(desktop, '../.tools/interaction-failure.html'),
        await page.content(),
      );
      throw error;
    } finally {
      await context.close();
    }
  }
}
