import { _electron as electron } from 'playwright';
import electronPath from 'electron';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import assert from 'node:assert/strict';

const root = resolve('.');
const dataDir = resolve('.test-data', `connection-${Date.now()}`);
const projectPath = join(dataDir, 'connection-project');
mkdirSync(projectPath, { recursive: true });
mkdirSync('test-results', { recursive: true });
const marker = `WORKBENCH-${Date.now()}`;
writeFileSync(
  join(projectPath, 'README.md'),
  `# Local connection test\n\nHANDSHAKE=${marker}\n`,
  'utf8',
);
const env = { ...process.env, CW_DATA_DIR: dataDir };
delete env.ELECTRON_RUN_AS_NODE;
let app;
try {
  app = await electron.launch({ executablePath: electronPath, args: [root], env, timeout: 30000 });
  const page = await app.firstWindow();
  await page.getByText('本机 Claude Code', { exact: true }).waitFor({ timeout: 30000 });
  await page.getByRole('button', { name: '打开项目文件夹', exact: true }).click();
  await page.getByRole('textbox', { name: '项目文件夹路径' }).fill(projectPath);
  await page.getByRole('button', { name: '打开项目', exact: true }).click();
  await page
    .getByRole('textbox', { name: '发送给 Claude 的消息' })
    .fill(
      '这是桌面应用连通测试。请仅用 Read 工具读取当前目录的 README.md，并回复其中 HANDSHAKE 的值。不要修改文件，也不要执行其他操作。',
    );
  await page.getByRole('button', { name: '发送消息', exact: true }).click();
  const started = Date.now();
  let session;
  while (Date.now() - started < 600000) {
    await page.waitForTimeout(1500);
    const state = await page.evaluate(async () => {
      const data = await window.desktop.bootstrap();
      const last = data.sessions[0];
      return {
        session: last ? await window.desktop.getSession(last.id) : null,
        permissions: await window.desktop.pendingPermissions(),
      };
    });
    for (const request of state.permissions) {
      const target = request.input.file_path;
      const allow =
        request.toolName === 'Read' &&
        typeof target === 'string' &&
        resolve(projectPath, target) === join(projectPath, 'README.md');
      await page.evaluate((answer) => window.desktop.answerPermission(answer), {
        id: request.id,
        allow,
      });
    }
    session = state.session;
    if (session && !['running', 'waiting'].includes(session.status)) break;
  }
  assert.ok(session, 'No session was created');
  if (['running', 'waiting'].includes(session.status))
    await page.evaluate((id) => window.desktop.stopSession(id), session.id);
  const assistantText = session.messages
    .filter((message) => message.role === 'assistant')
    .flatMap((message) =>
      message.blocks.filter((block) => block.type === 'text').map((block) => block.text),
    )
    .join('\n');
  const notices = session.messages.flatMap((message) =>
    message.blocks.filter((block) => block.type === 'notice').map((block) => block.text),
  );
  const tools = session.messages.flatMap((message) =>
    message.blocks.filter((block) => block.type === 'tool'),
  );
  writeFileSync(
    'test-results/connection.json',
    JSON.stringify(
      {
        status: session.status,
        cliSessionId: session.cliSessionId,
        model: session.model,
        markerFound: assistantText.includes(marker),
        tools: tools.map((tool) => ({ name: tool.name, state: tool.state })),
        notices,
        dataDir,
      },
      null,
      2,
    ),
  );
  assert.equal(session.status, 'idle', `Connection failed: ${notices.join('\n')}`);
  assert.ok(
    assistantText.includes(marker),
    'The configured model did not return the fixture marker',
  );
  assert.ok(
    tools.some((tool) => tool.name === 'Read' && tool.state === 'done'),
    'Read tool output was not rendered',
  );
  await page.locator('.tool-block').first().locator('summary').click();
  await page.screenshot({ path: 'test-results/real-connection.png', animations: 'disabled' });
  console.log(
    'First turn completed: model reply and Read tool verified. Restarting to test resume.',
  );
  const cliId = session.cliSessionId;
  await app.close();
  app = await electron.launch({ executablePath: electronPath, args: [root], env, timeout: 30000 });
  const restored = await app.firstWindow();
  await restored.getByRole('textbox', { name: '发送给 Claude 的消息' }).waitFor({ timeout: 30000 });
  await restored.getByText('本机 Claude Code', { exact: true }).waitFor({ timeout: 30000 });
  await restored
    .getByRole('textbox', { name: '发送给 Claude 的消息' })
    .fill('刚才读到的 HANDSHAKE 是什么？请只回复值，不使用工具。');
  await restored.getByRole('button', { name: '发送消息', exact: true }).click();
  const resumeStarted = Date.now();
  let resumed;
  while (Date.now() - resumeStarted < 600000) {
    await restored.waitForTimeout(1500);
    resumed = await restored.evaluate((id) => window.desktop.getSession(id), session.id);
    if (
      resumed.messages.length > session.messages.length &&
      !['running', 'waiting'].includes(resumed.status)
    )
      break;
  }
  assert.equal(resumed?.status, 'idle', 'Resume did not complete');
  assert.equal(resumed.cliSessionId, cliId, 'Resume started a different CLI session');
  const last = resumed.messages.at(-1);
  assert.ok(
    last?.blocks.some((block) => block.type === 'text' && block.text.includes(marker)),
    'Resumed model did not remember the marker',
  );
  await restored.screenshot({ path: 'test-results/real-resume.png', animations: 'disabled' });
  writeFileSync(
    'test-results/connection.json',
    JSON.stringify(
      {
        passed: true,
        firstTurn: 'Read fixture and returned marker',
        resumed: true,
        sameCliSession: true,
        model: resumed.model,
        dataDir,
      },
      null,
      2,
    ),
  );
  console.log(
    'Real connection passed: local configuration, Read tool, saved transcript, app restart and same-session resume.',
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
