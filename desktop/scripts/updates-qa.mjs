import assert from 'node:assert/strict';

export async function updatesQA(browser, { repo, report, observe, shot, footerCheck }) {
  for (const theme of ['light', 'dark']) {
    for (const width of [1488, 1180]) {
      const page = await browser.newPage({
        viewport: { width, height: width === 1180 ? 760 : 1056 },
        colorScheme: theme,
      });
      observe(page);
      await page.goto('http://127.0.0.1:4183/?preview=1');
      await page.getByRole('heading', { level: 1, name: '差异预览', exact: true }).waitFor();
      await page.getByRole('menuitem', { name: /设置/ }).click();
      await page.getByRole('heading', { level: 1, name: '设置', exact: true }).waitFor();
      await page.getByText(theme === 'dark' ? '深色' : '浅色', { exact: true }).click();
      await page.locator(`[data-theme="${theme}"]`).waitFor();
      const section = page.getByRole('region', { name: '客户端更新' });
      await section.getByRole('button', { name: '检查更新', exact: true }).click();
      await section.getByText('发现虚构新版本，仅演示界面，不访问 GitHub').waitFor();
      assert(await section.getByRole('button', { name: '重启安装', exact: true }).isDisabled());
      await section.getByRole('button', { name: '下载更新', exact: true }).click();
      await section.getByText('虚构下载完成，没有下载文件或安装软件').waitFor();
      await section.scrollIntoViewIfNeeded();
      await page.locator('.ant-message-notice').waitFor({ state: 'hidden' });
      await footerCheck(page, `updates-${theme}-${width}`);
      await shot(page, `updates-${theme}-${width}`);
      await section.getByRole('button', { name: '重启安装', exact: true }).click();
      await page.getByRole('dialog', { name: '重启并安装更新' }).waitFor();
      await page.getByRole('button', { name: /取\s*消/ }).click();
      await page.getByRole('dialog', { name: '重启并安装更新' }).waitFor({ state: 'hidden' });
      assert(await section.getByRole('button', { name: '重启安装', exact: true }).isEnabled());
      report.browser.push({
        check: `update-download-and-cancel-${theme}-${width}`,
        passed: true,
        scope: 'fictional preview; no network or installer',
      });
      await page.close();
    }
  }
}
