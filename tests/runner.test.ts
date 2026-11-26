import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Options, Query, SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import type { AppEvent } from '../shared/types.js';
import { Store } from '../electron/store.js';
import { ClaudeRunner } from '../electron/runner.js';

type Factory = (prompt: unknown, options: Options) => AsyncGenerator<SDKMessage, void>;

function fixture(factory: Factory) {
  const root = mkdtempSync(join(tmpdir(), 'claude-workbench-runner-'));
  const store = new Store(root);
  const project = store.addProject(root);
  const session = store.newSession(project.id);
  const events: AppEvent[] = [];
  const listeners: ((event: AppEvent) => void)[] = [];
  const runner = new ClaudeRunner(
    store,
    (event) => {
      events.push(event);
      for (const listener of [...listeners]) listener(event);
    },
    {
      detectClaude: async () => ({
        available: true,
        path: 'C:\\fixture\\claude.exe',
        version: 'test',
      }),
      query: ({ prompt, options }) => {
        const generator = factory(prompt, options || {});
        return Object.assign(generator, {
          close() {
            /* abort signal resolves pending permissions */
          },
        }) as Query;
      },
    },
  );
  const wait = (predicate: (event: AppEvent) => boolean) => {
    const previous = events.find(predicate);
    if (previous) return Promise.resolve(previous);
    return new Promise<AppEvent>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error('Expected runner event was not emitted')),
        3000,
      );
      const listener = (event: AppEvent) => {
        if (predicate(event)) {
          clearTimeout(timer);
          listeners.splice(listeners.indexOf(listener), 1);
          resolve(event);
        }
      };
      listeners.push(listener);
    });
  };
  return { runner, store, project, session, events, wait };
}

const init = {
  type: 'system',
  subtype: 'init',
  session_id: 'test-cli-session',
  model: 'configured-model',
} as SDKMessage;
const success = {
  type: 'result',
  subtype: 'success',
  session_id: 'test-cli-session',
  is_error: false,
  result: 'Done',
  usage: { input_tokens: 2, output_tokens: 3 },
} as SDKMessage;

test('local CLI and model settings pass through with manual permissions by default', async () => {
  let captured: Options | undefined;
  const context = fixture(async function* (_prompt, options) {
    captured = options;
    yield init;
    yield success;
  });
  await context.runner.start({ sessionId: context.session.id, text: 'Hello', referenceIds: [] });
  await context.wait((event) => event.type === 'session' && event.session.status === 'idle');
  assert.equal(captured?.cwd, context.project.path);
  assert.equal(captured?.pathToClaudeCodeExecutable, 'C:\\fixture\\claude.exe');
  assert.deepEqual(captured?.settingSources, ['user', 'project', 'local']);
  assert.deepEqual(captured?.systemPrompt, { type: 'preset', preset: 'claude_code' });
  assert.equal(captured?.model, undefined);
  assert.equal(captured?.env, undefined);
  assert.equal(captured?.permissionMode, 'default');
  assert.equal(captured?.allowDangerouslySkipPermissions, undefined);
  assert.equal(context.session.cliSessionId, 'test-cli-session');
});

test('permissions wait for an answer, support denial, and remove the request after resolving', async () => {
  let decision: unknown;
  const context = fixture(async function* (_prompt, options) {
    yield init;
    decision = await options.canUseTool!(
      'Write',
      { file_path: 'fixture.txt', content: 'test' },
      { signal: options.abortController!.signal, toolUseID: 't1' },
    );
    yield success;
  });
  await context.runner.start({
    sessionId: context.session.id,
    text: 'Test permission',
    referenceIds: [],
  });
  const permission = await context.wait((event) => event.type === 'permission');
  assert.equal(context.session.status, 'waiting');
  assert.equal(decision, undefined);
  assert.equal(context.runner.pending().length, 1);
  if (permission.type !== 'permission') throw new Error('Wrong event');
  context.runner.answer({ id: permission.request.id, allow: false });
  await context.wait((event) => event.type === 'session' && event.session.status === 'idle');
  assert.equal((decision as { behavior: string }).behavior, 'deny');
  assert.equal(context.runner.pending().length, 0);
});

test('stopping during a permission prompt releases the pending request and persists interruption', async () => {
  const context = fixture(async function* (_prompt, options) {
    yield init;
    await options.canUseTool!(
      'Bash',
      { command: 'test' },
      { signal: options.abortController!.signal, toolUseID: 't1' },
    );
    yield success;
  });
  await context.runner.start({
    sessionId: context.session.id,
    text: 'Test cancellation',
    referenceIds: [],
  });
  await context.wait((event) => event.type === 'permission');
  await context.runner.stop(context.session.id);
  assert.equal(context.runner.activeCount, 0);
  assert.equal(context.runner.pending().length, 0);
  assert.equal(context.session.status, 'interrupted');
  assert.equal(new Store(context.store.root).get(context.session.id).status, 'interrupted');
});

test('explicit project notes and selected references enter the prompt; resume keeps the CLI ID', async () => {
  let capturedPrompt: unknown;
  let capturedOptions: Options | undefined;
  const context = fixture(async function* (prompt, options) {
    capturedPrompt = prompt;
    capturedOptions = options;
    yield init;
    yield success;
  });
  context.store.updateNotes(context.project.id, 'Use the existing protocol.', true);
  context.session.cliSessionId = 'prior-cli-session';
  const reference = context.store.newSession(context.project.id);
  reference.title = 'Earlier decision';
  reference.messages.push({
    id: 'ref-message',
    role: 'assistant',
    createdAt: reference.createdAt,
    blocks: [
      { type: 'text', text: 'The agreed port is 3180.' },
      { type: 'thinking', text: 'Private thought excluded from reference' },
    ],
  });
  context.store.save(reference);
  await context.runner.start({
    sessionId: context.session.id,
    text: 'Continue',
    referenceIds: [reference.id],
  });
  await context.wait((event) => event.type === 'session' && event.session.status === 'idle');
  assert.equal(capturedOptions?.resume, 'prior-cli-session');
  assert.match(String(capturedPrompt), /Use the existing protocol/);
  assert.match(String(capturedPrompt), /agreed port is 3180/);
  assert.doesNotMatch(String(capturedPrompt), /Private thought excluded/);
  assert.equal(context.session.messages[0].references?.[0].sessionId, reference.id);
});

test('AskUserQuestion answers are returned as updated input', async () => {
  let decision: any;
  const context = fixture(async function* (_prompt, options) {
    yield init;
    decision = await options.canUseTool!(
      'AskUserQuestion',
      { questions: [{ question: 'Which option?' }] },
      { signal: options.abortController!.signal, toolUseID: 't1' },
    );
    yield success;
  });
  await context.runner.start({ sessionId: context.session.id, text: 'Ask me', referenceIds: [] });
  const event = await context.wait((item) => item.type === 'permission');
  if (event.type !== 'permission') throw new Error('Wrong event');
  context.runner.answer({
    id: event.request.id,
    allow: true,
    answers: { 'Which option?': 'Option A' },
  });
  await context.wait((item) => item.type === 'session' && item.session.status === 'idle');
  assert.equal(decision.updatedInput.answers['Which option?'], 'Option A');
});

test('simultaneous sends cannot launch two queries for one session', async () => {
  let calls = 0;
  const context = fixture(async function* (_prompt, options) {
    calls++;
    yield init;
    await options.canUseTool!(
      'Write',
      {},
      { signal: options.abortController!.signal, toolUseID: 't1' },
    );
    yield success;
  });
  const input = { sessionId: context.session.id, text: 'One message', referenceIds: [] };
  const results = await Promise.allSettled([
    context.runner.start(input),
    context.runner.start(input),
  ]);
  assert.equal(results.filter((result) => result.status === 'rejected').length, 1);
  assert.equal(calls, 1);
  await context.runner.stopAll();
});

test('explicit full access enables SDK bypass and approves tools without permission cards', async () => {
  let captured: Options | undefined;
  const context = fixture(async function* (_prompt, options) {
    captured = options;
    yield init;
    const decision = await options.canUseTool!(
      'Bash',
      { command: 'fixture-only' },
      { signal: options.abortController!.signal, toolUseID: 'full-access-tool' },
    );
    assert.equal(decision.behavior, 'allow');
    yield success;
  });
  context.store.setPermissionMode('bypassPermissions');
  await context.runner.start({
    sessionId: context.session.id,
    text: 'Run the fixture',
    referenceIds: [],
  });
  await context.wait((event) => event.type === 'session' && event.session.status === 'idle');
  assert.equal(captured?.permissionMode, 'bypassPermissions');
  assert.equal(captured?.allowDangerouslySkipPermissions, true);
  assert.equal(
    context.events.some((event) => event.type === 'permission'),
    false,
  );
  assert.equal(context.session.permissionMode, 'bypassPermissions');
});

test('full access still asks the user for actual AskUserQuestion answers', async () => {
  let decision: any;
  const context = fixture(async function* (_prompt, options) {
    yield init;
    decision = await options.canUseTool!(
      'AskUserQuestion',
      { questions: [{ question: 'Pick a color' }] },
      { signal: options.abortController!.signal, toolUseID: 'full-access-question' },
    );
    yield success;
  });
  context.store.setPermissionMode('bypassPermissions');
  await context.runner.start({ sessionId: context.session.id, text: 'Ask me', referenceIds: [] });
  const event = await context.wait((event) => event.type === 'permission');
  if (event.type !== 'permission') throw new Error('Expected a question');
  context.runner.answer({
    id: event.request.id,
    allow: true,
    answers: { 'Pick a color': 'Orange' },
  });
  await context.wait((event) => event.type === 'session' && event.session.status === 'idle');
  assert.equal(decision.updatedInput.answers['Pick a color'], 'Orange');
});

test('changing the saved mode does not silently escalate a running request', async () => {
  const modes: Options['permissionMode'][] = [];
  const context = fixture(async function* (_prompt, options) {
    modes.push(options.permissionMode);
    yield init;
    await options.canUseTool!(
      'Write',
      { file_path: 'fixture.txt' },
      { signal: options.abortController!.signal, toolUseID: 'snapshot' },
    );
    yield success;
  });
  await context.runner.start({ sessionId: context.session.id, text: 'First', referenceIds: [] });
  const event = await context.wait((event) => event.type === 'permission');
  context.store.setPermissionMode('bypassPermissions');
  assert.equal(context.session.permissionMode, 'default');
  assert.equal(context.runner.pending().length, 1);
  if (event.type !== 'permission') throw new Error('Expected permission');
  context.runner.answer({ id: event.request.id, allow: true });
  await context.wait((event) => event.type === 'session' && event.session.status === 'idle');
  const next = context.store.newSession(context.project.id);
  await context.runner.start({ sessionId: next.id, text: 'Next', referenceIds: [] });
  await context.wait(
    (event) =>
      event.type === 'session' && event.session.id === next.id && event.session.status === 'idle',
  );
  assert.deepEqual(modes, ['default', 'bypassPermissions']);
});
