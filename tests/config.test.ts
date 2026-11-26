import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { inspectLocalConfig } from '../electron/config.js';

test('sync rereads CC Switch changes without storing or returning credentials', async () => {
  const root = await mkdtemp(join(tmpdir(), 'cw-config-'));
  const path = join(root, 'settings.json');
  const env = { CLAUDE_CONFIG_DIR: root };
  const config = {
    env: {
      ANTHROPIC_MODEL: 'model-one',
      ANTHROPIC_AUTH_TOKEN: 'private-fixture-secret',
      ANTHROPIC_BASE_URL: 'https://private.invalid',
    },
    hooks: { private: 'private-hook' },
  };
  await writeFile(path, JSON.stringify(config));
  const initial = await inspectLocalConfig(env);
  assert.equal(initial.state, 'loaded');
  assert.equal(initial.settingsPath, path);
  assert.equal(initial.configuredModel, 'model-one');
  assert.ok(Number.isFinite(Date.parse(initial.checkedAt)));
  assert.doesNotMatch(
    JSON.stringify(initial),
    /private-fixture|private\.invalid|private-hook|AUTH_TOKEN|BASE_URL/,
  );
  config.env.ANTHROPIC_MODEL = 'model-two';
  const changed = JSON.stringify(config);
  await writeFile(path, changed);
  assert.equal((await inspectLocalConfig(env)).configuredModel, 'model-two');
  assert.equal(await readFile(path, 'utf8'), changed, 'Sync never writes Claude settings');
});

test('missing user settings permits CLI defaults and inherited environment', async () => {
  const root = await mkdtemp(join(tmpdir(), 'cw-config-'));
  const result = await inspectLocalConfig({ ANTHROPIC_MODEL: 'inherited-model' }, root);
  assert.equal(result.state, 'missing');
  assert.equal(result.settingsPath, join(root, '.claude', 'settings.json'));
  assert.equal(result.configuredModel, 'inherited-model');
});

test('invalid JSON cannot leak secret fragments in diagnostics and can recover on sync', async () => {
  const root = await mkdtemp(join(tmpdir(), 'cw-config-'));
  const path = join(root, 'settings.json');
  const env = { CLAUDE_CONFIG_DIR: root };
  await writeFile(path, '{"env":{"ANTHROPIC_AUTH_TOKEN": "do-not-echo-this-secret"');
  const result = await inspectLocalConfig(env);
  assert.equal(result.state, 'error');
  assert.doesNotMatch(JSON.stringify(result), /do-not-echo/);
  await writeFile(path, '\uFEFF{"model":"restored-model"}');
  assert.equal((await inspectLocalConfig(env)).configuredModel, 'restored-model');
});

test('only whitelisted model metadata is exposed from the default user location', async () => {
  const root = await mkdtemp(join(tmpdir(), 'cw-config-'));
  await mkdir(join(root, '.claude'));
  const path = join(root, '.claude', 'settings.json');
  await writeFile(
    path,
    JSON.stringify({ model: 'sk-example-sensitive-value', apiKey: 'private-value' }),
  );
  const result = await inspectLocalConfig({}, root);
  assert.equal(result.state, 'loaded');
  assert.equal(result.configuredModel, undefined);
  assert.doesNotMatch(JSON.stringify(result), /sensitive|private-value/);
});
