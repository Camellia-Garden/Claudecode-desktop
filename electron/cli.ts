import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { existsSync } from 'node:fs';
import { dirname, join, extname } from 'node:path';
import { homedir } from 'node:os';
import type { CliInfo } from '../shared/types.js';
import { redactError } from './transcript.js';

const execute = promisify(execFile);

export async function detectClaude(): Promise<CliInfo> {
  const candidates: string[] = [];
  try {
    const result = await execute(process.platform === 'win32' ? 'where.exe' : 'which', ['claude'], {
      windowsHide: true,
      timeout: 5000,
    });
    for (const line of result.stdout.trim().split(/\r?\n/)) {
      if (
        process.platform === 'win32' &&
        ['.cmd', '.ps1', '.bat', ''].includes(extname(line).toLowerCase())
      ) {
        candidates.push(
          join(dirname(line), 'node_modules', '@anthropic-ai', 'claude-code', 'bin', 'claude.exe'),
        );
      } else candidates.push(line);
    }
  } catch {
    /* Try known native installation locations below. */
  }
  candidates.push(
    join(homedir(), '.local', 'bin', process.platform === 'win32' ? 'claude.exe' : 'claude'),
  );
  if (process.env.APPDATA)
    candidates.push(
      join(
        process.env.APPDATA,
        'npm',
        'node_modules',
        '@anthropic-ai',
        'claude-code',
        'bin',
        'claude.exe',
      ),
    );
  let lastError = '';
  for (const candidate of [...new Set(candidates)]) {
    if (!existsSync(candidate)) continue;
    try {
      const result = await execute(candidate, ['--version'], {
        timeout: 12000,
        windowsHide: true,
        encoding: 'utf8',
      });
      return { available: true, path: candidate, version: result.stdout.trim() };
    } catch (error) {
      lastError = redactError(String(error));
    }
  }
  return {
    available: false,
    error:
      lastError || '没有找到可运行的 Claude Code。请确认终端中的 claude 命令可用，再重开应用。',
  };
}
