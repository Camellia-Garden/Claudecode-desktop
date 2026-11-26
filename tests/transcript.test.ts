import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Transcript, importMessages, redactError } from '../electron/transcript.js';
import type { Session } from '../shared/types.js';

function fixture(): Session {
  return {
    id: 'f21b9aaf-0cae-4c9c-a001-1cba57024c16',
    projectId: 'project',
    title: 'Test',
    createdAt: '2026-11-26T00:00:00Z',
    updatedAt: '2026-11-26T00:00:00Z',
    status: 'running',
    archived: false,
    pinned: false,
    preview: '',
    messageCount: 0,
    messages: [],
  };
}
const stream = (event: object) => ({ type: 'stream_event', session_id: 'cli-123', event });

test('partial thinking, text and final messages render once without duplication', () => {
  const session = fixture(),
    transcript = new Transcript(session);
  transcript.accept(
    stream({ type: 'message_start', message: { id: 'm1', model: 'configured-model' } }),
  );
  transcript.accept(
    stream({
      type: 'content_block_start',
      index: 0,
      content_block: { type: 'thinking', thinking: '' },
    }),
  );
  transcript.accept(
    stream({
      type: 'content_block_delta',
      index: 0,
      delta: { type: 'thinking_delta', thinking: 'Check inputs.' },
    }),
  );
  transcript.accept(stream({ type: 'content_block_stop', index: 0 }));
  transcript.accept({
    type: 'assistant',
    uuid: 'a1',
    message: { id: 'm1', content: [{ type: 'thinking', thinking: 'Check inputs.' }] },
  });
  transcript.accept(
    stream({ type: 'content_block_start', index: 1, content_block: { type: 'text', text: '' } }),
  );
  transcript.accept(
    stream({ type: 'content_block_delta', index: 1, delta: { type: 'text_delta', text: 'Hello' } }),
  );
  transcript.accept(
    stream({
      type: 'content_block_delta',
      index: 1,
      delta: { type: 'text_delta', text: ' world.' },
    }),
  );
  const final = {
    type: 'assistant',
    uuid: 'a2',
    message: { id: 'm1', content: [{ type: 'text', text: 'Hello world.' }] },
  };
  transcript.accept(final);
  transcript.accept(final);
  transcript.accept({
    type: 'result',
    subtype: 'success',
    result: 'Hello world.',
    session_id: 'cli-123',
    usage: { input_tokens: 3, output_tokens: 5, cache_read_input_tokens: 7 },
  });
  assert.equal(session.messages.length, 1);
  assert.equal(session.messages[0].blocks.length, 2);
  assert.equal(
    session.messages[0].blocks[1].type === 'text' && session.messages[0].blocks[1].text,
    'Hello world.',
  );
  assert.equal(session.lastUsage?.inputTokens, 10);
  assert.equal(session.cliSessionId, 'cli-123');
  assert.equal(session.model, 'configured-model');
});

test('tool JSON chunks and result are matched by tool ID', () => {
  const session = fixture(),
    transcript = new Transcript(session);
  transcript.accept(stream({ type: 'message_start', message: { id: 'm1' } }));
  transcript.accept(
    stream({
      type: 'content_block_start',
      index: 0,
      content_block: { type: 'tool_use', id: 'tool-1', name: 'Read', input: {} },
    }),
  );
  transcript.accept(
    stream({
      type: 'content_block_delta',
      index: 0,
      delta: { type: 'input_json_delta', partial_json: '{"file_path":' },
    }),
  );
  transcript.accept(
    stream({
      type: 'content_block_delta',
      index: 0,
      delta: { type: 'input_json_delta', partial_json: '"README.md"}' },
    }),
  );
  transcript.accept({
    type: 'assistant',
    message: {
      id: 'm1',
      content: [
        { type: 'tool_use', id: 'tool-1', name: 'Read', input: { file_path: 'README.md' } },
      ],
    },
  });
  transcript.accept({
    type: 'user',
    message: {
      content: [
        {
          type: 'tool_result',
          tool_use_id: 'tool-1',
          content: [{ type: 'text', text: 'File contents' }],
        },
      ],
    },
  });
  const block = session.messages[0].blocks[0];
  assert.equal(session.messages[0].blocks.length, 1);
  assert.equal(block.type, 'tool');
  if (block.type === 'tool') {
    assert.equal(block.input.file_path, 'README.md');
    assert.equal(block.output, 'File contents');
    assert.equal(block.state, 'done');
  }
});

test('errors and interrupted tools remain visible and are not marked successful', () => {
  const session = fixture(),
    transcript = new Transcript(session);
  transcript.accept({
    type: 'assistant',
    message: {
      id: 'm1',
      content: [{ type: 'tool_use', id: 't1', name: 'Bash', input: { command: 'test' } }],
    },
  });
  transcript.accept({
    type: 'result',
    subtype: 'error_during_execution',
    is_error: true,
    errors: ['Provider rejected request'],
  });
  transcript.finish(true);
  assert.equal(transcript.failed, true);
  const tool = session.messages[0].blocks[0];
  assert.equal(tool.type === 'tool' && tool.state, 'interrupted');
  assert.ok(
    session.messages[0].blocks.some((block) => block.type === 'notice' && block.tone === 'error'),
  );
});

test('history import preserves turns and attaches tool results', () => {
  const session = fixture();
  importMessages(
    [
      { type: 'user', uuid: 'u1', message: { content: 'Read a file' } },
      {
        type: 'assistant',
        uuid: 'a1',
        message: {
          content: [{ type: 'tool_use', id: 't1', name: 'Read', input: { file_path: 'x' } }],
        },
      },
      {
        type: 'user',
        uuid: 'u2',
        message: { content: [{ type: 'tool_result', tool_use_id: 't1', content: 'Hello' }] },
      },
      {
        type: 'assistant',
        uuid: 'a2',
        message: { content: [{ type: 'text', text: 'The file says Hello.' }] },
      },
      { type: 'user', uuid: 'u3', message: { content: [{ type: 'text', text: 'Thanks' }] } },
      { type: 'assistant', uuid: 'a3', message: { content: [{ type: 'text', text: 'Welcome' }] } },
    ],
    session,
  );
  assert.deepEqual(
    session.messages.map((message) => message.role),
    ['user', 'assistant', 'user', 'assistant'],
  );
  assert.equal(
    session.messages[1].blocks[0].type === 'tool' && session.messages[1].blocks[0].output,
    'Hello',
  );
});

test('diagnostics redact common bearer and API key forms', () => {
  const output = redactError(
    'Authorization: Bearer abcdef1234 api_key=secret987 sk-ant-abcdefghijklmnop',
  );
  assert.ok(!output.includes('abcdef1234'));
  assert.ok(!output.includes('secret987'));
  assert.ok(!output.includes('sk-ant-'));
});
