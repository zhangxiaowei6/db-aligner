import assert from 'node:assert/strict';
import { build } from 'esbuild';
import path from 'node:path';

export async function performanceQA(browser, { repo, report, observe, shot, footerCheck }) {
  report.environment = {
    node: process.version,
    platform: process.platform,
    browser: await browser.version(),
    fixture: 'production frontend with isolated in-memory data; no database operations',
  };
  const fixture = await build({
    entryPoints: [path.join(repo, 'desktop/src/preview.ts')],
    bundle: true,
    format: 'iife',
    globalName: 'PerformanceFixture',
    write: false,
  });
  for (const theme of ['light', 'dark']) {
    const context = await browser.newContext({
      viewport: { width: 1180, height: 760 },
      colorScheme: theme,
    });
    const page = await context.newPage();
    observe(page);
    const session = await context.newCDPSession(page);
    await session.send('HeapProfiler.enable');
    try {
      await page.addInitScript({
        content: `${fixture.outputFiles[0].text}
        const fixturePlan = structuredClone(PerformanceFixture.previewPlan);
        const target = fixturePlan.targets[0];
        const sample = target.changes[0];
        fixturePlan.targets = [target];
        fixturePlan.tables = [{ ...fixturePlan.tables[0], structure: true, data: false }];
        target.changes = Array.from({ length: 20000 }, (_, index) => ({
          ...sample, id: 'performance-change-' + index, kind: 'ADD_COLUMN',
          table: 'qa_table_' + String(index % 298).padStart(3, '0'),
          label: 'qa_column_' + String(index).padStart(5, '0'), risk: false,
          selected: true, blocked: index % 10 === 0,
          sql: 'ALTER TABLE qa_table ADD COLUMN qa_column_' + index + ' INT;'
        }));
        window.performanceFixture = { tables: 298, bytes: 0, saved: '', source: '', delivered: 0, calls: [], sql: '' };
        window.dbAligner = {
          ...PerformanceFixture.previewBridge,
          async invoke(method, params) {
            const fixture = window.performanceFixture;
            fixture.calls.push({ method, file: params?.file });
            if (method === 'tables.list') return Array.from({ length: fixture.tables }, (_, index) => ({ name: 'qa_table_' + index, comment: '性能测试虚构表' }));
            if (method === 'schema.export') {
              fixture.sql = fixture.bytes ? 'X'.repeat(fixture.bytes) : params.tables.map((name) => '-- ' + name + '\\nCREATE TABLE ' + name + ' (\\n' + Array.from({ length: 30 }, (_, index) => 'column_' + index + ' VARCHAR(255) NOT NULL DEFAULT 0 COMMENT \\'中文注释\\'').join(',\\n') + '\\n);\\n').join('\\n');
              fixture.delivered = performance.now();
              return { sql: fixture.sql };
            }
            if (method === 'files.save') { fixture.saved = params.content; return true; }
            if (method === 'sync.compare') return structuredClone(fixturePlan);
            if (method === 'sync.compare.start') return { compareId: params.compareId };
            if (method === 'sync.compare.get') return { compareId: params.compareId, status: 'COMPLETED', plan: fixturePlan };
            if (method === 'rollback.preview') return { id: 'performance-rollback', recordId: params.id,
              items: target.changes.map((change) => ({ id: change.id, targetKey: change.targetKey, table: change.table, label: change.label, eligible: !change.blocked, selected: false, reason: '虚构冲突', sql: [change.sql] })) };
            return PerformanceFixture.previewBridge.invoke(method, params);
          }
        };`,
      });
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
              (element) =>
                element.querySelector('.tree-label')?.textContent === label &&
                element.getAttribute('aria-expanded') === 'true',
            ),
          label,
        );
        await page.locator('.ant-tree-treenode-motion').waitFor({ state: 'detached' });
      }
      await expand('测试环境');
      await expand('测试服务器');
      const database = page.locator('.tree-label[data-node-key="test/shop_test"]');
      async function openExport() {
        await database.click({ button: 'right' });
        await page.getByRole('menuitem', { name: '导出表结构…', exact: true }).click();
        await page.getByRole('heading', { level: 1, name: '导出表结构', exact: true }).waitFor();
        await page.getByRole('button', { name: /^全\s*选$/ }).click();
      }
      for (const scale of [
        { tables: 298 },
        { tables: 1000 },
        { tables: 5000 },
        { tables: 298, bytes: 10 * 1024 * 1024 },
      ]) {
        await page.evaluate(
          (scale) => Object.assign(window.performanceFixture, { bytes: 0, ...scale }),
          scale,
        );
        await openExport();
        await page.getByRole('button', { name: '生成预览 SQL', exact: true }).click();
        await page.getByText('分页预览', { exact: false }).waitFor();
        const metrics = await page.evaluate(() => {
          const code = document.querySelector('.sql-view code');
          return {
            displayMs: performance.now() - window.performanceFixture.delivered,
            sqlCharacters: window.performanceFixture.sql.length,
            displayedCharacters: code.textContent.length,
            sqlNodes: code.querySelectorAll('*').length,
            domNodes: document.querySelectorAll('*').length,
          };
        });
        assert(metrics.displayedCharacters <= 32769);
        assert.equal(metrics.sqlNodes, 0);
        assert(metrics.displayMs < 1000, 'SQL first display exceeds 1s');
        const pageMs = await page.evaluate(async () => {
          const started = performance.now();
          document.querySelector('.sql-view .ant-pagination-next button').click();
          await new Promise((resolve) =>
            requestAnimationFrame(() => requestAnimationFrame(resolve)),
          );
          return performance.now() - started;
        });
        assert(pageMs < 200, 'SQL page switch exceeds 200ms');
        assert((await page.locator('.sql-toolbar').innerText()).includes('第 2 /'));
        await page.getByRole('button', { name: /导出\s*\.sql/ }).click();
        assert(
          await page.evaluate(
            () => window.performanceFixture.saved === window.performanceFixture.sql,
          ),
          'export must keep complete original SQL',
        );
        const code = page.locator('.sql-view code');
        await page.getByRole('textbox', { name: '文件名' }).fill('performance.sql');
        assert((await code.textContent()).length <= 32769);
        await footerCheck(page, `performance-export-${scale.tables}-${scale.bytes || 0}-${theme}`);
        await session.send('HeapProfiler.collectGarbage');
        const heap = await session.send('Runtime.getHeapUsage');
        report.browser.push({
          check: 'bounded-sql-performance',
          theme,
          ...scale,
          ...metrics,
          pageMs,
          heapBytes: heap.usedSize,
        });
        console.log(
          `Performance SQL: ${theme} ${scale.tables} tables ${scale.bytes || 0} bytes; display ${metrics.displayMs.toFixed(1)}ms, page ${pageMs.toFixed(1)}ms`,
        );
        if (scale.bytes) await shot(page, `performance-sql-10mb-${theme}`);
      }
      await session.send('HeapProfiler.collectGarbage');
      const beforeCycles = await session.send('Memory.getDOMCounters');
      const cycleHeaps = [];
      for (let cycle = 0; cycle < 5; cycle++) {
        await page.evaluate((cycle) => {
          window.performanceFixture.bytes = cycle % 2 ? 0 : 10 * 1024 * 1024;
          window.performanceFixture.saved = '';
        }, cycle);
        await page.getByRole('button', { name: '生成预览 SQL', exact: true }).click();
        await page.getByText('分页预览', { exact: false }).waitFor();
        await session.send('HeapProfiler.collectGarbage');
        cycleHeaps.push((await session.send('Runtime.getHeapUsage')).usedSize);
      }
      const afterCycles = await session.send('Memory.getDOMCounters');
      assert(
        afterCycles.nodes <= beforeCycles.nodes + 200,
        'SQL replacement retains too many old DOM nodes',
      );
      assert(
        Math.abs(cycleHeaps[4] - cycleHeaps[2]) < 5 * 1024 * 1024,
        'same-size SQL replacement grows heap after garbage collection',
      );
      report.browser.push({
        check: 'sql-replacement-memory',
        theme,
        cycles: 5,
        beforeCycles,
        afterCycles,
        cycleHeaps,
      });
      await page.getByRole('menuitem', { name: /新建同步/ }).click();
      await page.getByRole('checkbox', { name: 'qa_table_0 表结构', exact: true }).check();
      await page.getByRole('button', { name: '开始比较', exact: true }).click();
      await page.getByRole('button', { name: '确认并开始比较', exact: true }).click();
      await page.locator('.ant-table-tbody-virtual').waitFor();
      const mountedRows = await page.locator('.diff-layout > section [data-row-key]').count();
      assert(mountedRows < 200, 'difference list must only mount viewport rows');
      const holder = page.locator('.diff-layout > section .ant-table-tbody-virtual-holder');
      await holder.evaluate((element) => {
        element.scrollTop = element.scrollHeight;
      });
      const lastChange = page.locator('[data-row-key="performance-change-19965"]');
      await lastChange.click();
      await lastChange.press('Enter');
      assert(
        (await page.getByLabel('差异明细', { exact: true }).innerText()).includes(
          'qa_column_19965',
        ),
      );
      await holder.evaluate((element) => {
        element.scrollTop = 0;
      });
      const selectionMs = await page.evaluate(async () => {
        const started = performance.now();
        document.querySelector('.diff-layout > section input[type=checkbox]').click();
        await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        return performance.now() - started;
      });
      assert(selectionMs < 500, '20000 change selection exceeds 500ms');
      const filterMs = await page.evaluate(async () => {
        const input = document.querySelector('.diff-toolbar input');
        const started = performance.now();
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(
          input,
          'qa_table_029',
        );
        input.dispatchEvent(new Event('input', { bubbles: true }));
        await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        return performance.now() - started;
      });
      assert(filterMs < 500, '20000 change filtering exceeds 500ms');
      await page.getByPlaceholder('筛选表或变更项').fill('');
      await footerCheck(page, `performance-diff-${theme}`);
      await shot(page, `performance-diff-20000-${theme}`);
      report.browser.push({
        check: 'virtual-difference-performance',
        theme,
        changes: 20000,
        mountedRows,
        selectionMs,
        filterMs,
      });
      await page.getByRole('menuitem', { name: /同步历史/ }).click();
      await page.getByRole('button', { name: 'PREVIEW-EXECUTED-007', exact: true }).click();
      await page.getByRole('button', { name: '回滚预览', exact: true }).click();
      await page.locator('.ant-table-tbody-virtual').waitFor();
      const recoveryRows = await page.locator('.diff-layout > section [data-row-key]').count();
      assert(recoveryRows < 200);
      const recoverySelectionMs = await page.evaluate(async () => {
        const started = performance.now();
        document.querySelector('.diff-layout > section input[type=checkbox]').click();
        await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        return performance.now() - started;
      });
      assert(recoverySelectionMs < 500);
      await footerCheck(page, `performance-rollback-${theme}`);
      await shot(page, `performance-rollback-20000-${theme}`);
      report.browser.push({
        check: 'virtual-recovery-performance',
        theme,
        items: 20000,
        mountedRows: recoveryRows,
        selectionMs: recoverySelectionMs,
      });
      await page.setViewportSize({ width: 960, height: 760 });
      await footerCheck(page, `performance-rollback-narrow-${theme}`);
      await shot(page, `performance-rollback-960-${theme}`);
    } catch (error) {
      await shot(page, `performance-failure-${theme}`);
      throw error;
    } finally {
      await context.close();
    }
  }
}
