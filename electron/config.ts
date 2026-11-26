import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import type { ConfigInfo } from '../shared/types.js';

// Only return display metadata. Credentials, endpoints, hooks and the settings object
// never cross IPC or enter the app's store. The local CLI still loads all settings itself.
export async function inspectLocalConfig(
  env: NodeJS.ProcessEnv = process.env,
  homeDirectory = homedir(),
): Promise<ConfigInfo> {
  const directory = env.CLAUDE_CONFIG_DIR?.trim()
    ? resolve(env.CLAUDE_CONFIG_DIR)
    : join(homeDirectory, '.claude');
  const info: ConfigInfo = {
    checkedAt: new Date().toISOString(),
    settingsPath: join(directory, 'settings.json'),
    state: 'missing',
  };
  let settings: Record<string, unknown> = {};
  try {
    const content = await readFile(info.settingsPath, 'utf8');
    const parsed: unknown = JSON.parse(content.replace(/^\uFEFF/, ''));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('shape');
    settings = parsed as Record<string, unknown>;
    info.state = 'loaded';
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      info.state = 'error';
      // JSON parse errors can contain a fragment of a secret; never return their text.
      info.error = '无法读取用户配置，请检查文件权限及 JSON 格式后重新同步。';
    }
  }
  const settingsEnv =
    settings.env && typeof settings.env === 'object'
      ? (settings.env as Record<string, unknown>)
      : {};
  const model = settingsEnv.ANTHROPIC_MODEL ?? env.ANTHROPIC_MODEL ?? settings.model;
  if (
    typeof model === 'string' &&
    /^[a-z\d][a-z\d._:/() -]{0,119}$/i.test(model) &&
    !/sk-|key-|token|secret|bearer/i.test(model)
  ) {
    info.configuredModel = model;
  }
  return info;
}
