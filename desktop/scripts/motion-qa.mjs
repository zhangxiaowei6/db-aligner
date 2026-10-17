import assert from 'node:assert/strict';
import path from 'node:path';
import { build } from 'esbuild';

/** 真实动画开启的界面回归；仅使用内存预览资料。 */
export async function motionQA(browser, { desktop, report, observe, shot, modalSettled }) {
  const fixture = await build({
    entryPoints: [path.join(desktop, 'src/preview.ts')],
    bundle: true,
    format: 'iife',
    globalName: 'MotionFixture',
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
        window.motionCalls=[]; window.treeMoves=[]; window.savedConnections=[];
        const animate=Element.prototype.animate;
        Element.prototype.animate=function(...args){ if(this.dataset.transition) window.motionCalls.push({id:this.dataset.transition,options:args[1]}); return animate.apply(this,args); };
        document.addEventListener('transitionrun',event=>{if(['db-tree-collapse-appear-active','db-tree-collapse-enter-active','db-tree-collapse-leave-active'].some(name=>event.target.classList.contains(name))) window.treeMoves.push(event.propertyName);});
        let seeded=false;
        window.__DBALIGNER_PREVIEW_BRIDGE__={...MotionFixture.previewBridge,async invoke(method,params){
          if(method==='state.load'&&!seeded){seeded=true;await MotionFixture.previewBridge.invoke('version.save',{workspaceId:'default',number:'v-motion',description:'表格版本说明',recordIds:[]});}
          if(method==='entity.save'&&params.kind==='connection')window.savedConnections.push(structuredClone(params));
          return MotionFixture.previewBridge.invoke(method,params);
        }};`,
      });
      await page.goto('http://127.0.0.1:4183/?preview=1');
      await page.getByRole('heading', { level: 1, name: '差异预览', exact: true }).waitFor();
      const toggle = async (key, loading) => {
        const row = page
          .locator('.ant-tree-treenode')
          .filter({ has: page.locator(`.tree-label[data-node-key="${key}"]`) });
        const previous = await page.evaluate(() => window.treeMoves.length);
        // 本地分组反馈只有 60 ms，在点击前观察，避免点击完成时已结束而漏检。
        await row.evaluate((element, label) => {
          window.treeBusySeen = false;
          window.treeBusyObserver = new MutationObserver(() => {
            if (
              [...element.querySelectorAll('[aria-label]')].some(
                (node) => node.getAttribute('aria-label') === label,
              )
            )
              window.treeBusySeen = true;
          });
          window.treeBusyObserver.observe(element, {
            childList: true,
            subtree: true,
            attributes: true,
          });
        }, loading);
        await row.locator('.ant-tree-switcher').click();
        await page.waitForFunction(() => window.treeBusySeen);
        await page.evaluate(() => window.treeBusyObserver.disconnect());
        await row.getByLabel(loading, { exact: true }).waitFor({ state: 'hidden' });
        await page.waitForFunction((count) => window.treeMoves.length > count, previous);
        await page.locator('.ant-tree-treenode-motion').waitFor({ state: 'detached' });
        assert(
          await page.evaluate((count) => window.treeMoves.length > count, previous),
          `${key}: actual expansion transition must run`,
        );
        return row;
      };
      await toggle('group:preview-source-group', '正在展开分组');
      await toggle('test', '正在加载最新清单');
      const database = await toggle('test/shop_test', '正在加载最新清单');
      await page.locator('.tree-label[data-node-key="test/shop_test/sys_dict"]').waitFor();
      await shot(page, `motion-tree-expanded-${theme}`);
      await database.locator('.ant-tree-switcher').click();
      await page.locator('.ant-tree-treenode-motion').waitFor({ state: 'detached' });
      // 展开查询尚未结束时立即收起，迟到响应不能重新展开。
      await database.locator('.ant-tree-switcher').click();
      await database.getByLabel('正在加载最新清单').waitFor();
      await database.locator('.ant-tree-switcher').click();
      await page.waitForTimeout(500);
      assert.equal(await database.getAttribute('aria-expanded'), 'false');
      assert.equal(
        await page.locator('.tree-label[data-node-key="test/shop_test/sys_dict"]').count(),
        0,
      );

      await page.locator('aside').getByRole('button', { name: '新建连接', exact: true }).click();
      let dialog = page.getByRole('dialog', { name: '新建连接', exact: true });
      await modalSettled(page);
      await dialog.getByLabel('连接名称', { exact: true }).fill('动效验收连接');
      await dialog.getByLabel('用户名', { exact: true }).fill('preview_user');
      await dialog.getByLabel('端口', { exact: true }).fill('');
      await dialog.getByRole('button', { name: '保存连接', exact: true }).click();
      await dialog
        .locator('.ant-form-item-explain-error')
        .getByText('请输入端口', { exact: true })
        .waitFor();
      await dialog
        .locator('.ant-form-item-explain-error')
        .getByText('请输入连接密码', { exact: true })
        .waitFor();
      assert.equal(await page.evaluate(() => window.savedConnections.length), 0);
      await shot(page, `motion-connection-required-${theme}`);
      await dialog.getByRole('button', { name: /^取\s*消$/ }).click();
      await dialog.waitFor({ state: 'hidden' });
      await page
        .locator('.sidebar-label')
        .getByRole('button', { name: '数据库连接', exact: true })
        .click();
      await page.getByRole('button', { name: '编辑连接 测试服务器', exact: true }).click();
      dialog = page.getByRole('dialog', { name: '编辑连接', exact: true });
      await modalSettled(page);
      const password = dialog.getByLabel('密码', { exact: true });
      assert.equal(await password.inputValue(), '********');
      assert.equal(await password.getAttribute('type'), 'password');
      await shot(page, `motion-connection-saved-${theme}`);
      await dialog.getByRole('button', { name: '保存连接', exact: true }).click();
      await dialog.waitFor({ state: 'hidden' });
      assert.equal(await page.evaluate(() => window.savedConnections.at(-1).value.password), '');

      await page.getByRole('menuitem', { name: /同步模板/ }).click();
      await page.getByRole('button', { name: '编辑模板 基础字典与菜单', exact: true }).click();
      dialog = page.getByRole('dialog', { name: '编辑同步模板', exact: true });
      await modalSettled(page);
      assert(await dialog.getByRole('radio', { name: '已选表', exact: true }).isChecked());
      await shot(page, `motion-template-selected-${theme}`);
      await dialog.getByRole('button', { name: /^取\s*消$/ }).click();
      await dialog.waitFor({ state: 'hidden' });
      await page.getByRole('menuitem', { name: /同步历史/ }).click();
      await page.getByRole('tab', { name: '版本', exact: true }).click();
      const version = page
        .getByRole('row')
        .filter({ has: page.getByRole('button', { name: 'v-motion', exact: true }) });
      await version.waitFor();
      assert.equal(await page.locator('.template-card').count(), 0);
      const description = page
        .getByRole('row')
        .filter({ has: page.getByRole('button', { name: 'v1.2.0', exact: true }) })
        .locator('.table-overflow-text')
        .filter({ hasText: '虚构示例：基础字典' });
      await description.hover();
      await page
        .getByRole('tooltip')
        .getByText(/虚构示例：基础字典与菜单结构归档/)
        .waitFor();
      assert.equal(await description.locator('xpath=ancestor::td').getAttribute('title'), null);
      await shot(page, `motion-table-overflow-${theme}`);
      await page.getByRole('heading', { level: 1 }).hover();
      await shot(page, `motion-version-table-${theme}`);
      await version.getByRole('button', { name: /^编\s*辑$/ }).click();
      dialog = page.getByRole('dialog', { name: '编辑版本' });
      await dialog.getByLabel('版本说明').fill('更新后的版本说明');
      await dialog.getByRole('button', { name: /^保\s*存$/ }).click();
      await dialog.waitFor({ state: 'hidden' });
      await version.getByText('更新后的版本说明').waitFor();
      await page.getByRole('button', { name: 'v1.2.0', exact: true }).click();
      await page.getByRole('heading', { level: 1, name: '版本详情' }).waitFor();
      await shot(page, `motion-version-detail-${theme}`);
      await page.getByRole('button', { name: '返回版本列表', exact: true }).click();
      await page.getByRole('tab', { name: '同步记录', exact: true }).click();
      await page.locator('thead').getByRole('checkbox').check();
      await page.getByRole('button', { name: '标记版本', exact: true }).click();
      dialog = page.getByRole('dialog', { name: '标记版本' });
      await dialog.getByLabel('版本号', { exact: true }).fill(' v1.2.0 ');
      await dialog.getByText('工作区内版本号已存在', { exact: true }).waitFor();
      assert(await dialog.getByRole('button', { name: '确认标记', exact: true }).isDisabled());
      await shot(page, `motion-version-duplicate-${theme}`);
      await dialog.getByRole('button', { name: /^取\s*消$/ }).click();
      await dialog.waitFor({ state: 'hidden' });
      await page.getByRole('button', { name: 'SYNC-1008-008', exact: true }).click();
      await page.getByRole('heading', { level: 1, name: '同步记录详情' }).waitFor();
      assert.equal(await page.getByRole('button', { name: '编辑备注', exact: true }).count(), 0);
      assert.equal(await page.getByRole('button', { name: '删除记录', exact: true }).count(), 0);
      await shot(page, `motion-record-detail-${theme}`);
      assert(
        await page.evaluate(() => window.motionCalls.some((call) => call.options.duration === 180)),
      );

      await page.getByRole('menuitem', { name: /设置/ }).click();
      assert.equal(
        await page.locator('nav').getByRole('link', { name: '打开 GitHub 仓库' }).count(),
        0,
      );
      const repository = page.getByRole('link', { name: '打开 GitHub 仓库' });
      assert.equal(
        await repository.getAttribute('href'),
        'https://github.com/zhangxiaowei6/db-aligner',
      );
      await repository.scrollIntoViewIfNeeded();
      await shot(page, `motion-settings-repository-${theme}`);
      await page.setViewportSize({ width: 1180, height: 760 });
      await page.locator('aside').getByRole('button', { name: '新建连接', exact: true }).click();
      await modalSettled(page);
      await shot(page, `motion-connection-minimum-${theme}`);
      await page
        .getByRole('dialog')
        .getByRole('button', { name: /^取\s*消$/ })
        .click();
      await page.getByRole('dialog').waitFor({ state: 'hidden' });

      await page.emulateMedia({ reducedMotion: 'reduce' });
      const before = await page.evaluate(() => window.motionCalls.length);
      await page.getByRole('menuitem', { name: /同步模板/ }).click();
      await page.getByRole('menuitem', { name: /同步历史/ }).click();
      assert.equal(await page.evaluate(() => window.motionCalls.length), before);
      for (let i = 0; i < 2; i++) {
        await page.locator('aside').getByRole('button', { name: '新建连接', exact: true }).click();
        await page
          .getByRole('dialog', { name: '新建连接' })
          .getByRole('button', { name: /^取\s*消$/ })
          .click();
        await page.getByRole('dialog').waitFor({ state: 'hidden' });
      }
      report.browser.push({
        check:
          'unified-motion-tree-real-transitions-required-credentials-version-table-and-repository',
        theme,
        passed: true,
      });
    } finally {
      await context.close();
    }
  }
}
