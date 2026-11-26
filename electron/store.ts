import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
  readdirSync,
  copyFileSync,
} from 'node:fs';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { Project, Session, SessionSummary, Theme, SearchResult } from '../shared/types.js';

interface Settings {
  projects: Project[];
  theme: Theme;
}

export function summarize(session: Session): SessionSummary {
  const { messages: _messages, lastUsage: _usage, ...summary } = session;
  return summary;
}

export function messageText(session: Session): string {
  return session.messages
    .map((message) =>
      message.blocks
        .map((block) => {
          if (block.type === 'text' || block.type === 'thinking' || block.type === 'notice')
            return block.text;
          return `${block.name}\n${JSON.stringify(block.input)}\n${block.output || ''}`;
        })
        .join('\n'),
    )
    .join('\n\n');
}

function atomicWrite(path: string, value: unknown) {
  const temporary = `${path}.tmp`;
  writeFileSync(temporary, JSON.stringify(value, null, 2), 'utf8');
  renameSync(temporary, path);
}

export class Store {
  private settings: Settings;
  private sessions = new Map<string, Session>();
  readonly warnings: string[] = [];

  constructor(readonly root: string) {
    mkdirSync(join(root, 'sessions'), { recursive: true });
    this.settings = { projects: [], theme: 'dark' };
    const settingsPath = join(root, 'settings.json');
    if (existsSync(settingsPath)) {
      try {
        const loaded = JSON.parse(readFileSync(settingsPath, 'utf8'));
        if (!Array.isArray(loaded.projects)) throw new Error('Invalid project list');
        this.settings = {
          projects: loaded.projects,
          theme: ['dark', 'light', 'system'].includes(loaded.theme) ? loaded.theme : 'dark',
        };
      } catch {
        const backup = `${settingsPath}.corrupt-${Date.now()}`;
        copyFileSync(settingsPath, backup);
        this.warnings.push('项目索引读取失败，已保留原文件备份。可以重新添加文件夹找回归档会话。');
      }
    }
    for (const name of readdirSync(join(root, 'sessions'))) {
      if (!/^[a-f0-9-]+\.json$/i.test(name)) continue;
      try {
        const session: Session = JSON.parse(readFileSync(join(root, 'sessions', name), 'utf8'));
        if (!Array.isArray(session.messages) || !session.id || !session.projectId)
          throw new Error('Invalid session');
        if (session.status === 'running' || session.status === 'waiting') {
          session.status = 'interrupted';
          for (const message of session.messages)
            for (const block of message.blocks) {
              if (block.type === 'tool' && block.state === 'running') block.state = 'interrupted';
            }
          atomicWrite(join(root, 'sessions', name), session);
        }
        this.sessions.set(session.id, session);
      } catch {
        this.warnings.push(`有一份会话记录无法读取，已原样保留：${name}`);
      }
    }
  }

  get projects() {
    return this.settings.projects;
  }
  get theme() {
    return this.settings.theme;
  }
  setTheme(theme: Theme) {
    if (!['dark', 'light', 'system'].includes(theme)) throw new Error('无效主题');
    this.settings.theme = theme;
    this.saveSettings();
  }
  private saveSettings() {
    atomicWrite(join(this.root, 'settings.json'), this.settings);
  }

  addProject(path: string): Project {
    const normalized = resolve(path);
    const existing = this.projects.find((project) =>
      process.platform === 'win32'
        ? project.path.toLowerCase() === normalized.toLowerCase()
        : project.path === normalized,
    );
    if (existing) return existing;
    const project: Project = {
      id: randomUUID(),
      name: normalized.split(/[\\/]/).filter(Boolean).at(-1) || normalized,
      path: normalized,
      createdAt: new Date().toISOString(),
      notes: '',
      notesEnabled: false,
    };
    this.settings.projects.push(project);
    this.saveSettings();
    return project;
  }

  project(id: string): Project {
    const project = this.projects.find((item) => item.id === id);
    if (!project) throw new Error('项目不存在，请重新选择文件夹');
    return project;
  }

  updateNotes(id: string, notes: string, enabled: boolean): Project {
    const project = this.project(id);
    if (notes.length > 40_000) throw new Error('项目备注最多 40,000 字符');
    project.notes = notes;
    project.notesEnabled = enabled;
    this.saveSettings();
    return project;
  }

  newSession(projectId: string): Session {
    this.project(projectId);
    const now = new Date().toISOString();
    const session: Session = {
      id: randomUUID(),
      projectId,
      title: '新对话',
      createdAt: now,
      updatedAt: now,
      archived: false,
      pinned: false,
      status: 'idle',
      preview: '',
      messageCount: 0,
      messages: [],
    };
    this.save(session);
    return session;
  }

  get(id: string): Session {
    const session = this.sessions.get(id);
    if (!session) throw new Error('会话不存在');
    return session;
  }

  list(): SessionSummary[] {
    return [...this.sessions.values()]
      .map(summarize)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  save(session: Session) {
    if (!/^[a-f0-9-]+$/i.test(session.id)) throw new Error('无效会话 ID');
    session.messageCount = session.messages.length;
    const lastUser = session.messages.findLast((message) => message.role === 'user');
    if (lastUser)
      session.preview = lastUser.blocks
        .filter((block) => block.type === 'text')
        .map((block) => block.text)
        .join('')
        .slice(0, 160);
    atomicWrite(join(this.root, 'sessions', `${session.id}.json`), session);
    this.sessions.set(session.id, session);
  }

  update(id: string, patch: { title?: string; archived?: boolean; pinned?: boolean }): Session {
    const session = this.get(id);
    if (patch.title !== undefined) {
      const title = patch.title.trim();
      if (!title || title.length > 120) throw new Error('标题需要 1–120 个字符');
      session.title = title;
    }
    if (patch.archived !== undefined) session.archived = patch.archived;
    if (patch.pinned !== undefined) session.pinned = patch.pinned;
    this.save(session);
    return session;
  }

  search(query: string): SearchResult[] {
    const needle = query.trim().toLocaleLowerCase();
    if (!needle) return [];
    const results: SearchResult[] = [];
    for (const session of this.sessions.values()) {
      const body = messageText(session);
      const index = body.toLocaleLowerCase().indexOf(needle);
      if (index < 0 && !session.title.toLocaleLowerCase().includes(needle)) continue;
      const start = Math.max(0, index - 45);
      results.push({
        sessionId: session.id,
        projectId: session.projectId,
        title: session.title,
        snippet: `${start ? '…' : ''}${body.slice(start, start + 190).replace(/\s+/g, ' ')}`,
        updatedAt: session.updatedAt,
      });
    }
    return results.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, 100);
  }
}
