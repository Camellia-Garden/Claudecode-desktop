import { randomUUID } from 'node:crypto';
import type { ChatMessage, MessageBlock, Session } from '../shared/types.js';

type Wire = Record<string, any>;
type StreamBlock = {
  block: MessageBlock;
  source: string;
  index: number;
  json: string;
  started: number;
};

export function readableContent(value: unknown): string {
  if (typeof value === 'string') return value;
  if (Array.isArray(value))
    return value
      .map((item) => {
        if (item?.type === 'text') return item.text;
        if (item?.type === 'image') return '[图片内容]';
        return JSON.stringify(item, null, 2);
      })
      .join('\n');
  return value == null ? '' : JSON.stringify(value, null, 2);
}

export function redactError(value: string): string {
  return value
    .replace(/\b(sk-[a-zA-Z0-9_-]{12,})\b/g, '[密钥已隐藏]')
    .replace(/(authorization["'\s]*[:=]["'\s]*(?:bearer\s+)?)[^\s,"'}]+/gi, '$1[已隐藏]')
    .replace(
      /((?:api[_-]?key|auth[_-]?token|access[_-]?token)["'\s]*[:=]["'\s]*)[^\s,"'}]+/gi,
      '$1[已隐藏]',
    );
}

export class Transcript {
  private assistant?: ChatMessage;
  private activeMessages = new Map<string, string>();
  private streamed = new Map<string, StreamBlock>();
  private seen = new Set<string>();
  sawResult = false;
  failed = false;

  constructor(readonly session: Session) {}

  private output() {
    if (!this.assistant) {
      this.assistant = {
        id: randomUUID(),
        role: 'assistant',
        createdAt: new Date().toISOString(),
        blocks: [],
      };
      this.session.messages.push(this.assistant);
    }
    return this.assistant;
  }

  notice(text: string, tone: 'info' | 'error' = 'info') {
    this.output().blocks.push({ type: 'notice', text: redactError(text), tone });
  }

  finish(interrupted = false) {
    for (const message of this.session.messages)
      for (const block of message.blocks) {
        if (block.type === 'tool' && block.state === 'running')
          block.state = interrupted ? 'interrupted' : 'done';
      }
  }

  accept(raw: unknown) {
    const message = raw as Wire;
    if (typeof message.session_id === 'string' && !message.parent_tool_use_id)
      this.session.cliSessionId = message.session_id;
    if (message.type === 'stream_event') return this.stream(message);
    if (message.uuid && this.seen.has(message.uuid)) return;
    if (message.uuid) this.seen.add(message.uuid);

    if (message.type === 'system' && message.subtype === 'init') {
      this.session.model = message.model;
    } else if (message.type === 'assistant') {
      const source = message.message?.id || message.uuid;
      if (!message.parent_tool_use_id && message.message?.model)
        this.session.model = message.message.model;
      for (const block of message.message?.content || []) this.completeBlock(block, source);
      if (message.error) this.failed = true;
    } else if (message.type === 'user') {
      for (const block of Array.isArray(message.message?.content) ? message.message.content : []) {
        if (block.type !== 'tool_result') continue;
        const tool = this.findTool(block.tool_use_id);
        if (tool) {
          tool.output = readableContent(block.content);
          tool.state = block.is_error ? 'error' : 'done';
        }
      }
    } else if (message.type === 'result') {
      this.sawResult = true;
      this.failed ||= Boolean(message.is_error) || message.subtype !== 'success';
      if (this.failed)
        this.notice(
          (message.errors || [message.result || 'Claude Code 未能完成本轮请求']).join('\n'),
          'error',
        );
      else if (message.result && !this.output().blocks.some((block) => block.type === 'text'))
        this.output().blocks.push({ type: 'text', text: message.result });
      if (message.usage)
        this.session.lastUsage = {
          inputTokens:
            (message.usage.input_tokens || 0) +
            (message.usage.cache_read_input_tokens || 0) +
            (message.usage.cache_creation_input_tokens || 0),
          outputTokens: message.usage.output_tokens || 0,
          costUsd: message.total_cost_usd,
        };
    } else if (message.type === 'system' && message.subtype === 'compact_boundary') {
      this.notice('Claude Code 已压缩上下文；本地显示记录仍然保留。');
    } else if (message.type === 'system' && message.subtype === 'api_retry') {
      this.notice(`连接重试中${message.attempt ? `（第 ${message.attempt} 次）` : ''}…`);
    } else if (message.type === 'system' && message.subtype === 'local_command_output') {
      this.notice(readableContent(message.content || message.output || '命令已执行'));
    }
  }

  private findTool(id: string): Extract<MessageBlock, { type: 'tool' }> | undefined {
    for (const message of this.session.messages)
      for (const block of message.blocks) {
        if (block.type === 'tool' && block.id === id) return block;
      }
  }

  private completeBlock(value: Wire, source: string) {
    if (value.type === 'tool_use' || value.type === 'server_tool_use') {
      const existing = this.findTool(value.id);
      if (existing) {
        existing.input = value.input || {};
        return;
      }
      this.output().blocks.push({
        type: 'tool',
        id: value.id,
        name: value.name,
        input: value.input || {},
        state: 'running',
      });
    } else if (value.type === 'text' || value.type === 'thinking') {
      const text = value.type === 'text' ? value.text : value.thinking;
      if (!text) return;
      const existing = [...this.streamed.values()].find(
        (entry) =>
          entry.source === source &&
          entry.block.type === value.type &&
          'text' in entry.block &&
          (entry.block.text === text || text.startsWith(entry.block.text)),
      );
      if (existing && 'text' in existing.block) existing.block.text = text;
      else this.output().blocks.push({ type: value.type, text });
    } else if (value.type === 'redacted_thinking') {
      this.notice('模型返回了一段隐藏的思考内容。');
    }
  }

  private stream(message: Wire) {
    const parent = message.parent_tool_use_id || 'root';
    const event = message.event || {};
    if (event.type === 'message_start') {
      this.activeMessages.set(parent, event.message.id);
      if (parent === 'root' && event.message.model) this.session.model = event.message.model;
      return;
    }
    const source = this.activeMessages.get(parent) || parent;
    const key = `${parent}:${source}:${event.index}`;
    if (event.type === 'content_block_start') {
      const content = event.content_block;
      let block: MessageBlock | undefined;
      if (content.type === 'text') block = { type: 'text', text: content.text || '' };
      if (content.type === 'thinking') block = { type: 'thinking', text: content.thinking || '' };
      if (content.type === 'tool_use' || content.type === 'server_tool_use')
        block = {
          type: 'tool',
          id: content.id,
          name: content.name,
          input: content.input || {},
          state: 'running',
        };
      if (block) {
        this.output().blocks.push(block);
        this.streamed.set(key, {
          block,
          source,
          index: event.index,
          json: '',
          started: Date.now(),
        });
      }
    } else if (event.type === 'content_block_delta') {
      const entry = this.streamed.get(key);
      if (!entry) return;
      if (event.delta.type === 'text_delta' && entry.block.type === 'text')
        entry.block.text += event.delta.text;
      if (event.delta.type === 'thinking_delta' && entry.block.type === 'thinking')
        entry.block.text += event.delta.thinking;
      if (event.delta.type === 'input_json_delta') {
        entry.json += event.delta.partial_json;
        if (entry.block.type === 'tool') {
          try {
            entry.block.input = JSON.parse(entry.json);
          } catch {
            /* input is still streaming */
          }
        }
      }
    } else if (event.type === 'content_block_stop') {
      const entry = this.streamed.get(key);
      if (entry?.block.type === 'thinking') entry.block.durationMs = Date.now() - entry.started;
    }
  }
}

export function importMessages(
  raw: { type: string; message: unknown; uuid: string }[],
  session: Session,
) {
  let transcript = new Transcript(session);
  for (const entry of raw) {
    const message = entry.message as Wire;
    const content = message?.content;
    const text =
      typeof content === 'string'
        ? content
        : Array.isArray(content)
          ? content
              .filter((block) => block.type === 'text')
              .map((block) => block.text)
              .join('\n')
          : '';
    if (entry.type === 'user' && text) {
      session.messages.push({
        id: entry.uuid || randomUUID(),
        role: 'user',
        createdAt: session.createdAt,
        blocks: [{ type: 'text', text }],
      });
      transcript = new Transcript(session);
    } else {
      transcript.accept(entry);
    }
  }
  transcript.finish(true);
}
