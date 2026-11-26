import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '../electron/store.js';

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'claude-workbench-test-'));
  return { root, store: new Store(root) };
}

test('persisted conversations, project notes and archived search survive restart', () => {
  const { root, store } = fixture();
  const project = store.addProject('D:\\项目 with spaces');
  const session = store.newSession(project.id);
  session.messages.push({
    id: 'u1',
    role: 'user',
    createdAt: new Date().toISOString(),
    blocks: [{ type: 'text', text: 'Remember the blue butterfly' }],
  });
  store.save(session);
  store.update(session.id, { title: 'Butterfly project', archived: true, pinned: true });
  store.updateNotes(project.id, 'Preserve the existing protocol', true);
  store.setTheme('light');
  const loaded = new Store(root);
  assert.equal(loaded.get(session.id).messages.length, 1);
  assert.equal(loaded.get(session.id).archived, true);
  assert.equal(loaded.get(session.id).pinned, true);
  assert.equal(loaded.search('BLUE')[0].sessionId, session.id);
  assert.equal(loaded.projects[0].notesEnabled, true);
  assert.equal(loaded.theme, 'light');
  assert.equal(loaded.addProject(project.path).id, project.id);
});

test('restart marks an unfinished run interrupted and preserves output', () => {
  const { root, store } = fixture();
  const project = store.addProject('D:\\fixture');
  const session = store.newSession(project.id);
  session.status = 'waiting';
  session.messages.push({
    id: 'a1',
    role: 'assistant',
    createdAt: session.createdAt,
    blocks: [
      { type: 'text', text: 'partial reply' },
      { type: 'tool', id: 't1', name: 'Write', input: {}, state: 'running' },
    ],
  });
  store.save(session);
  const restored = new Store(root).get(session.id);
  assert.equal(restored.status, 'interrupted');
  assert.equal(
    restored.messages[0].blocks[0].type === 'text' && restored.messages[0].blocks[0].text,
    'partial reply',
  );
  assert.equal(
    restored.messages[0].blocks[1].type === 'tool' && restored.messages[0].blocks[1].state,
    'interrupted',
  );
});

test('invalid indexes are backed up instead of silently overwriting user data', () => {
  const { root } = fixture();
  writeFileSync(join(root, 'settings.json'), 'broken original');
  const loaded = new Store(root);
  assert.equal(loaded.warnings.length, 1);
  const backup = readdirSync(root).find((name) => name.startsWith('settings.json.corrupt-'));
  assert.ok(backup);
  assert.equal(readFileSync(join(root, backup!), 'utf8'), 'broken original');
});

test('session IDs cannot escape the session directory', () => {
  const { store } = fixture();
  const project = store.addProject('D:\\fixture');
  const session = store.newSession(project.id);
  assert.throws(() => store.save({ ...session, id: '../escape' }), /无效会话 ID/);
});
