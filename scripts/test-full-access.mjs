import { _electron as electron } from 'playwright';
import electronPath from 'electron';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import assert from 'node:assert/strict';

const root = resolve('.');
const dataDir = resolve('.test-data', 'full-access-' + Date.now());
const projectPath = join(dataDir, 'isolated-project');
const marker = 'FULL-ACCESS-' + Date.now();
mkdirSync(projectPath, { recursive: true });
mkdirSync('test-results', { recursive: true });
const env = { ...process.env, CW_DATA_DIR: dataDir };
delete env.ELECTRON_RUN_AS_NODE;
let app;
let sessionId;
try {
  app = await electron.launch({ executablePath: electronPath, args: [root], env, timeout: 30000 });
  const page = await app.firstWindow();
  await page.getByRole('combobox', { name: '权限模式', exact: true }).waitFor();
  await page
    .getByRole('combobox', { name: '权限模式', exact: true })
    .selectOption('bypassPermissions');
  await page
    .getByText('已保存完全访问：后续任务无需逐项授权，当前任务保持原权限', { exact: true })
    .waitFor();
  await page.getByRole('button', { name: '打开项目文件夹', exact: true }).click();
  await page.getByRole('textbox', { name: '项目文件夹路径' }).fill(projectPath);
  await page.getByRole('button', { name: '打开项目', exact: true }).click();
  await page
    .getByRole('textbox', { name: '发送给 Claude 的消息' })
    .fill(
      '这是隔离的桌面权限验证。请直接完成两个工具操作，不提问：' +
        '1. 必须使用 Write 工具在当前目录创建 permission-check.txt，内容仅为 ' +
        marker +
        '。' +
        '2. 必须使用 Bash 工具运行 echo ' +
        marker +
        '。' +
        '完成后回复该标识。只操作当前目录，不读取外部文件、不联网、不安装依赖或执行其他命令。',
    );
  await page.getByRole('button', { name: '发送消息', exact: true }).click();
  await page.getByRole('button', { name: '停止生成', exact: true }).waitFor({ timeout: 30000 });
  const initial = await page.evaluate(() => window.desktop.bootstrap());
  sessionId = initial.sessions[0].id;
  await page.getByRole('button', { name: '关闭窗口', exact: true }).click();
  assert.equal(
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isVisible()),
    false,
  );
  await app.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0].show();
  });
  let session;
  let lastProgress = '';
  const deadline = Date.now() + 240000;
  while (Date.now() < deadline) {
    const state = await page.evaluate(
      async (id) => ({
        session: await window.desktop.getSession(id),
        permissions: await window.desktop.pendingPermissions(),
      }),
      sessionId,
    );
    assert.equal(
      state.permissions.length,
      0,
      'Full access must not create approval cards for this fixture',
    );
    session = state.session;
    const tools = session.messages.flatMap((message) =>
      message.blocks.filter((block) => block.type === 'tool'),
    );
    const progress =
      session.status + ': ' + tools.map((tool) => tool.name + '/' + tool.state).join(', ');
    if (progress !== lastProgress) console.log('Full-access fixture ' + (lastProgress = progress));
    if (!['running', 'waiting'].includes(session.status)) break;
    await page.waitForTimeout(750);
  }
  assert.equal(session?.status, 'idle', 'The full-access fixture must finish successfully');
  assert.equal(session.permissionMode, 'bypassPermissions');
  assert.equal(readFileSync(join(projectPath, 'permission-check.txt'), 'utf8').trim(), marker);
  const tools = session.messages.flatMap((message) =>
    message.blocks.filter((block) => block.type === 'tool'),
  );
  for (const name of ['Write', 'Bash'])
    assert.ok(
      tools.some((tool) => tool.name === name && tool.state === 'done'),
      name + ' must execute',
    );
  await page.screenshot({ path: 'test-results/full-access.png', animations: 'disabled' });
  writeFileSync(
    'test-results/full-access.json',
    JSON.stringify(
      {
        passed: true,
        permissionMode: session.permissionMode,
        model: session.model,
        approvalPrompts: 0,
        verifiedTools: ['Write', 'Bash'],
        closedWhileRunning: true,
        dataDir,
      },
      null,
      2,
    ),
  );
  console.log(
    'Real full access passed: Write + Bash, zero approvals, and window close did not stop the task.',
  );
} finally {
  if (app) {
    if (sessionId) {
      const page = await app.firstWindow().catch(() => null);
      await page?.evaluate((id) => window.desktop.stopSession(id), sessionId).catch(() => {});
    }
    await app.close().catch(() => {});
  }
}
