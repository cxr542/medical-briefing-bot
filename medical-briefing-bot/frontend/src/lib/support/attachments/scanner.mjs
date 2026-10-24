import { createConnection } from 'node:net';
import { createReadStream } from 'node:fs';
import { once } from 'node:events';

export function clamAvScanner({ host, port = 3310, timeoutMs = 120000 } = {}) {
  if (!host || !Number.isInteger(port) || port < 1 || port > 65535) return { configured: false, async scan() { throw new Error('Production scanner is not configured'); } };
  return {
    configured: true,
    async scan(path) {
      const socket = createConnection({ host, port });
      const file = createReadStream(path, { highWaterMark: 65536 });
      const deadline = setTimeout(() => socket.destroy(new Error('Scanner timeout')), Math.min(120000, Math.max(1, timeoutMs)));
      const closed = new Promise((_, reject) => socket.once('close', () => reject(new Error('Scanner connection closed'))));
      closed.catch(() => {});
      let answer = '';
      const response = new Promise((resolve, reject) => {
        socket.once('error', reject);
        socket.setTimeout(120000, () => socket.destroy(new Error('Scanner timeout')));
        socket.on('data', chunk => {
          answer += chunk.toString('utf8');
          if (answer.length > 4096) { socket.destroy(new Error('Scanner result limit')); return; }
          if (answer.includes('\0')) resolve(answer.slice(0, answer.indexOf('\0')));
        });
        socket.on('end', () => { if (!answer.includes('\0')) reject(new Error('Incomplete scanner result')); });
      });
      response.catch(() => {});
      try {
        await Promise.race([once(socket, 'connect'), closed]);
        socket.write('zINSTREAM\0');
        for await (const chunk of file) {
          const length = Buffer.alloc(4); length.writeUInt32BE(chunk.length);
          socket.write(length);
          if (!socket.write(chunk)) await Promise.race([once(socket, 'drain'), closed]);
        }
        socket.write(Buffer.alloc(4));
        const result = await Promise.race([response, closed]);
        if (result === 'stream: OK') return 'clean';
        if (/^stream: .+ FOUND$/.test(result)) return 'infected';
        throw new Error('Scanner rejected file');
      } finally { clearTimeout(deadline); file.destroy(); socket.destroy(); }
    },
  };
}
