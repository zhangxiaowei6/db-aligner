import assert from 'node:assert/strict';
import path from 'node:path';
import { build } from 'esbuild';

/** 页面路径与必填标记验收；只使用内存虚构资料。 */
export async function navigationQA(browser, { desktop, report, observe, shot, modalSettled }) {
  const fixture = await build({
    entryPoints: [path.join(desktop, 'src/preview.ts')],
    bundle: true,
    format: 'iife',
    globalName: 'NavigationFixture',
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
        window.qaCalls={}; window.qaMotion=[];
        const animate=Element.prototype.animate;
        Element.prototype.animate=function(...args){window.qaMotion.push(this.dataset.transition);return animate.apply(this,args);};
        window.__DBALIGNER_PREVIEW_BRIDGE__={...NavigationFixture.previewBridge,async invoke(method,params){
          window.qaCalls[method]=(window.qaCalls[method]||0)+1;
          return NavigationFixture.previewBridge.invoke(method,params);
        }};`,
      });
      const crumb = () => page.getByRole('navigation', { name: '页面路径', exact: true });
      const link = (name) => crumb().getByRole('link', { name, exact: true });
      const pathIs = async (...labels) => {
        await page.waitForFunction(
          (expected) =>
            JSON.stringify(
              [...document.querySelectorAll('.page-breadcrumb .ant-breadcrumb-link')].map(
                (item) => item.textContent,
              ),
            ) === JSON.stringify(expected) &&
            !document.querySelector('.page-breadcrumb [aria-disabled="true"]'),
          ['跨境电商项目', ...labels],
        );
        assert.deepEqual(await crumb().locator('.ant-breadcrumb-link').allTextContents(), [
          '跨境电商项目',
          ...labels,
        ]);
        assert.equal(await crumb().locator('button, a').count(), 0, '路径使用文本元素');
        assert.equal(await crumb().locator('[aria-current="page"]').count(), 1);
      };
      await page.goto('http://127.0.0.1:4183/?preview=1');
      await page.getByRole('heading', { level: 1, name: '差异预览', exact: true }).waitFor();
      await pathIs('新建同步', '差异预览');
      const styleBefore = await link('差异预览').evaluate((element) => {
        const style = getComputedStyle(element),
          rect = element.getBoundingClientRect();
        return {
          padding: style.padding,
          margin: style.margin,
          height: rect.height,
          width: rect.width,
          color: style.color,
        };
      });
      assert.equal(styleBefore.padding, '0px');
      assert.equal(styleBefore.margin, '0px');
      await link('差异预览').hover();
      await page.waitForFunction(
        () =>
          getComputedStyle(document.querySelector('[aria-current="page"]')).backgroundColor !==
          'rgba(0, 0, 0, 0)',
      );
      const styleAfter = await link('差异预览').evaluate((element) => {
        const style = getComputedStyle(element),
          rect = element.getBoundingClientRect();
        return { height: rect.height, width: rect.width, color: style.color, cursor: style.cursor };
      });
      assert.equal(styleAfter.height, styleBefore.height);
      assert.equal(styleAfter.width, styleBefore.width);
      assert.equal(styleAfter.color, styleBefore.color);
      assert.equal(styleAfter.cursor, 'pointer');
      await shot(page, `navigation-text-hover-${theme}`);
      const calls = await page.evaluate(() => ({ ...window.qaCalls }));
      await page.getByPlaceholder('筛选表或变更项').fill('sys_dict');
      const motionCount = await page.evaluate(() => window.qaMotion.length);
      await link('差异预览').click();
      await pathIs('新建同步', '差异预览');
      assert.equal(await page.getByPlaceholder('筛选表或变更项').inputValue(), '');
      assert((await page.evaluate(() => window.qaMotion.length)) > motionCount);
      assert.equal(
        await page.evaluate(() => window.qaCalls['sync.compare']),
        calls['sync.compare'],
      );
      await link('新建同步').focus();
      await page.keyboard.press('Enter');
      await page.getByRole('heading', { level: 1, name: '新建同步', exact: true }).waitFor();
      await pathIs('新建同步');
      assert.equal(
        await page
          .getByRole('combobox', { name: '来源数据库', exact: true })
          .getAttribute('aria-required'),
        'true',
      );
      await shot(page, `navigation-scope-required-${theme}`);

      await page.getByRole('menuitem', { name: /同步历史/ }).click();
      await pathIs('同步历史', '同步记录');
      await page.getByPlaceholder('搜索备注、记录编号').fill('不存在');
      await link('同步记录').focus();
      await page.keyboard.press('Space');
      await pathIs('同步历史', '同步记录');
      assert.equal(await page.getByPlaceholder('搜索备注、记录编号').inputValue(), '');
      await page.getByRole('tab', { name: '版本', exact: true }).click();
      await pathIs('同步历史', '版本');
      await page.getByRole('button', { name: 'v1.2.0', exact: true }).click();
      await pathIs('同步历史', '版本', 'v1.2.0');
      await page.getByRole('button', { name: 'PREVIEW-EXECUTED-007', exact: true }).click();
      await page.getByRole('heading', { level: 1, name: '同步记录详情', exact: true }).waitFor();
      await pathIs('同步历史', '版本', 'v1.2.0', 'PREVIEW-EXECUTED-007');
      await shot(page, `navigation-version-record-${theme}`);
      await page.getByRole('button', { name: '回滚预览', exact: true }).click();
      await page.getByRole('heading', { level: 1, name: '回滚预览', exact: true }).waitFor();
      await pathIs('同步历史', '版本', 'v1.2.0', 'PREVIEW-EXECUTED-007', '回滚预览');
      const rollbackCalls = await page.evaluate(() => window.qaCalls['rollback.preview']);
      await link('回滚预览').click();
      await pathIs('同步历史', '版本', 'v1.2.0', 'PREVIEW-EXECUTED-007', '回滚预览');
      assert.equal(
        await page.evaluate(() => window.qaCalls['rollback.preview']),
        rollbackCalls + 1,
      );
      await page.setViewportSize({ width: 1180, height: 760 });
      await shot(page, `navigation-rollback-minimum-${theme}`);
      await link('PREVIEW-EXECUTED-007').click();
      await pathIs('同步历史', '版本', 'v1.2.0', 'PREVIEW-EXECUTED-007');
      await link('同步历史').click();
      await pathIs('同步历史', '同步记录');
      await page.getByRole('button', { name: 'PREVIEW-EXECUTED-007', exact: true }).click();
      await pathIs('同步历史', '同步记录', 'PREVIEW-EXECUTED-007');
      await link('PREVIEW-EXECUTED-007').click();
      await pathIs('同步历史', '同步记录', 'PREVIEW-EXECUTED-007');
      assert.equal(
        await page
          .getByRole('tab', { name: '执行脚本', exact: true })
          .getAttribute('aria-selected'),
        'true',
      );
      assert.equal(await page.evaluate(() => window.qaCalls['rollback.execute'] || 0), 0);
      assert.equal(await page.evaluate(() => window.qaCalls['sync.save'] || 0), 0);

      await page.setViewportSize({ width: 1488, height: 1056 });
      await page.locator('aside').getByRole('button', { name: '新建连接', exact: true }).click();
      let dialog = page.getByRole('dialog', { name: '新建连接', exact: true });
      await modalSettled(page);
      assert.equal(
        await dialog
          .getByPlaceholder('请输入连接名称，例如：开发环境', { exact: true })
          .getAttribute('aria-required'),
        'true',
      );
      assert.equal(
        await dialog.getByLabel('密码', { exact: true }).getAttribute('aria-required'),
        'true',
      );
      await dialog.getByRole('combobox', { name: '数据库类型', exact: true }).click();
      await page
        .locator('.ant-select-dropdown:visible .ant-select-item-option')
        .filter({ hasText: 'PostgreSQL' })
        .click();
      await dialog.getByRole('checkbox', { name: '启用 SSL，验证证书与服务器名称' }).check();
      assert.equal(await dialog.getByLabel('初始连接数据库').getAttribute('aria-required'), 'true');
      assert.equal(
        await dialog.getByLabel('CA 证书（PEM，启用 SSL 时必填）').getAttribute('aria-required'),
        'true',
      );
      await shot(page, `navigation-required-postgresql-${theme}`);
      await dialog.getByLabel('CA 证书（PEM，启用 SSL 时必填）').scrollIntoViewIfNeeded();
      await shot(page, `navigation-required-postgresql-ssl-${theme}`);
      await dialog.getByRole('button', { name: /^取\s*消$/ }).click();

      await page.locator('aside').getByRole('button', { name: '导入连接', exact: true }).click();
      await page.getByRole('heading', { level: 1, name: '导入连接', exact: true }).waitFor();
      const importPassword = page.locator('input[type="password"][aria-required="true"]').first();
      await importPassword.waitFor();
      await importPassword.fill('fixture-password');
      assert.equal(await importPassword.getAttribute('aria-required'), 'true');
      await shot(page, `navigation-import-required-${theme}`);
      await link('导入连接').click();
      await pathIs('连接管理', '导入连接');
      assert.equal(await page.getByLabel('会话内容', { exact: true }).inputValue(), '');
      assert.equal(await page.locator('.import-connection-test').count(), 0);

      await page.getByRole('menuitem', { name: /设置/ }).click();
      await pathIs('设置');
      await page.getByLabel('最大并行目标库').fill('12');
      await page.emulateMedia({ reducedMotion: 'reduce' });
      const reducedCount = await page.evaluate(() => window.qaMotion.length);
      await link('设置').click();
      await pathIs('设置');
      assert.equal(await page.getByLabel('最大并行目标库').inputValue(), '4');
      assert.equal(await page.evaluate(() => window.qaMotion.length), reducedCount);
      assert.equal(
        await link('设置').evaluate((element) => getComputedStyle(element).transitionDuration),
        '0s',
      );
      assert.equal(await page.locator('.page-scroll').evaluate((element) => element.scrollTop), 0);
      await link('设置').focus();
      await shot(page, `navigation-settings-focus-${theme}`);
      const longName = '较长项目名称用于验证面包屑截断'.repeat(8);
      await page.evaluate(
        async (name) =>
          window.__DBALIGNER_PREVIEW_BRIDGE__.invoke('entity.save', {
            kind: 'workspace',
            value: { id: 'default', name, description: '' },
          }),
        longName,
      );
      await link('设置').click();
      await page.waitForFunction(
        (name) => document.querySelector('.breadcrumb-context')?.getAttribute('title') === name,
        longName,
      );
      await page.setViewportSize({ width: 1180, height: 760 });
      assert(
        await crumb()
          .locator('.breadcrumb-context')
          .evaluate((element) => element.scrollWidth > element.clientWidth),
      );
      assert(await crumb().locator('[aria-current="page"]').isVisible());
      await shot(page, `navigation-long-project-minimum-${theme}`);
      report.browser.push({
        check: 'navigation-hierarchy-fresh-entry-text-hover-required-fields',
        theme,
        passed: true,
        padding: styleBefore.padding,
        margin: styleBefore.margin,
        textHeight: styleBefore.height,
      });
    } catch (error) {
      await shot(page, `navigation-failure-${theme}`);
      throw error;
    } finally {
      await context.close();
    }
  }
}
