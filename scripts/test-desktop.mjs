import { _electron as electron } from 'playwright';
import electronPath from 'electron';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import assert from 'node:assert/strict';
import { Store } from '../dist-electron/electron/store.js';

const root = resolve('.');
const dataDir = resolve('.test-data', `desktop-${Date.now()}`);
const projectPath = join(dataDir, '示例项目 with spaces');
mkdirSync(projectPath, { recursive: true });
mkdirSync('test-results', { recursive: true });
writeFileSync(join(projectPath, 'README.md'), '# UI test fixture\n', 'utf8');
const store = new Store(join(dataDir, 'workspace'));
const project = store.addProject(projectPath);
const session = store.newSession(project.id);
session.title = '界面验证 · 工具与思考';
session.messages = [
  {
    id: 'test-user',
    role: 'user',
    createdAt: session.createdAt,
    blocks: [{ type: 'text', text: '检查项目结构，并说明接下来需要完成的工作。' }],
  },
  {
    id: 'test-assistant',
    role: 'assistant',
    createdAt: session.createdAt,
    blocks: [
      {
        type: 'thinking',
        text: '这是一段仅用于界面验证的思考示例。先检查入口文件，再梳理各模块之间的关系。',
        durationMs: 4000,
      },
      {
        type: 'tool',
        id: 'test-read',
        name: 'Read',
        input: { file_path: 'README.md' },
        output: '# UI test fixture\n这份内容仅用于验证工具卡片。',
        state: 'done',
      },
      {
        type: 'tool',
        id: 'test-edit',
        name: 'Edit',
        input: {
          file_path: 'src/App.tsx',
          old_string: 'const ready = false;',
          new_string: 'const ready = true;',
        },
        output: '示例差异，未实际修改文件。',
        state: 'done',
      },
      {
        type: 'text',
        text: '已经梳理了项目结构。这是**界面测试数据**，并非模型执行结果。\n\n- `electron/` 管理本地进程与会话。\n- `src/` 提供聊天界面与项目侧栏。\n- `shared/` 定义两者之间的消息格式。\n\n```typescript\nconst workspace = { ready: true };\n```\n\n下一步可以继续验证会话保存与恢复。',
      },
    ],
  },
];
store.save(session);
const configDir = join(dataDir, 'claude-config');
mkdirSync(configDir);
const settingsFile = join(configDir, 'settings.json');
const settingsText = (model) =>
  JSON.stringify({ env: { ANTHROPIC_MODEL: model, ANTHROPIC_AUTH_TOKEN: 'private-ui-fixture' } });
writeFileSync(settingsFile, settingsText('fixture-model-one'));
const env = { ...process.env, CW_DATA_DIR: dataDir, CLAUDE_CONFIG_DIR: configDir };
delete env.ELECTRON_RUN_AS_NODE;
const errors = [];
let app;
try {
  app = await electron.launch({ executablePath: electronPath, args: [root], env, timeout: 30000 });
  const page = await app.firstWindow();
  page.on('pageerror', (error) => errors.push(error.message));
  await page.getByText('本机 Claude Code', { exact: true }).waitFor({ timeout: 30000 });
  const initialConfig = await page.evaluate(() => window.desktop.bootstrap());
  assert.equal(initialConfig.config.configuredModel, 'fixture-model-one');
  assert.doesNotMatch(JSON.stringify(initialConfig), /private-ui-fixture/);
  writeFileSync(settingsFile, settingsText('fixture-model-two'));
  await page.getByRole('button', { name: '同步本机配置', exact: true }).click();
  await page
    .getByText('已同步本机配置，下一条消息将重新读取；进行中的任务不受影响', { exact: true })
    .waitFor();
  await page.getByRole('button', { name: /^设置/ }).click();
  await page.getByText('fixture-model-two', { exact: true }).waitFor();
  await page.screenshot({ path: 'test-results/desktop-config-sync.png', animations: 'disabled' });
  await page.getByRole('button', { name: '关闭弹窗' }).click();
  assert.match(
    await page.evaluate(() => getComputedStyle(document.body, '::before').backgroundImage),
    /night-fox/,
  );
  await page.getByText('界面验证 · 工具与思考', { exact: true }).click();
  await page.getByText('界面测试数据', { exact: false }).first().waitFor();
  await page.locator('.thinking-block summary').click();
  await page.locator('.tool-block').first().locator('summary').click();
  assert.ok(await page.getByText('这份内容仅用于验证工具卡片。', { exact: false }).isVisible());
  await page.screenshot({ path: 'test-results/desktop-chat-dark.png', animations: 'disabled' });
  await page.getByRole('button', { name: '项目记忆', exact: true }).click();
  await page.getByLabel('共享备注').fill('UI 检查备注，重启后应保留。');
  await page.getByLabel('下一条消息附带这些备注').check();
  await page.getByRole('button', { name: '保存记忆', exact: true }).click();
  await page.getByText('项目记忆已保存', { exact: true }).waitFor();
  await page.getByRole('button', { name: '关闭项目记忆' }).click();
  await page.getByRole('button', { name: '搜索对话', exact: false }).first().click();
  await page.getByRole('textbox', { name: '搜索对话内容' }).fill('ready');
  await page.locator('.search-result').first().waitFor();
  assert.equal(await page.locator('.search-result').count(), 1);
  await page.getByRole('button', { name: '关闭弹窗' }).click();
  await page.getByRole('button', { name: '切换深浅主题' }).click();
  assert.equal(await page.locator('html').getAttribute('data-theme'), 'light');
  assert.match(
    await page.evaluate(() => getComputedStyle(document.body, '::before').backgroundImage),
    /frost-queen/,
  );
  await page.screenshot({ path: 'test-results/desktop-chat-light.png', animations: 'disabled' });
  const secondPath = join(dataDir, '另一个项目');
  mkdirSync(secondPath, { recursive: true });
  await page.getByRole('button', { name: '添加项目', exact: true }).click();
  await page.getByRole('textbox', { name: '项目文件夹路径' }).fill(secondPath);
  await page.getByRole('button', { name: '打开项目', exact: true }).click();
  await page.getByText('另一个项目', { exact: true }).first().waitFor();
  await page.evaluate(
    async ({ id }) => {
      await window.desktop.updateSession(id, {
        title: '重启后仍可找到',
        pinned: true,
        archived: true,
      });
    },
    { id: session.id },
  );
  await page.getByRole('button', { name: '归档会话', exact: true }).click();
  await page.getByText('重启后仍可找到', { exact: true }).click();
  await page.getByText('界面测试数据', { exact: false }).first().waitFor();
  assert.equal(errors.length, 0, errors.join('\n'));
  await app.close();
  app = await electron.launch({ executablePath: electronPath, args: [root], env, timeout: 30000 });
  const restored = await app.firstWindow();
  await restored.getByText('界面测试数据', { exact: false }).first().waitFor({ timeout: 30000 });
  assert.equal(await restored.locator('html').getAttribute('data-theme'), 'light');
  const state = await restored.evaluate(() => window.desktop.bootstrap());
  assert.equal(
    state.projects.find((item) => item.id === project.id).notes,
    'UI 检查备注，重启后应保留。',
  );
  assert.equal(state.sessions.find((item) => item.id === session.id).archived, true);
  const overflow = await restored.evaluate(() => document.documentElement.scrollWidth > innerWidth);
  assert.equal(overflow, false);
  await restored.getByRole('button', { name: '切换深浅主题' }).click();
  await restored.getByRole('button', { name: '新对话', exact: false }).first().click();
  await restored.screenshot({ path: 'test-results/desktop-welcome.png', animations: 'disabled' });
  writeFileSync(
    'test-results/desktop-ui.json',
    JSON.stringify(
      {
        passed: true,
        assertions: [
          'rendered thinking and tools',
          'startup configuration detection and one-click refresh',
          'no credentials exposed in IPC',
          'dark and light wallpaper mapping',
          'search full text',
          'project path with spaces and Chinese',
          'notes saved',
          'theme persisted',
          'archive persisted',
          'session restored',
          'no horizontal overflow',
          'no renderer errors',
        ],
        dataDir,
      },
      null,
      2,
    ),
  );
  console.log(
    'Desktop UI passed: rendering, search, project picker, notes, theme, archive and restart.',
  );
} finally {
  if (app) await app.close().catch(() => {});
}
