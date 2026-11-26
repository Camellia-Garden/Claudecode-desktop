import { _electron as electron } from 'playwright';
import { resolve, join } from 'node:path';
import { writeFileSync, readFileSync } from 'node:fs';
import assert from 'node:assert/strict';

const { version } = JSON.parse(readFileSync('package.json', 'utf8'));
const executablePath =
  process.env.CW_TEST_EXE || resolve(`release/${version}/win-unpacked/Claude Workbench.exe`);
const env = { ...process.env, CW_DATA_DIR: resolve('.test-data', `smoke-${Date.now()}`) };
delete env.ELECTRON_RUN_AS_NODE;
const app = await electron.launch({ executablePath, args: [], env, timeout: 30000 });
try {
  const page = await app.firstWindow();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.getByText('本机 Claude Code', { exact: true }).waitFor({ timeout: 30000 });
  await page.screenshot({ path: 'test-results/packaged-welcome.png', animations: 'disabled' });
  const bootstrap = await page.evaluate(() => window.desktop.bootstrap());
  assert.equal(bootstrap.cli.available, true);
  assert.equal(bootstrap.dataPath, join(env.CW_DATA_DIR, 'workspace'));
  const info = await app.evaluate(({ app }) => ({
    isPackaged: app.isPackaged,
    name: app.getName(),
    version: app.getVersion(),
  }));
  assert.equal(info.isPackaged, true);
  assert.equal(info.version, version);
  assert.ok(bootstrap.config.checkedAt);
  assert.ok(['loaded', 'missing'].includes(bootstrap.config.state));
  for (const theme of ['dark', 'light']) {
    await page.evaluate((theme) => {
      document.documentElement.dataset.theme = theme;
    }, theme);
    const loaded = await page.evaluate(async () => {
      const url = /url\("?(.*?)"?\)/.exec(
        getComputedStyle(document.body, '::before').backgroundImage,
      )[1];
      const image = new Image();
      image.src = url;
      await image.decode();
      return image.naturalWidth;
    });
    assert.equal(loaded, 1536, `Packaged ${theme} wallpaper should load`);
  }
  await page.evaluate(() => {
    document.documentElement.dataset.theme = 'dark';
  });
  await page.getByRole('button', { name: /^设置/ }).click();
  await page.getByRole('button', { name: '浅色', exact: true }).click();
  await page.getByRole('button', { name: '关闭弹窗' }).click();
  await page.screenshot({
    path: 'test-results/packaged-welcome-light.png',
    animations: 'disabled',
  });
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(900, 620));
  await page.screenshot({ path: 'test-results/packaged-compact.png', animations: 'disabled' });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  assert.equal(errors.length, 0, errors.join('\n'));
  writeFileSync(
    'test-results/smoke.json',
    JSON.stringify({ passed: true, ...info, rendererErrors: errors }, null, 2),
  );
  console.log(
    'Final packaged application smoke passed, including light theme and minimum window size.',
  );
} finally {
  await app.close();
}
