export type RunStatus = 'idle' | 'running' | 'waiting' | 'error' | 'interrupted';
export type Theme = 'dark' | 'light' | 'system';
export type PermissionMode = 'default' | 'bypassPermissions';

export interface Project {
  id: string;
  name: string;
  path: string;
  createdAt: string;
  notes: string;
  notesEnabled: boolean;
}

export type MessageBlock =
  | { type: 'text'; text: string }
  | { type: 'thinking'; text: string; durationMs?: number }
  | {
      type: 'tool';
      id: string;
      name: string;
      input: Record<string, unknown>;
      output?: string;
      state: 'running' | 'done' | 'error' | 'interrupted';
    }
  | { type: 'notice'; text: string; tone: 'info' | 'error' };

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  createdAt: string;
  blocks: MessageBlock[];
  references?: { sessionId: string; title: string }[];
}

export interface SessionSummary {
  id: string;
  projectId: string;
  title: string;
  cliSessionId?: string;
  createdAt: string;
  updatedAt: string;
  status: RunStatus;
  archived: boolean;
  pinned: boolean;
  preview: string;
  messageCount: number;
  model?: string;
  imported?: boolean;
  permissionMode?: PermissionMode;
}

export interface Session extends SessionSummary {
  messages: ChatMessage[];
  lastUsage?: { inputTokens: number; outputTokens: number; costUsd?: number };
}

export interface PermissionRequest {
  id: string;
  sessionId: string;
  toolName: string;
  input: Record<string, unknown>;
  explanation?: string;
  blockedPath?: string;
}

export interface PermissionAnswer {
  id: string;
  allow: boolean;
  answers?: Record<string, string>;
}

export interface CliInfo {
  available: boolean;
  path?: string;
  version?: string;
  error?: string;
}

export interface ConfigInfo {
  checkedAt: string;
  settingsPath: string;
  state: 'loaded' | 'missing' | 'error';
  configuredModel?: string;
  error?: string;
}

export interface LocalConnection {
  cli: CliInfo;
  config: ConfigInfo;
}

export interface Bootstrap {
  projects: Project[];
  sessions: SessionSummary[];
  theme: Theme;
  permissionMode: PermissionMode;
  cli: CliInfo;
  config: ConfigInfo;
  dataPath: string;
  appVersion: string;
}

export type AppEvent =
  | { type: 'session'; session: Session }
  | { type: 'permission'; request: PermissionRequest }
  | { type: 'permission-resolved'; id: string }
  | { type: 'projects'; projects: Project[] }
  | { type: 'notice'; text: string };

export interface HistoryEntry {
  sessionId: string;
  title: string;
  updatedAt: string;
  messageCount: number;
}

export interface SearchResult {
  sessionId: string;
  projectId: string;
  title: string;
  snippet: string;
  updatedAt: string;
}

export interface DesktopAPI {
  bootstrap(): Promise<Bootstrap>;
  syncConfig(): Promise<LocalConnection>;
  chooseProject(): Promise<Project | null>;
  addProject(path: string): Promise<Project>;
  newSession(projectId: string): Promise<Session>;
  getSession(id: string): Promise<Session>;
  sendMessage(input: { sessionId: string; text: string; referenceIds: string[] }): Promise<void>;
  stopSession(id: string): Promise<void>;
  updateSession(
    id: string,
    patch: { title?: string; archived?: boolean; pinned?: boolean },
  ): Promise<Session>;
  answerPermission(answer: PermissionAnswer): Promise<void>;
  pendingPermissions(): Promise<PermissionRequest[]>;
  search(query: string): Promise<SearchResult[]>;
  listHistory(projectId: string): Promise<HistoryEntry[]>;
  importHistory(projectId: string, ids: string[]): Promise<SessionSummary[]>;
  updateNotes(projectId: string, notes: string, enabled: boolean): Promise<Project>;
  setTheme(theme: Theme): Promise<void>;
  setPermissionMode(mode: PermissionMode): Promise<void>;
  exportSession(id: string): Promise<string | null>;
  showProject(id: string): Promise<void>;
  openExternal(url: string): Promise<void>;
  minimize(): Promise<void>;
  maximize(): Promise<void>;
  closeWindow(): Promise<void>;
  quitApp(): Promise<void>;
  onEvent(callback: (event: AppEvent) => void): () => void;
}
