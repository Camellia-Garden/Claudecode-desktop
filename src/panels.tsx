import { useEffect, useState } from 'react';
import {
  Archive,
  ArrowUpRight,
  Check,
  FolderOpen,
  LoaderCircle,
  Search,
  X,
  FileText,
  Link,
  Monitor,
  Moon,
  Sun,
  Terminal,
  Download,
  RefreshCw,
} from 'lucide-react';
import type {
  Bootstrap,
  HistoryEntry,
  Project,
  SearchResult,
  SessionSummary,
  Theme,
} from '../shared/types';
import { IconButton, Modal } from './components';

export function ProjectModal({
  onClose,
  onAdded,
  onError,
}: {
  onClose: () => void;
  onAdded: (project: Project) => void;
  onError: (error: unknown) => void;
}) {
  const [path, setPath] = useState('');
  const [busy, setBusy] = useState(false);
  const add = async (choose: boolean) => {
    setBusy(true);
    try {
      const project = choose
        ? await window.desktop.chooseProject()
        : await window.desktop.addProject(path.trim());
      if (project) onAdded(project);
    } catch (error) {
      onError(error);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      title="打开一个项目"
      subtitle="选择工作文件夹，Claude Code 会在这个目录中运行。"
      onClose={onClose}
    >
      <button className="folder-picker" disabled={busy} onClick={() => void add(true)}>
        <span className="folder-picker-icon">
          <FolderOpen size={26} />
        </span>
        <strong>选择文件夹</strong>
        <span>打开系统文件夹选择器</span>
        <ArrowUpRight size={17} />
      </button>
      <div className="or-divider">
        <span>或者输入文件夹路径</span>
      </div>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void add(false);
        }}
      >
        <input
          autoFocus
          className="path-input"
          aria-label="项目文件夹路径"
          placeholder="D:\projects\my-project"
          value={path}
          onChange={(event) => setPath(event.target.value)}
        />
        <p className="field-hint">沿用本机 Claude Code 和 CC Switch 配置。</p>
        <div className="modal-actions">
          <button type="button" className="button secondary" onClick={onClose}>
            取消
          </button>
          <button className="button primary" disabled={busy || !path.trim()}>
            {busy ? <LoaderCircle size={15} className="spin" /> : <FolderOpen size={15} />}打开项目
          </button>
        </div>
      </form>
    </Modal>
  );
}

export function SearchModal({
  sessions,
  projects,
  referenceMode,
  selectedIds,
  currentId,
  onSelect,
  onClose,
  onError,
}: {
  sessions: SessionSummary[];
  projects: Project[];
  referenceMode: boolean;
  selectedIds: string[];
  currentId?: string;
  onSelect: (id: string) => void;
  onClose: () => void;
  onError: (error: unknown) => void;
}) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let cancelled = false;
    if (!query.trim()) {
      setResults([]);
      setBusy(false);
      return;
    }
    setBusy(true);
    const timer = setTimeout(() => {
      void window.desktop
        .search(query)
        .then((value) => {
          if (!cancelled) {
            setResults(value);
            setBusy(false);
          }
        })
        .catch((error) => {
          if (!cancelled) {
            onError(error);
            setBusy(false);
          }
        });
    }, 180);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query]);
  const entries = query.trim()
    ? results
    : sessions.map((session) => ({
        sessionId: session.id,
        projectId: session.projectId,
        title: session.title,
        snippet: session.preview,
        updatedAt: session.updatedAt,
      }));
  const visible = entries.filter((item) => !referenceMode || item.sessionId !== currentId);
  return (
    <Modal
      title={referenceMode ? '引用其他对话' : '搜索所有对话'}
      subtitle={
        referenceMode
          ? '选中的对话文字将作为下一条消息的背景。每段最多引用末尾 16,000 字符。'
          : '搜索本应用保存及已导入的聊天、思考与工具记录。'
      }
      onClose={onClose}
      wide
    >
      <div className="search-field">
        <Search size={18} />
        <input
          autoFocus
          aria-label="搜索对话内容"
          placeholder="搜索标题、内容、文件名…"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        {busy && <LoaderCircle size={16} className="spin" />}
      </div>
      <div className="search-results">
        {visible.length ? (
          visible.map((entry) => (
            <button
              className={`search-result ${selectedIds.includes(entry.sessionId) ? 'selected' : ''}`}
              key={entry.sessionId}
              onClick={() => onSelect(entry.sessionId)}
            >
              <span className="search-result-icon">
                {selectedIds.includes(entry.sessionId) ? (
                  <Check size={18} />
                ) : referenceMode ? (
                  <Link size={18} />
                ) : (
                  <FileText size={18} />
                )}
              </span>
              <span className="search-result-copy">
                <strong>{entry.title}</strong>
                <span>{entry.snippet || '暂无消息'}</span>
                <small>
                  {projects.find((project) => project.id === entry.projectId)?.name || '未知项目'} ·{' '}
                  {formatDate(entry.updatedAt)}
                </small>
              </span>
              <ArrowUpRight size={15} />
            </button>
          ))
        ) : (
          <div className="empty-list">
            <Search size={25} />
            <p>{query ? '没有找到匹配的对话' : '还没有其他对话'}</p>
          </div>
        )}
      </div>
      {referenceMode && (
        <div className="modal-actions">
          <span className="muted">已选择 {selectedIds.length} / 5 段对话</span>
          <button className="button primary" onClick={onClose}>
            完成选择
          </button>
        </div>
      )}
    </Modal>
  );
}

export function HistoryModal({
  project,
  onClose,
  onImported,
  onError,
}: {
  project: Project;
  onClose: () => void;
  onImported: () => void;
  onError: (error: unknown) => void;
}) {
  const [entries, setEntries] = useState<HistoryEntry[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [importing, setImporting] = useState(false);
  useEffect(() => {
    let cancelled = false;
    void window.desktop
      .listHistory(project.id)
      .then((value) => {
        if (!cancelled) setEntries(value);
      })
      .catch(onError)
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [project.id]);
  const load = async () => {
    setImporting(true);
    try {
      await window.desktop.importHistory(project.id, selected);
      onImported();
    } catch (error) {
      onError(error);
    } finally {
      setImporting(false);
    }
  };
  return (
    <Modal
      title="找回终端里的对话"
      subtitle={`读取「${project.name}」已有的 Claude Code 历史，选择后可在这里查看和继续。`}
      onClose={onClose}
      wide
    >
      <div className="history-list">
        {loading ? (
          <div className="empty-list">
            <LoaderCircle className="spin" size={24} />
            <p>正在查找本地记录…</p>
          </div>
        ) : entries.length ? (
          entries.map((entry) => (
            <label className="history-entry" key={entry.sessionId}>
              <input
                type="checkbox"
                checked={selected.includes(entry.sessionId)}
                disabled={
                  importing || (!selected.includes(entry.sessionId) && selected.length >= 50)
                }
                onChange={(event) =>
                  setSelected((previous) =>
                    event.target.checked
                      ? [...previous, entry.sessionId]
                      : previous.filter((id) => id !== entry.sessionId),
                  )
                }
              />
              <span>
                <strong>{entry.title}</strong>
                <small>{formatDate(entry.updatedAt)}</small>
              </span>
            </label>
          ))
        ) : (
          <div className="empty-list">
            <Archive size={28} />
            <p>这个文件夹还没有可导入的 CLI 会话</p>
            <span>如果之前在其他文件夹启动 Claude，请先打开对应项目。</span>
          </div>
        )}
      </div>
      <div className="modal-actions">
        <span className="muted">原始 CLI 记录保持原样</span>
        <button
          className="button primary"
          disabled={!selected.length || loading || importing}
          onClick={() => void load()}
        >
          {importing ? <LoaderCircle size={15} className="spin" /> : <Download size={15} />}导入{' '}
          {selected.length || ''} 个会话
        </button>
      </div>
    </Modal>
  );
}

export function SettingsModal({
  data,
  theme,
  onTheme,
  onClose,
  syncing,
  onSync,
}: {
  data: Bootstrap;
  theme: Theme;
  onTheme: (theme: Theme) => void;
  onClose: () => void;
  syncing: boolean;
  onSync: () => void;
}) {
  return (
    <Modal
      title="工作台设置"
      subtitle="你的本地 Claude Code，一个更顺手的工作空间。"
      onClose={onClose}
    >
      <div className="settings-section">
        <label>外观</label>
        <div className="theme-options">
          {(
            [
              { value: 'dark', label: '深色', icon: Moon },
              { value: 'light', label: '浅色', icon: Sun },
              { value: 'system', label: '跟随系统', icon: Monitor },
            ] as const
          ).map((item) => (
            <button
              key={item.value}
              className={theme === item.value ? 'selected' : ''}
              onClick={() => onTheme(item.value)}
            >
              <item.icon size={19} />
              {item.label}
            </button>
          ))}
        </div>
        <p className="field-hint">深色 · 狐火夜境　/　浅色 · 霜蓝庭院</p>
      </div>
      <div className="settings-section">
        <label>Claude Code</label>
        <div className="connection-box">
          <Terminal size={18} />
          <div>
            <strong>{data.cli.available ? data.cli.version : '未连接'}</strong>
            <p>{data.cli.path || data.cli.error}</p>
          </div>
          <span className={`status-dot ${data.cli.available ? 'online' : 'offline'}`} />
        </div>
        <div className="config-details" aria-live="polite">
          <div className="config-status-row">
            <strong>
              {data.config.state === 'loaded'
                ? '已读取本机用户配置'
                : data.config.state === 'missing'
                  ? '使用 Claude Code 默认配置'
                  : '配置需要检查'}
            </strong>
            <button className="button secondary" onClick={onSync} disabled={syncing}>
              <RefreshCw size={13} className={syncing ? 'spin' : ''} />
              {syncing ? '同步中…' : '重新同步'}
            </button>
          </div>
          <dl>
            <dt>用户配置文件</dt>
            <dd>
              <code>{data.config.settingsPath}</code>
            </dd>
            <dt>用户配置模型</dt>
            <dd>{data.config.configuredModel || '由 Claude Code 决定'}</dd>
            <dt>同步时间</dt>
            <dd>{new Date(data.config.checkedAt).toLocaleString('zh-CN', { hour12: false })}</dd>
          </dl>
          {data.config.error && <p className="config-error">{data.config.error}</p>}
        </div>
        <p className="field-hint">
          每次打开自动同步。CC Switch 切换后点“同步本机配置”，下一条消息读取新配置。项目配置仍按
          Claude Code 原规则叠加，实际模型以回复为准。
        </p>
        <p className="field-hint">
          应用不复制密钥或改写设置。若修改的是 Windows 环境变量，请重新打开应用。
        </p>
      </div>
      <div className="settings-section">
        <label>本地记录位置</label>
        <code className="data-path">{data.dataPath}</code>
        <p className="field-hint">聊天会归档在本机。模型请求仍通过你当前配置的服务发送。</p>
      </div>
      <div className="settings-footer">
        <span>Claude Workbench {data.appVersion}</span>
        <span>独立本地客户端</span>
      </div>
    </Modal>
  );
}

export function NotesPanel({
  project,
  onClose,
  onSaved,
  onError,
}: {
  project: Project;
  onClose: () => void;
  onSaved: (project: Project) => void;
  onError: (error: unknown) => void;
}) {
  const [notes, setNotes] = useState(project.notes);
  const [enabled, setEnabled] = useState(project.notesEnabled);
  const [busy, setBusy] = useState(false);
  const dirty = notes !== project.notes || enabled !== project.notesEnabled;
  const save = async () => {
    setBusy(true);
    try {
      onSaved(await window.desktop.updateNotes(project.id, notes, enabled));
    } catch (error) {
      onError(error);
    } finally {
      setBusy(false);
    }
  };
  return (
    <aside className="notes-panel">
      <div className="notes-heading">
        <div>
          <span className="eyebrow">PROJECT CONTEXT</span>
          <h3>项目记忆</h3>
        </div>
        <IconButton label="关闭项目记忆" onClick={onClose}>
          <X size={18} />
        </IconButton>
      </div>
      <p className="notes-intro">把约定、结论和下一步留在这里，项目里的新对话也可以用到。</p>
      <div className="notes-project">
        <FolderOpen size={16} />
        <span>{project.name}</span>
      </div>
      <label className="notes-label" htmlFor="project-notes">
        共享备注 {dirty && <span>未保存</span>}
      </label>
      <textarea
        id="project-notes"
        placeholder={'例如：\n这个项目使用什么技术…\n已经确定的设计约定…\n下一次需要接着做什么…'}
        value={notes}
        onChange={(event) => setNotes(event.target.value)}
        maxLength={40000}
      />
      <label className="toggle-line">
        <input
          type="checkbox"
          checked={enabled}
          onChange={(event) => setEnabled(event.target.checked)}
        />
        <span>下一条消息附带这些备注</span>
      </label>
      <button
        className="button primary full-width"
        disabled={busy || !dirty}
        onClick={() => void save()}
      >
        {busy ? <LoaderCircle size={15} className="spin" /> : <Check size={15} />}保存记忆
      </button>
      <p className="notes-footnote">
        这里的备注由你管理。Claude Code 自身的 CLAUDE.md
        和自动记忆仍按本机配置读取；此处不会改写它们。
      </p>
    </aside>
  );
}

export function formatDate(value: string) {
  const date = new Date(value);
  const today = new Date();
  if (date.toDateString() === today.toDateString())
    return date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
  return date.toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' });
}
