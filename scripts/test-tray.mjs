import { _electron as electron } from 'playwright';
import electronPath from 'electron';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { once } from 'node:events';
import assert from 'node:assert/strict';

const root = resolve('.');
const dataDir = resolve('.test-data', 'tray-' + Date.now());
mkdirSync(dataDir, { recursive: true });
mkdirSync('test-results', { recursive: true });
const wrapper = join(dataDir, 'entry.mjs');
// Capture native Tray instances in this test process without production test hooks.
writeFileSync(
  wrapper,
  [
    "import { Tray } from 'electron';",
    'globalThis.__trayCreations = 0;',
    'const originalTooltip = Tray.prototype.setToolTip;',
    'Tray.prototype.setToolTip = function (text) {',
    '  if (globalThis.__testTray !== this) globalThis.__trayCreations++;',
    '  globalThis.__testTray = this;',
    '  return originalTooltip.call(this, text);',
    '};',
    'const originalMenu = Tray.prototype.setContextMenu;',
    'Tray.prototype.setContextMenu = function (menu) {',
    '  globalThis.__testTrayMenu = menu;',
    '  return originalMenu.call(this, menu);',
    '};',
    'await import(' +
      JSON.stringify(pathToFileURL(join(root, 'dist-electron/electron/main.js')).href) +
      ');',
  ].join('\n'),
);
const env = { ...process.env, CW_DATA_DIR: dataDir };
delete env.ELECTRON_RUN_AS_NODE;
let app;
try {
  app = await electron.launch({
    executablePath: electronPath,
    args: [wrapper],
    env,
    timeout: 30000,
  });
  const page = await app.firstWindow();
  await page.getByRole('button', { name: '关闭窗口', exact: true }).waitFor();
  const startup = await app.evaluate(() => ({
    tray: !!globalThis.__testTray && !globalThis.__testTray.isDestroyed(),
    count: globalThis.__trayCreations,
  }));
  assert.equal(startup.tray, true, 'A native tray icon must exist from application startup');
  assert.equal(startup.count, 1);
  for (let attempt = 0; attempt < 2; attempt++) {
    await page.getByRole('button', { name: '关闭窗口', exact: true }).click();
    await assert.doesNotReject(async () => {
      await page.waitForTimeout(150);
      const state = await app.evaluate(({ BrowserWindow }) => ({
        windows: BrowserWindow.getAllWindows().length,
        visible: BrowserWindow.getAllWindows()[0]?.isVisible(),
        tray: !globalThis.__testTray.isDestroyed(),
        count: globalThis.__trayCreations,
      }));
      assert.deepEqual(state, { windows: 1, visible: false, tray: true, count: 1 });
    });
    await app.evaluate(() => globalThis.__testTray.emit('click'));
    assert.equal(
      await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isVisible()),
      true,
    );
  }
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].minimize());
  await app.evaluate(() => globalThis.__testTray.emit('double-click'));
  assert.equal(
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isMinimized()),
    false,
  );
  const child = app.process();
  const exited = once(child, 'exit');
  await app.evaluate(() => {
    const item = globalThis.__testTrayMenu.getMenuItemById('quit-workbench');
    if (!item) throw new Error('The tray must have an explicit exit command');
    setTimeout(() => item.click(), 0);
  });
  const [exitCode] = await Promise.race([
    exited,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error('Tray exit timed out')), 20000).unref(),
    ),
  ]);
  assert.equal(exitCode, 0);
  writeFileSync(
    'test-results/tray.json',
    JSON.stringify(
      {
        passed: true,
        nativeTrayOnStartup: true,
        closeHidesWindow: true,
        singleClickRestores: true,
        doubleClickRestoresMinimized: true,
        trayExit: true,
      },
      null,
      2,
    ),
  );
  app = null;
  console.log(
    'Native tray passed: startup, repeated close/hide, click restore, minimize restore and explicit exit.',
  );
} finally {
  if (app) await app.close().catch(() => {});
}
