import {
  query,
  listSessions,
  getSessionMessages,
  type PermissionResult,
  type Query,
} from '@anthropic-ai/claude-agent-sdk';
import { randomUUID } from 'node:crypto';
import type {
  AppEvent,
  CliInfo,
  PermissionRequest,
  PermissionAnswer,
  Session,
  HistoryEntry,
} from '../shared/types.js';
import { Store, summarize } from './store.js';
import { Transcript, importMessages, redactError } from './transcript.js';
import { detectClaude } from './cli.js';

interface Run {
  abort: AbortController;
  query?: Query;
  transcript: Transcript;
  timer?: ReturnType<typeof setTimeout>;
  promise?: Promise<void>;
}
interface Pending {
  request: PermissionRequest;
  resolve: (answer: PermissionResult) => void;
  cancel: () => void;
}

export class ClaudeRunner {
  private runs = new Map<string, Run>();
  private permissions = new Map<string, Pending>();
  cli: CliInfo = { available: false };

  constructor(
    private store: Store,
    private emit: (event: AppEvent) => void,
    private services: { query: typeof query; detectClaude: typeof detectClaude } = {
      query,
      detectClaude,
    },
  ) {}
  get activeCount() {
    return this.runs.size;
  }
  pending() {
    return [...this.permissions.values()].map((item) => item.request);
  }
  async detect() {
    this.cli = await this.services.detectClaude();
    return this.cli;
  }

  async start(input: { sessionId: string; text: string; referenceIds: string[] }) {
    const session = this.store.get(input.sessionId);
    if (this.runs.has(session.id)) throw new Error('这个会话正在执行，请等待完成或先停止');
    const text = input.text.trim();
    if (!text || text.length > 100_000) throw new Error('消息需要 1–100,000 个字符');
    const project = this.store.project(session.projectId);
    const references = [...new Set(input.referenceIds)]
      .slice(0, 5)
      .filter((id) => id !== session.id)
      .map((id) => this.store.get(id));
    const cli = await this.detect();
    if (!cli.available || !cli.path) throw new Error(cli.error || 'Claude Code 不可用');
    // Recheck after the asynchronous CLI lookup to prevent double submissions.
    if (this.runs.has(session.id)) throw new Error('这个会话正在执行');
    const sections: string[] = [];
    if (project.notesEnabled && project.notes.trim())
      sections.push(`用户明确启用的项目备注（背景资料）：\n${project.notes}`);
    for (const reference of references) {
      const excerpt = reference.messages
        .map((message) => {
          const body = message.blocks
            .filter((block) => block.type === 'text')
            .map((block) => block.text)
            .join('\n');
          return body ? `${message.role === 'user' ? '用户' : '助手'}：${body}` : '';
        })
        .filter(Boolean)
        .join('\n\n')
        .slice(-16000);
      sections.push(
        `用户主动引用的历史对话《${reference.title}》（仅作背景，可能截取末尾；原记录 ID ${reference.id}）：\n${excerpt}`,
      );
    }
    sections.push(sections.length ? `本轮用户请求：\n${text}` : text);
    const prompt = sections.join('\n\n---\n\n');
    session.messages.push({
      id: randomUUID(),
      role: 'user',
      createdAt: new Date().toISOString(),
      blocks: [{ type: 'text', text }],
      references: references.map((item) => ({ sessionId: item.id, title: item.title })),
    });
    if (session.title === '新对话') session.title = text.replace(/\s+/g, ' ').slice(0, 36);
    session.archived = false;
    session.updatedAt = new Date().toISOString();
    session.status = 'running';
    const run: Run = { abort: new AbortController(), transcript: new Transcript(session) };
    this.runs.set(session.id, run);
    this.publish(session);
    run.promise = this.execute(session, run, cli.path, prompt);
  }

  private publish(session: Session) {
    this.store.save(session);
    this.emit({ type: 'session', session: structuredClone(session) });
  }

  private async execute(session: Session, run: Run, executable: string, prompt: string) {
    let stderrTail = '';
    try {
      run.query = this.services.query({
        prompt,
        options: {
          cwd: this.store.project(session.projectId).path,
          pathToClaudeCodeExecutable: executable,
          settingSources: ['user', 'project', 'local'],
          systemPrompt: { type: 'preset', preset: 'claude_code' },
          includePartialMessages: true,
          resume: session.cliSessionId,
          abortController: run.abort,
          stderr: (data) => {
            stderrTail = (stderrTail + redactError(data)).slice(-4000);
          },
          canUseTool: (toolName, toolInput, options) =>
            this.requestPermission(
              session,
              toolName,
              toolInput,
              options.signal,
              options.decisionReason,
              options.blockedPath,
            ),
        },
      });
      for await (const message of run.query) {
        run.transcript.accept(message);
        if (!run.timer)
          run.timer = setTimeout(() => {
            run.timer = undefined;
            this.publish(session);
          }, 120);
      }
      if (!run.transcript.sawResult && !run.abort.signal.aborted)
        throw new Error('Claude Code 已退出，但没有返回完成结果。');
      session.status = run.abort.signal.aborted
        ? 'interrupted'
        : run.transcript.failed
          ? 'error'
          : 'idle';
    } catch (error) {
      if (run.abort.signal.aborted) session.status = 'interrupted';
      else {
        session.status = 'error';
        const detail = redactError(error instanceof Error ? error.message : String(error));
        run.transcript.notice(
          `${detail}${stderrTail ? `\n\nClaude Code 诊断：\n${stderrTail}` : ''}`,
          'error',
        );
      }
    } finally {
      if (run.timer) clearTimeout(run.timer);
      for (const pending of [...this.permissions.values()])
        if (pending.request.sessionId === session.id) pending.cancel();
      run.transcript.finish(session.status !== 'idle');
      if (session.status === 'interrupted')
        run.transcript.notice('本轮已停止。记录已保存，可以继续发送消息。');
      session.updatedAt = new Date().toISOString();
      this.runs.delete(session.id);
      this.publish(session);
    }
  }

  private requestPermission(
    session: Session,
    toolName: string,
    input: Record<string, unknown>,
    signal: AbortSignal,
    explanation?: string,
    blockedPath?: string,
  ): Promise<PermissionResult> {
    return new Promise((resolve) => {
      const request: PermissionRequest = {
        id: randomUUID(),
        sessionId: session.id,
        toolName,
        input,
        explanation,
        blockedPath,
      };
      const done = (answer: PermissionResult) => {
        if (!this.permissions.has(request.id)) return;
        signal.removeEventListener('abort', cancel);
        this.permissions.delete(request.id);
        this.emit({ type: 'permission-resolved', id: request.id });
        if (
          session.status === 'waiting' &&
          !this.pending().some((item) => item.sessionId === session.id)
        )
          session.status = 'running';
        this.publish(session);
        resolve(answer);
      };
      const cancel = () =>
        done({ behavior: 'deny', message: '用户已停止任务或关闭应用', interrupt: true });
      this.permissions.set(request.id, { request, resolve: done, cancel });
      if (signal.aborted) {
        cancel();
        return;
      }
      signal.addEventListener('abort', cancel, { once: true });
      session.status = 'waiting';
      this.publish(session);
      this.emit({ type: 'permission', request });
    });
  }

  answer(answer: PermissionAnswer) {
    const pending = this.permissions.get(answer.id);
    if (!pending) throw new Error('这项请求已经结束');
    if (!answer.allow) pending.resolve({ behavior: 'deny', message: '用户拒绝了这次操作' });
    else
      pending.resolve({
        behavior: 'allow',
        updatedInput:
          pending.request.toolName === 'AskUserQuestion'
            ? { ...pending.request.input, answers: answer.answers || {} }
            : pending.request.input,
      });
  }

  async stop(id: string) {
    const run = this.runs.get(id);
    if (!run) return;
    run.abort.abort();
    run.query?.close();
    for (const pending of [...this.permissions.values()])
      if (pending.request.sessionId === id) pending.cancel();
    await run.promise;
  }

  async stopAll() {
    await Promise.all([...this.runs.keys()].map((id) => this.stop(id)));
  }

  async history(projectId: string): Promise<HistoryEntry[]> {
    const project = this.store.project(projectId);
    const entries = await listSessions({ dir: project.path, includeWorktrees: false, limit: 200 });
    return entries.map((entry) => ({
      sessionId: entry.sessionId,
      title: entry.customTitle || entry.summary || entry.firstPrompt || '未命名 CLI 会话',
      updatedAt: new Date(entry.lastModified).toISOString(),
      messageCount: 0,
    }));
  }

  async importHistory(projectId: string, ids: string[]) {
    const project = this.store.project(projectId);
    const available = await this.history(projectId);
    const results = [];
    for (const id of [...new Set(ids)].slice(0, 50)) {
      const existing = this.store
        .list()
        .find((item) => item.cliSessionId === id && item.projectId === projectId);
      if (existing) {
        results.push(existing);
        continue;
      }
      const info = available.find((item) => item.sessionId === id);
      if (!info) throw new Error('历史会话不属于当前项目，或已经不存在');
      const raw = await getSessionMessages(id, { dir: project.path });
      const session = this.store.newSession(projectId);
      session.cliSessionId = id;
      session.title = info.title.slice(0, 120);
      session.createdAt = session.updatedAt = info.updatedAt;
      session.imported = true;
      importMessages(raw, session);
      this.publish(session);
      results.push(summarize(session));
    }
    return results;
  }
}
