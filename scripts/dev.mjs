import { spawn, spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { createServer } from 'vite';
import electron from 'electron';

const result = spawnSync(
  process.execPath,
  [resolve('node_modules/typescript/bin/tsc'), '-p', 'tsconfig.electron.json'],
  { stdio: 'inherit', windowsHide: true },
);
if (result.status !== 0) process.exit(result.status || 1);
const server = await createServer();
await server.listen();
const env = { ...process.env, CW_DEV_URL: 'http://127.0.0.1:5188' };
delete env.ELECTRON_RUN_AS_NODE;
const child = spawn(electron, ['.'], { env, stdio: 'inherit', windowsHide: true });
const stop = async () => {
  child.kill();
  await server.close();
};
child.on('exit', async (code) => {
  await server.close();
  process.exit(code || 0);
});
process.on('SIGINT', () => void stop());
process.on('SIGTERM', () => void stop());
