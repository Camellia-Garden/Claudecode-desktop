import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const script = fileURLToPath(import.meta.url);
const root = resolve(dirname(script), '..');

// Reuse Electron's image codecs; no additional image dependency is needed.
if (!process.versions.electron) {
  const { default: executable } = await import('electron');
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  const result = spawnSync(executable, [script], { env, stdio: 'inherit', windowsHide: true });
  if (result.error) throw result.error;
  process.exit(result.status ?? 1);
}

const { app, nativeImage } = await import('electron');
try {
  const source = nativeImage.createFromPath(join(root, 'assets', 'icon-source.png'));
  if (source.isEmpty()) throw new Error('Cannot read assets/icon-source.png');
  const dimensions = source.getSize();
  const size = 512;
  const scale = size / Math.max(dimensions.width, dimensions.height);
  const width = Math.max(1, Math.round(dimensions.width * scale));
  const height = Math.max(1, Math.round(dimensions.height * scale));
  const resized = source.resize({ width, height, quality: 'best' }).getBitmap();
  const square = Buffer.alloc(size * size * 4);
  const left = Math.floor((size - width) / 2);
  const top = Math.floor((size - height) / 2);
  for (let row = 0; row < height; row++) {
    resized.copy(square, ((row + top) * size + left) * 4, row * width * 4, (row + 1) * width * 4);
  }
  const icon = nativeImage.createFromBitmap(square, { width: size, height: size });
  const assets = join(root, 'assets');
  mkdirSync(assets, { recursive: true });
  writeFileSync(join(assets, 'icon.png'), icon.toPNG());

  const sizes = [16, 24, 32, 48, 64, 128, 256];
  const images = sizes.map((width) =>
    icon.resize({ width, height: width, quality: 'best' }).toPNG(),
  );
  const header = Buffer.alloc(6 + sizes.length * 16);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(sizes.length, 4);
  let offset = header.length;
  for (let index = 0; index < sizes.length; index++) {
    const entry = 6 + index * 16;
    header[entry] = header[entry + 1] = sizes[index] === 256 ? 0 : sizes[index];
    header.writeUInt16LE(1, entry + 4);
    header.writeUInt16LE(32, entry + 6);
    header.writeUInt32LE(images[index].length, entry + 8);
    header.writeUInt32LE(offset, entry + 12);
    offset += images[index].length;
  }
  writeFileSync(join(assets, 'icon.ico'), Buffer.concat([header, ...images]));
  console.log(
    'Created icon.png (512px) and icon.ico (' + sizes.join(', ') + 'px) from the supplied image.',
  );
  app.exit(0);
} catch (error) {
  console.error(error);
  app.exit(1);
}
