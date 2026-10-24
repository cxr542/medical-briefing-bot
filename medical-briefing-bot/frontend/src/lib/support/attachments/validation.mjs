import { open as openFile } from 'node:fs/promises';
import { open as openZip } from 'yauzl';
import { createReadStream } from 'node:fs';
import { createHash } from 'node:crypto';

export async function digestFile(path) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest('hex');
}
async function officeArchive(path, kind) {
  const zip = await new Promise((resolve, reject) => openZip(path, { lazyEntries: true, validateEntrySizes: true }, (error, file) => error ? reject(error) : resolve(file)));
  return new Promise((resolve, reject) => {
    let entries = 0; let expanded = 0; let contentTypes = ''; const names = new Set(); let ended = false;
    function fail(error) { if (!ended) { ended = true; zip.close(); reject(error); } }
    zip.on('error', fail);
    zip.on('entry', entry => {
      entries++; expanded += entry.uncompressedSize;
      if (entries > 1000 || expanded > 30 * 1024 * 1024 || entry.uncompressedSize > 10 * 1024 * 1024 ||
        entry.uncompressedSize > Math.max(1024, entry.compressedSize * 100) || (entry.generalPurposeBitFlag & 1) ||
        ![0, 8].includes(entry.compressionMethod) || /(^\/|\\|(^|\/)\.\.(\/|$)|vbaProject|\.exe$|\.dll$)/i.test(entry.fileName) || names.has(entry.fileName)) {
        fail(new Error('Unsafe Office archive')); return;
      }
      names.add(entry.fileName);
      if (entry.fileName.endsWith('/')) { zip.readEntry(); return; }
      zip.openReadStream(entry, (error, stream) => {
        if (error) { fail(error); return; }
        let size = 0; const content = [];
        stream.on('data', chunk => {
          size += chunk.length;
          if (size > entry.uncompressedSize || size > 10 * 1024 * 1024) { stream.destroy(new Error('Archive expansion limit')); return; }
          if (entry.fileName === '[Content_Types].xml') {
            if (size > 65536) { stream.destroy(new Error('Content types limit')); return; }
            content.push(chunk);
          }
        });
        stream.on('error', fail);
        stream.on('end', () => {
          if (entry.fileName === '[Content_Types].xml') contentTypes = Buffer.concat(content).toString('utf8');
          if (!ended) zip.readEntry();
        });
      });
    });
    zip.on('end', () => {
      if (ended) return;
      ended = true;
      const main = kind === 'docx' ? 'word/document.xml' : 'xl/workbook.xml';
      const mime = kind === 'docx' ? 'application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml' : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml';
      if (!names.has(main) || !names.has('_rels/.rels') || !contentTypes.includes(mime) || /<!DOCTYPE|<!ENTITY|macroEnabled/i.test(contentTypes)) reject(new Error('Office format mismatch'));
      else resolve();
    });
    zip.readEntry();
  });
}
export async function validateFile(path, metadata) {
  const file = await openFile(path, 'r');
  const header = Buffer.alloc(16);
  let size;
  try { size = (await file.stat()).size; await file.read(header, 0, 16, 0); }
  finally { await file.close(); }
  if (size !== metadata.bytes || size < 1 || size > 10485760) throw new Error('File size mismatch');
  const extension = metadata.original_name.toLowerCase().split('.').at(-1);
  const signatures = {
    jpg: ['image/jpeg', header[0] === 255 && header[1] === 216 && header[2] === 255],
    jpeg: ['image/jpeg', header[0] === 255 && header[1] === 216 && header[2] === 255],
    png: ['image/png', header.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))],
    webp: ['image/webp', header.toString('ascii', 0, 4) === 'RIFF' && header.toString('ascii', 8, 12) === 'WEBP'],
    pdf: ['application/pdf', header.toString('ascii', 0, 5) === '%PDF-'],
    docx: ['application/vnd.openxmlformats-officedocument.wordprocessingml.document', header.readUInt32LE(0) === 0x04034b50],
    xlsx: ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', header.readUInt32LE(0) === 0x04034b50],
  };
  const match = signatures[extension];
  if (!match || match[0] !== metadata.mime || !match[1]) throw new Error('File signature mismatch');
  if (extension === 'docx' || extension === 'xlsx') await officeArchive(path, extension);
  if (await digestFile(path) !== metadata.sha256) throw new Error('File hash mismatch');
}
