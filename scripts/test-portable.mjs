import { chromium } from 'playwright';
import { spawn, execFileSync } from 'node:child_process';
import { createServer } from 'node:net';
import { once } from 'node:events';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, join } from 'node:path';
import assert from 'node:assert/strict';

const { version } = JSON.parse(readFileSync('package.json', 'utf8'));
const dataDir = resolve('.test-data', `portable-${Date.now()}`);
mkdirSync(dataDir, { recursive: true });
mkdirSync('test-results', { recursive: true });
const probe = createServer();
probe.listen(0, '127.0.0.1');
await once(probe, 'listening');
const port = probe.address().port;
await new Promise((done) => probe.close(done));
const env = { ...process.env, CW_DATA_DIR: dataDir };
delete env.ELECTRON_RUN_AS_NODE;
const child = spawn(
  resolve(`release/${version}/Claude-Workbench-${version}.exe`),
  [`--remote-debugging-port=${port}`],
  { env, windowsHide: true, stdio: 'ignore' },
);
let launchError;
child.on('error', (error) => {
  launchError = error;
});
let browser;
try {
  const deadline = Date.now() + 90000;
  while (Date.now() < deadline) {
    if (launchError) throw launchError;
    if (child.exitCode !== null)
      throw new Error(`Portable exited before startup: ${child.exitCode}`);
    try {
      // Keep native focus/visibility instead of Playwright's default emulation.
      browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`, {
        timeout: 1000,
        noDefaults: true,
      });
      break;
    } catch {
      await new Promise((done) => setTimeout(done, 500));
    }
  }
  assert.ok(browser, 'Portable executable must start its Electron window');
  const context = browser.contexts()[0];
  const page = context.pages()[0] || (await context.waitForEvent('page'));
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.getByText('本机 Claude Code', { exact: true }).waitFor({ timeout: 30000 });
  const data = await page.evaluate(() => window.desktop.bootstrap());
  assert.equal(data.appVersion, version);
  assert.equal(data.dataPath, join(dataDir, 'workspace'));
  assert.equal(data.cli.available, true);
  assert.ok(['loaded', 'missing'].includes(data.config.state));
  await page.getByRole('button', { name: '同步本机配置', exact: true }).click();
  await page
    .getByText('已同步本机配置，下一条消息将重新读取；进行中的任务不受影响', { exact: true })
    .waitFor();
  await page.getByRole('button', { name: '切换深浅主题' }).click();
  const width = await page.evaluate(async () => {
    const url = /url\("?(.*?)"?\)/.exec(
      getComputedStyle(document.body, '::before').backgroundImage,
    )[1];
    const image = new Image();
    image.src = url;
    await image.decode();
    return image.naturalWidth;
  });
  assert.equal(width, 1536);
  assert.equal(errors.length, 0, errors.join('\n'));
  await page.screenshot({ path: 'test-results/portable-light.png', animations: 'disabled' });
  await page.getByRole('button', { name: '关闭窗口', exact: true }).click();
  // Animation frames pause once the window hides, so poll with a timer instead.
  await page.waitForFunction(() => document.hidden, undefined, { polling: 100 });
  assert.equal(child.exitCode, null, 'Closing the window should keep the portable app in its tray');
  await page.evaluate(() => window.desktop.quitApp());
  if (child.exitCode === null) {
    await Promise.race([
      once(child, 'exit'),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Portable did not exit cleanly')), 20000).unref(),
      ),
    ]);
  }
  assert.equal(child.exitCode, 0);
  writeFileSync(
    'test-results/portable.json',
    JSON.stringify(
      {
        passed: true,
        version,
        dataDir,
        startupSync: true,
        manualSync: true,
        wallpaperLoaded: true,
        closeToTray: true,
        cleanExit: true,
      },
      null,
      2,
    ),
  );
  console.log(
    'Single-file portable EXE passed: extraction, startup, local config, manual sync, wallpaper and clean exit.',
  );
} finally {
  await browser?.close().catch(() => {});
  if (child.exitCode === null && child.pid) {
    // Only the process launched for this isolated test may be terminated.
    execFileSync('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], {
      windowsHide: true,
      stdio: 'ignore',
    });
  }
}
