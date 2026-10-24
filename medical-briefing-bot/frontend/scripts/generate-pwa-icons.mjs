import { mkdir } from 'node:fs/promises';
import sharp from 'sharp';

const output = new URL('../public/icons/', import.meta.url);
await mkdir(output, { recursive: true });
const source = new URL('../public/medical-briefing-bear.png', import.meta.url);
for (const [name, size, inset] of [
  ['icon-192.png', 192, 16],
  ['icon-512.png', 512, 40],
  ['icon-maskable-512.png', 512, 88],
  ['apple-touch-icon.png', 180, 16],
]) {
  const bear = await sharp(source.pathname)
    .resize(size - inset * 2, size - inset * 2, { fit: 'contain', background: '#FFF8D8' })
    .png().toBuffer();
  await sharp({ create: { width: size, height: size, channels: 3, background: '#FFF8D8' } })
    .composite([{ input: bear, gravity: 'centre' }])
    .png().toFile(new URL(name, output).pathname);
}
