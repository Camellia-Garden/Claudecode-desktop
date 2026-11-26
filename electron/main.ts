import { app, BrowserWindow, ipcMain, dialog, shell, Tray, Menu, nativeImage } from 'electron';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { stat, realpath, writeFile } from 'node:fs/promises';
import { Store } from './store.js';
import { ClaudeRunner } from './runner.js';
import { inspectLocalConfig } from './config.js';
import type { AppEvent, Session, Theme, PermissionAnswer } from '../shared/types.js';

const here = dirname(fileURLToPath(import.meta.url));
const appRoot = resolve(here, '../..');
const devUrl = !app.isPackaged ? process.env.CW_DEV_URL : undefined;
if (process.env.CW_DATA_DIR) app.setPath('userData', resolve(process.env.CW_DATA_DIR));
app.setName('Claude Workbench');
app.setAppUserModelId('local.claude.workbench');

let window: BrowserWindow | null = null;
let tray: Tray | null = null;
let quitting = false;
let closing = false;
let store: Store;
let runner: ClaudeRunner;

function emit(event: AppEvent) {
  if (window && !window.isDestroyed()) window.webContents.send('app:event', event);
}

function handle(channel: string, fn: (...args: any[]) => any) {
  ipcMain.handle(channel, (event, ...args) => {
    if (
      !window ||
      event.sender.id !== window.webContents.id ||
      event.senderFrame !== window.webContents.mainFrame
    )
      throw new Error('不允许的请求来源');
    return fn(...args);
  });
}

function textArg(value: unknown, max = 100_000): string {
  if (typeof value !== 'string' || value.length > max) throw new Error('无效参数');
  return value;
}

async function addProject(value: string) {
  const path = await realpath(resolve(textArg(value, 4000)));
  if (!(await stat(path)).isDirectory()) throw new Error('请选择一个文件夹');
  const project = store.addProject(path);
  emit({ type: 'projects', projects: store.projects });
  return project;
}

function markdown(session: Session): string {
  const parts = [
    `# ${session.title}`,
    `项目：${store.project(session.projectId).path}`,
    `导出时间：${new Date().toISOString()}`,
  ];
  for (const message of session.messages) {
    parts.push(`## ${message.role === 'user' ? '你' : 'Claude'}`);
    for (const block of message.blocks) {
      if (block.type === 'text') parts.push(block.text);
      else if (block.type === 'thinking')
        parts.push(`<details><summary>思考</summary>\n\n${block.text}\n\n</details>`);
      else if (block.type === 'notice') parts.push(`> ${block.text.replace(/\n/g, '\n> ')}`);
      else {
        const content = `输入：\n${JSON.stringify(block.input, null, 2)}\n\n输出：\n${block.output || '无'}`;
        const fence = '`'.repeat(
          Math.max(3, ...[...content.matchAll(/`+/g)].map((match) => match[0].length + 1)),
        );
        parts.push(`### ${block.name}\n\n${fence}text\n${content}\n${fence}`);
      }
    }
  }
  return parts.join('\n\n') + '\n';
}

function registerIPC() {
  const syncConfig = async () => {
    const [cli, config] = await Promise.all([runner.detect(), inspectLocalConfig()]);
    return { cli, config };
  };
  handle('app:config-sync', syncConfig);
  handle('app:bootstrap', async () => ({
    projects: store.projects,
    sessions: store.list(),
    theme: store.theme,
    ...(await syncConfig()),
    dataPath: store.root,
    appVersion: app.getVersion(),
  }));
  handle('project:choose', async () => {
    const result = await dialog.showOpenDialog(window!, {
      title: '选择 Claude Code 工作文件夹',
      properties: ['openDirectory'],
    });
    return result.canceled || !result.filePaths[0] ? null : addProject(result.filePaths[0]);
  });
  handle('project:add', addProject);
  handle('session:new', (id) => store.newSession(textArg(id, 80)));
  handle('session:get', (id) => store.get(textArg(id, 80)));
  handle('session:send', (input) => {
    if (!input || !Array.isArray(input.referenceIds) || input.referenceIds.length > 5)
      throw new Error('无效消息');
    return runner.start({
      sessionId: textArg(input.sessionId, 80),
      text: textArg(input.text),
      referenceIds: input.referenceIds.map((id: unknown) => textArg(id, 80)),
    });
  });
  handle('session:stop', (id) => runner.stop(textArg(id, 80)));
  handle('session:update', (id, patch) => {
    if (!patch || typeof patch !== 'object') throw new Error('无效修改');
    const session = store.update(textArg(id, 80), {
      title: patch.title === undefined ? undefined : textArg(patch.title, 120),
      archived: typeof patch.archived === 'boolean' ? patch.archived : undefined,
      pinned: typeof patch.pinned === 'boolean' ? patch.pinned : undefined,
    });
    emit({ type: 'session', session });
    return session;
  });
  handle('permission:answer', (answer: PermissionAnswer) => {
    if (!answer || typeof answer.allow !== 'boolean') throw new Error('无效授权应答');
    if (
      answer.answers &&
      (typeof answer.answers !== 'object' ||
        Object.values(answer.answers).some((value) => typeof value !== 'string'))
    )
      throw new Error('无效回答');
    runner.answer({ ...answer, id: textArg(answer.id, 80) });
  });
  handle('permission:pending', () => runner.pending());
  handle('session:search', (value) => store.search(textArg(value, 500)));
  handle('history:list', (id) => runner.history(textArg(id, 80)));
  handle('history:import', (id, ids) => {
    if (!Array.isArray(ids) || ids.length > 50) throw new Error('每次最多导入 50 个会话');
    return runner.importHistory(
      textArg(id, 80),
      ids.map((item) => textArg(item, 80)),
    );
  });
  handle('project:notes', (id, notes, enabled) => {
    if (typeof enabled !== 'boolean') throw new Error('无效开关');
    const project = store.updateNotes(textArg(id, 80), textArg(notes, 40_000), enabled);
    emit({ type: 'projects', projects: store.projects });
    return project;
  });
  handle('app:theme', (theme: Theme) => store.setTheme(theme));
  handle('session:export', async (id) => {
    const session = store.get(textArg(id, 80));
    const result = await dialog.showSaveDialog(window!, {
      title: '导出对话',
      defaultPath: `${session.title.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_')}.md`,
      filters: [{ name: 'Markdown', extensions: ['md'] }],
    });
    if (result.canceled || !result.filePath) return null;
    await writeFile(result.filePath, markdown(session), 'utf8');
    return result.filePath;
  });
  handle('project:show', async (id) => {
    const result = await shell.openPath(store.project(textArg(id, 80)).path);
    if (result) throw new Error(result);
  });
  handle('app:external', async (value) => {
    const url = new URL(textArg(value, 4000));
    if (!['https:', 'http:'].includes(url.protocol)) throw new Error('只支持 HTTP / HTTPS 链接');
    await shell.openExternal(url.href);
  });
  handle('window:minimize', () => window?.minimize());
  handle('window:maximize', () =>
    window?.isMaximized() ? window.unmaximize() : window?.maximize(),
  );
  handle('window:close', () => window?.close());
}

function createTray() {
  if (tray) return;
  tray = new Tray(nativeImage.createFromPath(join(appRoot, 'assets', 'icon.png')));
  tray.setToolTip('Claude Workbench · 任务在后台运行');
  tray.setContextMenu(
    Menu.buildFromTemplate([
      {
        label: '打开 Claude Workbench',
        click: () => {
          window?.show();
          window?.focus();
        },
      },
      { type: 'separator' },
      {
        label: '停止任务并退出',
        click: async () => {
          await runner.stopAll();
          quitting = true;
          app.quit();
        },
      },
    ]),
  );
  tray.on('double-click', () => {
    window?.show();
    window?.focus();
  });
}

async function createWindow() {
  window = new BrowserWindow({
    width: 1360,
    height: 900,
    minWidth: 900,
    minHeight: 620,
    title: 'Claude Workbench',
    backgroundColor: '#161718',
    show: false,
    frame: false,
    icon: join(appRoot, 'assets', 'icon.png'),
    webPreferences: {
      preload: join(here, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
    },
  });
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', (event) => event.preventDefault());
  window.webContents.session.setPermissionRequestHandler((_contents, _permission, callback) =>
    callback(false),
  );
  window.on('close', (event) => {
    if (quitting || !runner.activeCount) return;
    event.preventDefault();
    if (closing) return;
    closing = true;
    void dialog
      .showMessageBox(window!, {
        type: 'question',
        title: 'Claude 仍在工作',
        message: '当前还有任务正在运行',
        detail: '可以留在托盘继续工作，或停止任务并退出。对话记录会保留。',
        buttons: ['留在后台', '停止并退出', '取消'],
        defaultId: 0,
        cancelId: 2,
      })
      .then(async (result) => {
        if (result.response === 0) {
          createTray();
          window?.hide();
        }
        if (result.response === 1) {
          await runner.stopAll();
          quitting = true;
          app.quit();
        }
      })
      .finally(() => {
        closing = false;
      });
  });
  window.on('closed', () => {
    window = null;
  });
  window.once('ready-to-show', () => {
    window?.show();
    for (const warning of store.warnings) emit({ type: 'notice', text: warning });
  });
  if (devUrl) await window.loadURL(devUrl);
  else await window.loadFile(join(appRoot, 'dist', 'index.html'));
}

if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', () => {
    if (window?.isMinimized()) window.restore();
    window?.show();
    window?.focus();
  });
  app
    .whenReady()
    .then(async () => {
      store = new Store(join(app.getPath('userData'), 'workspace'));
      runner = new ClaudeRunner(store, emit);
      registerIPC();
      Menu.setApplicationMenu(null);
      await createWindow();
    })
    .catch((error) => {
      dialog.showErrorBox('Claude Workbench 启动失败', String(error));
      app.quit();
    });
  app.on('window-all-closed', () => {
    if (!runner?.activeCount) app.quit();
  });
  app.on('before-quit', () => {
    quitting = true;
  });
}
