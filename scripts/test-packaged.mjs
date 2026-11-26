import { _electron as electron } from 'playwright';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import assert from 'node:assert/strict';

const connection = JSON.parse(readFileSync('test-results/connection.json', 'utf8'));
const { version } = JSON.parse(readFileSync('package.json', 'utf8'));
assert.equal(connection.passed, true, 'Run the real connection test successfully first');
const projectPath = join(connection.dataDir, 'connection-project');
const marker = /HANDSHAKE=(\S+)/.exec(readFileSync(join(projectPath, 'README.md'), 'utf8'))[1];
const dataDir = resolve('.test-data', `packaged-${Date.now()}`);
mkdirSync(dataDir, { recursive: true });
const env = { ...process.env, CW_DATA_DIR: dataDir };
delete env.ELECTRON_RUN_AS_NODE;
let app;
try {
  app = await electron.launch({
    executablePath: resolve(`release/${version}/win-unpacked/Claude Workbench.exe`),
    args: [],
    env,
    timeout: 30000,
  });
  const page = await app.firstWindow();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.getByText('本机 Claude Code', { exact: true }).waitFor({ timeout: 30000 });
  await page.screenshot({ path: 'test-results/packaged-welcome.png', animations: 'disabled' });
  const bootstrap = await page.evaluate(() => window.desktop.bootstrap());
  assert.equal(
    bootstrap.dataPath,
    join(dataDir, 'workspace'),
    'Packaged tests must use isolated data',
  );
  await page.getByRole('button', { name: '打开项目文件夹', exact: true }).click();
  await page.getByRole('textbox', { name: '项目文件夹路径' }).fill(projectPath);
  await page.getByRole('button', { name: '打开项目', exact: true }).click();
  await page.getByRole('button', { name: '导入终端历史', exact: true }).click();
  await page.locator('.history-entry').first().waitFor({ timeout: 30000 });
  await page.locator('.history-entry input').first().check();
  await page.getByRole('button', { name: /导入 1 个会话/ }).click();
  await page.locator('.session-row').first().waitFor();
  await page.locator('.session-row').first().click();
  await page.locator('.assistant-content').first().waitFor();
  const imported = await page.evaluate(async () => {
    const state = await window.desktop.bootstrap();
    return window.desktop.getSession(state.sessions[0].id);
  });
  assert.equal(imported.imported, true);
  assert.ok(imported.messages.length >= 4);
  assert.ok(
    imported.messages.some((message) =>
      message.blocks.some((block) => block.type === 'tool' && block.name === 'Read'),
    ),
  );
  await page
    .getByRole('textbox', { name: '发送给 Claude 的消息' })
    .fill('这是打包后的客户端验证。请只回复之前读到的 HANDSHAKE 值，不要调用任何工具。');
  await page.getByRole('button', { name: '发送消息', exact: true }).click();
  let session;
  const started = Date.now();
  while (Date.now() - started < 180000) {
    await page.waitForTimeout(1000);
    session = await page.evaluate((id) => window.desktop.getSession(id), imported.id);
    if (
      session.messages.length > imported.messages.length &&
      !['running', 'waiting'].includes(session.status)
    )
      break;
  }
  assert.equal(session?.status, 'idle');
  assert.equal(session.cliSessionId, imported.cliSessionId);
  assert.ok(
    session.messages
      .at(-1)
      .blocks.some((block) => block.type === 'text' && block.text.includes(marker)),
  );
  assert.equal(errors.length, 0, errors.join('\n'));
  await page.screenshot({ path: 'test-results/packaged-chat.png', animations: 'disabled' });
  writeFileSync(
    'test-results/packaged.json',
    JSON.stringify(
      {
        passed: true,
        importedCliHistory: true,
        resumedImportedSession: true,
        sameCliSession: true,
        rendererErrors: errors,
        dataDir,
      },
      null,
      2,
    ),
  );
  console.log(
    'Packaged EXE passed: startup, local CLI detection, CLI history import and actual resume from imported history.',
  );
} finally {
  if (app) {
    const page = await app.firstWindow().catch(() => null);
    if (page)
      await page
        .evaluate(async () => {
          const data = await window.desktop.bootstrap();
          await Promise.all(
            data.sessions
              .filter((session) => ['running', 'waiting'].includes(session.status))
              .map((session) => window.desktop.stopSession(session.id)),
          );
        })
        .catch(() => {});
    await app.close().catch(() => {});
  }
}
