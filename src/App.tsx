import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Archive,
  ArrowDown,
  ArrowUp,
  ArrowUpRight,
  Brain,
  Check,
  ChevronDown,
  ChevronRight,
  CircleAlert,
  Ellipsis,
  FileText,
  Folder,
  FolderOpen,
  History,
  Link,
  LoaderCircle,
  Maximize2,
  MessageSquare,
  Minus,
  Moon,
  PanelLeftClose,
  PanelLeftOpen,
  Pin,
  Plus,
  Search,
  Settings,
  Sparkles,
  Square,
  Sun,
  Terminal,
  X,
  Download,
  Pencil,
  RefreshCw,
} from 'lucide-react';
import type {
  Bootstrap,
  PermissionRequest,
  Project,
  Session,
  SessionSummary,
  Theme,
} from '../shared/types';
import { Brand, IconButton, Message, Modal, PermissionCard } from './components';
import {
  HistoryModal,
  NotesPanel,
  ProjectModal,
  SearchModal,
  SettingsModal,
  formatDate,
} from './panels';

type Draft = { text: string; referenceIds: string[] };
const emptyDraft: Draft = { text: '', referenceIds: [] };
const running = (session?: SessionSummary | null) =>
  session?.status === 'running' || session?.status === 'waiting';
function sessionSummary(session: Session): SessionSummary {
  const { messages: _messages, lastUsage: _usage, ...summary } = session;
  return summary;
}
function upsertSession(previous: SessionSummary[], session: SessionSummary) {
  return [session, ...previous.filter((item) => item.id !== session.id)].sort((a, b) =>
    b.updatedAt.localeCompare(a.updatedAt),
  );
}

export function App() {
  const [data, setData] = useState<Bootstrap | null>(null);
  const [projectId, setProjectId] = useState('');
  const [session, setSession] = useState<Session | null>(null);
  const [loadingSession, setLoadingSession] = useState(false);
  const [permissions, setPermissions] = useState<PermissionRequest[]>([]);
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [modal, setModal] = useState<
    'project' | 'search' | 'reference' | 'history' | 'settings' | 'rename' | null
  >(null);
  const [sidebar, setSidebar] = useState(true);
  const [notes, setNotes] = useState(false);
  const [archived, setArchived] = useState(false);
  const [collapsed, setCollapsed] = useState<string[]>([]);
  const [menu, setMenu] = useState<{ session: SessionSummary; top: number; left: number } | null>(
    null,
  );
  const [rename, setRename] = useState<{ id: string; title: string } | null>(null);
  const [theme, setTheme] = useState<Theme>('dark');
  const [toast, setToast] = useState<{ text: string; error: boolean } | null>(null);
  const [sending, setSending] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const activeId = useRef('');
  const selectSequence = useRef(0);
  const scrollRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const followScroll = useRef(true);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const notify = useCallback((text: string, error = false) => {
    setToast({ text, error });
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), error ? 9000 : 3500);
  }, []);
  const onError = useCallback(
    (error: unknown) =>
      notify(
        (error instanceof Error ? error.message : String(error)).replace(
          /^Error invoking remote method '[^']+': (?:Error: )?/,
          '',
        ),
        true,
      ),
    [notify],
  );

  const selectSession = useCallback(
    async (id: string) => {
      const sequence = ++selectSequence.current;
      activeId.current = id;
      setLoadingSession(true);
      followScroll.current = true;
      try {
        const loaded = await window.desktop.getSession(id);
        if (sequence !== selectSequence.current) return;
        setSession(loaded);
        setProjectId(loaded.projectId);
        setMenu(null);
        localStorage.setItem('cw:lastSession', id);
      } catch (error) {
        onError(error);
      } finally {
        if (sequence === selectSequence.current) setLoadingSession(false);
      }
    },
    [onError],
  );

  useEffect(() => {
    if (!window.desktop) {
      onError('请通过桌面启动器打开应用。浏览器预览不具备本机 Claude 连接。');
      return;
    }
    let mounted = true;
    const off = window.desktop.onEvent((event) => {
      if (event.type === 'session') {
        setData((previous) =>
          previous
            ? {
                ...previous,
                sessions: upsertSession(previous.sessions, sessionSummary(event.session)),
              }
            : previous,
        );
        if (activeId.current === event.session.id) setSession(event.session);
      } else if (event.type === 'projects')
        setData((previous) => (previous ? { ...previous, projects: event.projects } : previous));
      else if (event.type === 'permission')
        setPermissions((previous) => [
          ...previous.filter((item) => item.id !== event.request.id),
          event.request,
        ]);
      else if (event.type === 'permission-resolved')
        setPermissions((previous) => previous.filter((item) => item.id !== event.id));
      else if (event.type === 'notice') notify(event.text);
    });
    void Promise.all([window.desktop.bootstrap(), window.desktop.pendingPermissions()])
      .then(([initial, pending]) => {
        if (!mounted) return;
        setData(initial);
        setTheme(initial.theme);
        setPermissions(pending);
        const last = localStorage.getItem('cw:lastSession');
        if (last && initial.sessions.some((item) => item.id === last)) void selectSession(last);
        else if (initial.projects.length) setProjectId(initial.projects[0].id);
      })
      .catch(onError);
    return () => {
      mounted = false;
      off();
    };
  }, [notify, onError, selectSession]);

  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const apply = () => {
      document.documentElement.dataset.theme =
        theme === 'system' ? (media.matches ? 'dark' : 'light') : theme;
    };
    apply();
    media.addEventListener('change', apply);
    return () => media.removeEventListener('change', apply);
  }, [theme]);

  const newChat = useCallback(
    (id?: string) => {
      if (!id && !projectId) {
        setModal('project');
        return;
      }
      ++selectSequence.current;
      activeId.current = '';
      setSession(null);
      setLoadingSession(false);
      if (id) setProjectId(id);
      setMenu(null);
      followScroll.current = true;
      localStorage.removeItem('cw:lastSession');
      setTimeout(() => inputRef.current?.focus(), 30);
    },
    [projectId],
  );

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setModal('search');
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'n') {
        event.preventDefault();
        newChat();
      }
      if (event.key === 'Escape') setMenu(null);
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [newChat]);

  useEffect(() => {
    if (followScroll.current) bottomRef.current?.scrollIntoView({ behavior: 'instant' });
  }, [session, permissions]);

  const project = data?.projects.find((item) => item.id === projectId);
  const draftKey = session?.id || projectId || 'home';
  const draft = drafts[draftKey] || emptyDraft;
  const updateDraft = (patch: Partial<Draft>) =>
    setDrafts((previous) => ({
      ...previous,
      [draftKey]: { ...(previous[draftKey] || emptyDraft), ...patch },
    }));
  const active = running(session);
  const activePermissions = permissions.filter((item) => item.sessionId === session?.id);
  const activeCount = data?.sessions.filter((item) => running(item)).length || 0;

  useEffect(() => {
    const input = inputRef.current;
    if (input) {
      input.style.height = '0px';
      input.style.height = `${Math.min(Math.max(input.scrollHeight, 54), 190)}px`;
    }
  }, [draft.text]);

  const submit = async () => {
    if (!draft.text.trim() || active || sending || loadingSession) return;
    if (!project) {
      setModal('project');
      return;
    }
    setSending(true);
    let target = session;
    try {
      if (!target) {
        target = await window.desktop.newSession(project.id);
        activeId.current = target.id;
        setSession(target);
        setData((previous) =>
          previous
            ? { ...previous, sessions: upsertSession(previous.sessions, sessionSummary(target!)) }
            : previous,
        );
        setDrafts((previous) => ({ ...previous, [target!.id]: draft, [draftKey]: emptyDraft }));
        localStorage.setItem('cw:lastSession', target.id);
      }
      followScroll.current = true;
      await window.desktop.sendMessage({
        sessionId: target.id,
        text: draft.text,
        referenceIds: draft.referenceIds,
      });
      setDrafts((previous) => ({ ...previous, [target!.id]: emptyDraft }));
    } catch (error) {
      onError(error);
    } finally {
      setSending(false);
      inputRef.current?.focus();
    }
  };

  const updateSession = async (
    id: string,
    patch: { title?: string; archived?: boolean; pinned?: boolean },
  ) => {
    try {
      await window.desktop.updateSession(id, patch);
      setMenu(null);
    } catch (error) {
      onError(error);
    }
  };
  const changeTheme = (next: Theme) => {
    setTheme(next);
    void window.desktop.setTheme(next).catch(onError);
  };
  const projectAdded = (item: Project) => {
    setData((previous) =>
      previous
        ? {
            ...previous,
            projects: [...previous.projects.filter((existing) => existing.id !== item.id), item],
          }
        : previous,
    );
    setModal(null);
    newChat(item.id);
  };
  const refresh = async () => {
    try {
      const fresh = await window.desktop.bootstrap();
      setData(fresh);
    } catch (error) {
      onError(error);
    }
  };
  const syncConfig = async () => {
    setSyncing(true);
    try {
      const connection = await window.desktop.syncConfig();
      setData((previous) => (previous ? { ...previous, ...connection } : previous));
      if (!connection.cli.available) notify(connection.cli.error || '未找到本机 Claude Code', true);
      else if (connection.config.state === 'error') notify(connection.config.error!, true);
      else notify('已同步本机配置，下一条消息将重新读取；进行中的任务不受影响');
    } catch (error) {
      onError(error);
    } finally {
      setSyncing(false);
    }
  };

  return (
    <div className={`app-shell ${sidebar ? '' : 'sidebar-hidden'}`}>
      {sidebar && (
        <aside className="sidebar">
          <div className="sidebar-brand drag-region">
            <Brand small />
            <span>
              Claude <strong>Workbench</strong>
            </span>
            <IconButton label="收起侧栏" onClick={() => setSidebar(false)}>
              <PanelLeftClose size={17} />
            </IconButton>
          </div>
          <div className="sidebar-actions">
            <button className="new-chat-button" onClick={() => newChat()}>
              <Plus size={18} />
              <span>新对话</span>
              <kbd>Ctrl N</kbd>
            </button>
            <button className="search-button" onClick={() => setModal('search')}>
              <Search size={16} />
              <span>搜索对话</span>
              <kbd>Ctrl K</kbd>
            </button>
          </div>
          <div className="sidebar-section-heading">
            <span>{archived ? '已归档' : '项目'}</span>
            <div>
              {archived && (
                <IconButton label="返回当前会话" onClick={() => setArchived(false)}>
                  <X size={14} />
                </IconButton>
              )}
              <IconButton label="添加项目" onClick={() => setModal('project')}>
                <Plus size={16} />
              </IconButton>
            </div>
          </div>
          <div className="project-list">
            {!data ? (
              <div className="sidebar-loading">
                <LoaderCircle size={16} className="spin" />
                正在连接本机…
              </div>
            ) : !data.projects.length ? (
              <button className="empty-project-button" onClick={() => setModal('project')}>
                <FolderOpen size={20} />
                <span>打开你的第一个项目</span>
                <small>从一个本地文件夹开始</small>
              </button>
            ) : (
              data.projects.map((item) => {
                const sessions = data.sessions
                  .filter((value) => value.projectId === item.id && value.archived === archived)
                  .sort(
                    (a, b) =>
                      Number(b.pinned) - Number(a.pinned) || b.updatedAt.localeCompare(a.updatedAt),
                  );
                const isCollapsed = collapsed.includes(item.id);
                return (
                  <div className="project-group" key={item.id}>
                    <div className={`project-row ${projectId === item.id ? 'current' : ''}`}>
                      <button
                        className="project-toggle"
                        title={item.path}
                        onClick={() => {
                          setCollapsed((previous) =>
                            isCollapsed
                              ? previous.filter((id) => id !== item.id)
                              : [...previous, item.id],
                          );
                          setProjectId(item.id);
                          if (session?.projectId !== item.id) newChat(item.id);
                        }}
                      >
                        {isCollapsed ? <ChevronRight size={13} /> : <ChevronDown size={13} />}
                        <Folder size={15} />
                        <span>{item.name}</span>
                      </button>
                      <IconButton
                        label={`在 ${item.name} 新建对话`}
                        onClick={() => newChat(item.id)}
                      >
                        <Plus size={14} />
                      </IconButton>
                    </div>
                    {!isCollapsed && (
                      <div className="project-sessions">
                        {sessions.length ? (
                          sessions.map((itemSession) => (
                            <div
                              key={itemSession.id}
                              className={`session-row ${session?.id === itemSession.id ? 'selected' : ''}`}
                              role="button"
                              tabIndex={0}
                              onClick={() => void selectSession(itemSession.id)}
                              onKeyDown={(event) => {
                                if (
                                  event.target === event.currentTarget &&
                                  (event.key === 'Enter' || event.key === ' ')
                                ) {
                                  event.preventDefault();
                                  void selectSession(itemSession.id);
                                }
                              }}
                            >
                              <span className="session-indicator">
                                {running(itemSession) ? (
                                  <span
                                    className={`status-dot ${itemSession.status === 'waiting' ? 'waiting' : 'pulsing'}`}
                                  />
                                ) : itemSession.pinned ? (
                                  <Pin size={12} />
                                ) : (
                                  <MessageSquare size={13} />
                                )}
                              </span>
                              <span className="session-title">{itemSession.title}</span>
                              <span className="session-date">
                                {formatDate(itemSession.updatedAt)}
                              </span>
                              <button
                                className="session-menu-trigger"
                                aria-label={`管理会话 ${itemSession.title}`}
                                onClick={(event) => {
                                  event.stopPropagation();
                                  const rect = event.currentTarget.getBoundingClientRect();
                                  setMenu({
                                    session: itemSession,
                                    left: rect.right + 6,
                                    top: Math.min(rect.top, window.innerHeight - 230),
                                  });
                                }}
                              >
                                <Ellipsis size={15} />
                              </button>
                            </div>
                          ))
                        ) : (
                          <div className="no-sessions">
                            {archived ? '没有归档会话' : '准备好开始新的对话'}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>
          <div className="sidebar-bottom">
            <button
              className={`sidebar-utility ${archived ? 'active' : ''}`}
              onClick={() => setArchived((value) => !value)}
            >
              <Archive size={16} />
              <span>归档会话</span>
            </button>
            <button className="sidebar-utility" onClick={() => setModal('settings')}>
              <Settings size={16} />
              <span>设置</span>
              <span className="version-label">v{data?.appVersion || '…'}</span>
            </button>
            <div className="local-connection">
              <span
                className={`status-dot ${data?.cli.available ? 'online' : !data ? 'pulsing' : 'offline'}`}
              />
              <div>
                <strong>
                  {data?.cli.available
                    ? '本机 Claude Code'
                    : data
                      ? 'Claude 未连接'
                      : '正在检测 Claude'}
                </strong>
                <span>
                  {activeCount
                    ? `${activeCount} 个任务正在运行`
                    : data?.config.state === 'error'
                      ? '配置需要检查 · 打开设置'
                      : '启动时自动同步 · CC Switch'}
                </span>
              </div>
              <IconButton
                label="切换深浅主题"
                onClick={() => changeTheme(theme === 'light' ? 'dark' : 'light')}
              >
                {theme === 'light' ? <Moon size={15} /> : <Sun size={15} />}
              </IconButton>
            </div>
          </div>
        </aside>
      )}

      <main className="main-area">
        <header className="topbar drag-region">
          <div className="topbar-leading">
            {!sidebar && (
              <IconButton label="展开侧栏" onClick={() => setSidebar(true)}>
                <PanelLeftOpen size={18} />
              </IconButton>
            )}
            <span className="breadcrumb-project">{project?.name || '工作空间'}</span>
            <ChevronRight size={12} />
            <span className="breadcrumb-session">{session?.title || '新对话'}</span>
            {session?.imported && <span className="import-tag">CLI</span>}
          </div>
          <div className="topbar-actions">
            <button
              className="config-sync-button"
              disabled={syncing || !data}
              onClick={() => void syncConfig()}
              title="重新读取本机 Claude Code 与 CC Switch 配置"
            >
              <RefreshCw size={14} className={syncing ? 'spin' : ''} />
              <span>{syncing ? '同步中…' : '同步本机配置'}</span>
            </button>
            {project && (
              <>
                <IconButton
                  label="打开项目文件夹"
                  onClick={() => void window.desktop.showProject(project.id).catch(onError)}
                >
                  <FolderOpen size={17} />
                </IconButton>
                <IconButton label="导入终端历史" onClick={() => setModal('history')}>
                  <History size={17} />
                </IconButton>
                <IconButton
                  label="项目记忆"
                  className={notes ? 'active' : ''}
                  onClick={() => setNotes((value) => !value)}
                >
                  <Brain size={17} />
                </IconButton>
                <span className="topbar-divider" />
              </>
            )}
            <IconButton label="最小化" onClick={() => void window.desktop.minimize()}>
              <Minus size={15} />
            </IconButton>
            <IconButton label="最大化或还原" onClick={() => void window.desktop.maximize()}>
              <Maximize2 size={13} />
            </IconButton>
            <IconButton
              label="关闭窗口"
              className="window-close"
              onClick={() => void window.desktop.closeWindow()}
            >
              <X size={17} />
            </IconButton>
          </div>
        </header>
        <div className="workspace-body">
          <div className="conversation-column">
            <div
              className="conversation-scroll"
              ref={scrollRef}
              onScroll={() => {
                const element = scrollRef.current!;
                const away = element.scrollHeight - element.clientHeight - element.scrollTop > 120;
                followScroll.current = !away;
                setScrolled(away);
              }}
            >
              {loadingSession ? (
                <div className="conversation-loading">
                  <LoaderCircle size={24} className="spin" />
                  <span>正在打开对话…</span>
                </div>
              ) : session?.messages.length ? (
                <div className="message-list">
                  <div className="conversation-start">
                    <span>
                      {new Date(session.createdAt).toLocaleDateString('zh-CN', {
                        year: 'numeric',
                        month: 'long',
                        day: 'numeric',
                      })}
                    </span>
                    <span>本地保存</span>
                  </div>
                  {session.messages.map((message, index) => (
                    <Message
                      key={message.id}
                      message={message}
                      live={Boolean(
                        active &&
                        message.role === 'assistant' &&
                        index === session.messages.length - 1,
                      )}
                    />
                  ))}
                  {active && !activePermissions.length && (
                    <div className="working-indicator">
                      <span className="activity-bars">
                        <i />
                        <i />
                        <i />
                      </span>
                      <span>
                        {session.messages.at(-1)?.role === 'user'
                          ? '正在连接 Claude…'
                          : 'Claude 正在工作…'}
                      </span>
                    </div>
                  )}
                  {activePermissions.map((request) => (
                    <PermissionCard
                      key={request.id}
                      request={request}
                      onAnswer={async (answer) => {
                        try {
                          await window.desktop.answerPermission(answer);
                        } catch (error) {
                          onError(error);
                        }
                      }}
                    />
                  ))}
                  <div ref={bottomRef} />
                </div>
              ) : (
                <div className="welcome">
                  <div className="welcome-emblem">
                    <Brand />
                  </div>
                  <div className="welcome-eyebrow">
                    <span className="tiny-line" />
                    你的本地 AI 工作空间
                  </div>
                  <h1>让想法，在这里继续。</h1>
                  <p className="welcome-subtitle">
                    打开项目，把想做的事交给 Claude。
                    <br />
                    每一段对话、每一步工作，都有迹可循。
                  </p>
                  {project ? (
                    <button
                      className="project-pill"
                      title={project.path}
                      onClick={() => setModal('project')}
                    >
                      <FolderOpen size={14} />
                      <span>{project.name}</span>
                      <ChevronDown size={13} />
                    </button>
                  ) : (
                    <button
                      className="button primary welcome-open"
                      onClick={() => setModal('project')}
                    >
                      <FolderOpen size={16} />
                      打开项目文件夹
                      <ArrowUpRight size={16} />
                    </button>
                  )}
                  <div className="suggestion-grid">
                    {[
                      {
                        icon: Search,
                        title: '读懂这个项目',
                        text: '帮我梳理这个项目的结构、技术栈和主要运行流程，先只阅读与分析。',
                      },
                      {
                        icon: Terminal,
                        title: '一起解决问题',
                        text: '我想排查一个问题，请先了解项目，然后等我描述具体现象。',
                      },
                      {
                        icon: Sparkles,
                        title: '把想法做出来',
                        text: '我有一个新功能想法，先帮我了解项目现状，再一起确定怎么实现。',
                      },
                    ].map((item) => (
                      <button
                        className="suggestion-card"
                        key={item.title}
                        onClick={() => {
                          updateDraft({ text: item.text });
                          inputRef.current?.focus();
                        }}
                      >
                        <item.icon size={18} />
                        <span>{item.title}</span>
                        <ArrowUpRight size={13} />
                      </button>
                    ))}
                  </div>
                  <div className="welcome-footnote">
                    <span />
                    <span>本地项目</span>
                    <span className="dot-separator">·</span>
                    <span>持续对话</span>
                    <span className="dot-separator">·</span>
                    <span>执行过程可见</span>
                  </div>
                </div>
              )}
            </div>
            <div className="composer-zone">
              {scrolled && (
                <button
                  className="scroll-bottom"
                  onClick={() => {
                    followScroll.current = true;
                    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
                  }}
                >
                  <ArrowDown size={15} />
                  回到最新
                </button>
              )}
              {session?.status === 'interrupted' && (
                <div className="composer-status">
                  <CircleAlert size={13} />
                  上次运行已中断，记录已保留，可以继续。
                </div>
              )}
              {project?.notesEnabled && project.notes && (
                <div className="composer-status">
                  <Brain size={13} />
                  下一条消息将附带项目记忆
                </div>
              )}
              <div className={`composer ${active ? 'is-running' : ''}`}>
                <div className="composer-references">
                  {draft.referenceIds.map((id) => (
                    <span className="reference-chip" key={id}>
                      <Link size={12} />
                      <span>
                        {data?.sessions.find((item) => item.id === id)?.title || '引用的对话'}
                      </span>
                      <button
                        aria-label="移除引用"
                        onClick={() =>
                          updateDraft({
                            referenceIds: draft.referenceIds.filter((value) => value !== id),
                          })
                        }
                      >
                        <X size={12} />
                      </button>
                    </span>
                  ))}
                </div>
                <textarea
                  ref={inputRef}
                  aria-label="发送给 Claude 的消息"
                  placeholder={
                    project
                      ? active
                        ? '可以先写下下一步，等当前任务完成后发送…'
                        : '描述你想做的事，或者接着上次的思路…'
                      : '先打开一个项目，然后开始对话…'
                  }
                  value={draft.text}
                  onChange={(event) => updateDraft({ text: event.target.value })}
                  onKeyDown={(event) => {
                    if (
                      event.key === 'Enter' &&
                      !event.shiftKey &&
                      !event.nativeEvent.isComposing
                    ) {
                      event.preventDefault();
                      void submit();
                    }
                  }}
                  rows={2}
                />
                <div className="composer-toolbar">
                  <div className="composer-tools">
                    <IconButton
                      label="引用其他对话"
                      onClick={() => setModal('reference')}
                      disabled={!data?.sessions.length}
                    >
                      <Link size={17} />
                    </IconButton>
                    <span className="toolbar-divider" />
                    <span
                      className="model-label"
                      title={
                        session?.model
                          ? '这是最近一轮实际返回的模型；下一轮由当前本机配置决定'
                          : '使用本机 Claude Code 配置'
                      }
                    >
                      <Terminal size={13} />
                      {session?.model ? `${active ? '' : '上轮：'}${session.model}` : '本机配置'}
                      <span className="model-dot" />
                    </span>
                  </div>
                  <div className="send-tools">
                    <span className="enter-hint">{active ? '正在执行' : 'Enter 发送'}</span>
                    {active ? (
                      <button
                        className="stop-button"
                        aria-label="停止生成"
                        onClick={() => {
                          if (session) void window.desktop.stopSession(session.id).catch(onError);
                        }}
                      >
                        <Square size={13} fill="currentColor" />
                      </button>
                    ) : (
                      <button
                        className="send-button"
                        aria-label="发送消息"
                        disabled={
                          !draft.text.trim() || sending || loadingSession || !data?.cli.available
                        }
                        onClick={() => void submit()}
                      >
                        {sending ? (
                          <LoaderCircle size={18} className="spin" />
                        ) : (
                          <ArrowUp size={19} />
                        )}
                      </button>
                    )}
                  </div>
                </div>
              </div>
              <div className="composer-footer">
                <span>
                  {project ? (
                    <>
                      <Folder size={11} />
                      <span title={project.path}>{project.path}</span>
                    </>
                  ) : (
                    '选择本地文件夹开始'
                  )}{' '}
                </span>
                <span>
                  {session?.lastUsage
                    ? `${session.lastUsage.inputTokens.toLocaleString()} 输入 · ${session.lastUsage.outputTokens.toLocaleString()} 输出 tokens`
                    : 'Shift + Enter 换行'}
                </span>
              </div>
            </div>
          </div>
          {notes && project && (
            <NotesPanel
              key={project.id}
              project={project}
              onClose={() => setNotes(false)}
              onSaved={(updated) => {
                setData((previous) =>
                  previous
                    ? {
                        ...previous,
                        projects: previous.projects.map((item) =>
                          item.id === updated.id ? updated : item,
                        ),
                      }
                    : previous,
                );
                notify('项目记忆已保存');
              }}
              onError={onError}
            />
          )}
        </div>
      </main>

      {menu && (
        <>
          <div className="menu-dismiss" onClick={() => setMenu(null)} />
          <div className="context-menu" style={{ top: menu.top, left: menu.left }} role="menu">
            <button
              onClick={() => {
                setRename({ id: menu.session.id, title: menu.session.title });
                setModal('rename');
                setMenu(null);
              }}
            >
              <Pencil size={14} />
              重命名
            </button>
            <button
              onClick={() => void updateSession(menu.session.id, { pinned: !menu.session.pinned })}
            >
              <Pin size={14} />
              {menu.session.pinned ? '取消置顶' : '置顶会话'}
            </button>
            <button
              onClick={() => {
                void window.desktop
                  .exportSession(menu.session.id)
                  .then((path) => {
                    if (path) notify('已导出 Markdown');
                  })
                  .catch(onError);
                setMenu(null);
              }}
            >
              <Download size={14} />
              导出 Markdown
            </button>
            <div className="menu-divider" />
            <button
              disabled={running(menu.session)}
              onClick={() =>
                void updateSession(menu.session.id, { archived: !menu.session.archived })
              }
            >
              <Archive size={14} />
              {menu.session.archived ? '移出归档' : '归档会话'}
            </button>
          </div>
        </>
      )}
      {modal === 'project' && (
        <ProjectModal onClose={() => setModal(null)} onAdded={projectAdded} onError={onError} />
      )}
      {(modal === 'search' || modal === 'reference') && data && (
        <SearchModal
          sessions={data.sessions}
          projects={data.projects}
          referenceMode={modal === 'reference'}
          selectedIds={draft.referenceIds}
          currentId={session?.id}
          onClose={() => setModal(null)}
          onError={onError}
          onSelect={(id) => {
            if (modal === 'search') {
              void selectSession(id);
              setModal(null);
            } else if (draft.referenceIds.includes(id))
              updateDraft({ referenceIds: draft.referenceIds.filter((value) => value !== id) });
            else if (draft.referenceIds.length < 5)
              updateDraft({ referenceIds: [...draft.referenceIds, id] });
            else notify('每条消息最多引用 5 段对话');
          }}
        />
      )}
      {modal === 'history' && project && (
        <HistoryModal
          project={project}
          onClose={() => setModal(null)}
          onError={onError}
          onImported={() => {
            void refresh();
            setModal(null);
            notify('历史记录已导入，可以从侧栏打开并继续');
          }}
        />
      )}
      {modal === 'settings' && data && (
        <SettingsModal
          data={data}
          theme={theme}
          onTheme={changeTheme}
          syncing={syncing}
          onSync={() => void syncConfig()}
          onClose={() => setModal(null)}
        />
      )}
      {modal === 'rename' && rename && (
        <Modal title="重命名对话" onClose={() => setModal(null)}>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void updateSession(rename.id, { title: rename.title }).then(() => setModal(null));
            }}
          >
            <input
              autoFocus
              aria-label="会话标题"
              value={rename.title}
              maxLength={120}
              onChange={(event) => setRename({ ...rename, title: event.target.value })}
            />
            <div className="modal-actions">
              <button className="button primary" disabled={!rename.title.trim()}>
                <Check size={15} />
                保存名称
              </button>
            </div>
          </form>
        </Modal>
      )}
      {toast && (
        <div
          className={`toast ${toast.error ? 'error' : ''}`}
          role={toast.error ? 'alert' : 'status'}
        >
          {toast.error ? <CircleAlert size={17} /> : <Check size={17} />}
          <span>{toast.text}</span>
          <IconButton label="关闭提示" onClick={() => setToast(null)}>
            <X size={15} />
          </IconButton>
        </div>
      )}
    </div>
  );
}
